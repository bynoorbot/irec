"""Aura Home Transcript Runner Service.

Lightweight, self-hosted transcript proxy service running on a clean residential IP.
Backed by youtube_transcript_api and exposed through Cloudflare Tunnel.
"""

import asyncio
from contextlib import asynccontextmanager
import logging
import os
import re
import secrets
import sys
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    AgeRestricted,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("runner")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8791
INTERNAL_TIMEOUT = 8.0
CONCURRENCY_LIMIT = 4

VIDEO_ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{11}$")
SEMAPHORE = asyncio.Semaphore(CONCURRENCY_LIMIT)


def _get_version() -> str:
    """Retrieve version string from environment or git short sha, fallback to 'dev'."""
    if os.environ.get("RUNNER_VERSION"):
        return os.environ["RUNNER_VERSION"]
    try:
        import subprocess

        res = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
    return "dev"


def _log_request(
    video_id: str,
    status: int,
    lang: str | None,
    chars: int,
    duration_ms: int,
    error_class: str | None,
) -> None:
    """Log one structured line per request: video_id, status, lang, chars, duration_ms, error_class.

    Never logs transcript text or sensitive tokens.
    """
    logger.info(
        "video_id=%s status=%d lang=%s chars=%d duration_ms=%d error_class=%s",
        video_id or "none",
        status,
        lang or "none",
        chars,
        duration_ms,
        error_class or "none",
    )


def _fetch_transcript_sync(video_id: str) -> tuple[str, str]:
    """Fetch transcript synchronously using youtube_transcript_api.

    Precedence:
    1. languages=["en", "en-US", "en-GB"]
    2. Any available language fallback via api.list()
    """
    api = YouTubeTranscriptApi()

    # Step 1: English variants
    try:
        result = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
        raw_text = " ".join(
            getattr(s, "text", "") for s in getattr(result, "snippets", [])
        ).strip()
        lang = getattr(result, "language_code", "en")
        if raw_text:
            return raw_text, lang
    except (TranscriptsDisabled, NoTranscriptFound):
        pass

    # Step 2: Fall back to any available transcript
    transcript_list = api.list(video_id)
    first_transcript = next(iter(transcript_list))
    fallback_result = first_transcript.fetch()
    fallback_text = " ".join(
        getattr(s, "text", "") for s in getattr(fallback_result, "snippets", [])
    ).strip()
    fallback_lang = getattr(fallback_result, "language_code", None) or getattr(
        first_transcript, "language_code", "unknown"
    )
    return fallback_text, fallback_lang


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan handler: refuses to start if RUNNER_TOKEN is unset."""
    if not os.environ.get("RUNNER_TOKEN"):
        raise RuntimeError("RUNNER_TOKEN environment variable must be set")
    yield


app = FastAPI(title="Aura Transcript Runner", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check: no auth, no side effects."""
    return {"status": "ok", "version": _get_version()}


@app.get("/transcript")
async def transcript(request: Request, v: str | None = None) -> JSONResponse:
    """Fetch transcript for a given video ID with auth and rate limits.

    Response contract:
    - 200: {"transcript": str, "length": int, "lang": str}
    - 400: {"error": str, "error_code": "INVALID_VIDEO_ID"}
    - 401: {"error_code": "UNAUTHORIZED"}
    - 422: {"error": str, "error_code": "NO_CAPTIONS"}
    - 502: {"error": str, "error_code": "UPSTREAM_BLOCKED"}
    """
    t0 = time.monotonic()

    # 1. Auth check
    expected_token = os.environ.get("RUNNER_TOKEN", "")
    provided_token = request.headers.get("x-runner-token")
    if not provided_token or not secrets.compare_digest(provided_token, expected_token):
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v or "none", 401, None, 0, duration_ms, "UNAUTHORIZED")
        return JSONResponse(
            status_code=401,
            content={"error_code": "UNAUTHORIZED"},
        )

    # 2. Input validation
    if not v or not VIDEO_ID_REGEX.match(v):
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v or "invalid", 400, None, 0, duration_ms, "INVALID_VIDEO_ID")
        return JSONResponse(
            status_code=400,
            content={
                "error": "Invalid video ID. Expected 11 alphanumeric/dash/underscore characters.",
                "error_code": "INVALID_VIDEO_ID",
            },
        )

    # 3. Concurrency cap & internal timeout
    try:
        async with SEMAPHORE:
            raw_text, lang = await asyncio.wait_for(
                asyncio.to_thread(_fetch_transcript_sync, v),
                timeout=INTERNAL_TIMEOUT,
            )

        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v, 200, lang, len(raw_text), duration_ms, None)
        return JSONResponse(
            status_code=200,
            content={
                "transcript": raw_text,
                "length": len(raw_text),
                "lang": lang,
            },
        )
    except (
        TranscriptsDisabled,
        NoTranscriptFound,
        VideoUnavailable,
        VideoUnplayable,
        AgeRestricted,
        StopIteration,
    ) as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v, 422, None, 0, duration_ms, "NO_CAPTIONS")
        return JSONResponse(
            status_code=422,
            content={
                "error": str(e) or "No captions available for video",
                "error_code": "NO_CAPTIONS",
            },
        )
    except (TimeoutError, asyncio.TimeoutError):
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v, 502, None, 0, duration_ms, "UPSTREAM_BLOCKED")
        return JSONResponse(
            status_code=502,
            content={
                "error": "Transcript retrieval timed out internally",
                "error_code": "UPSTREAM_BLOCKED",
            },
        )
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_request(v, 502, None, 0, duration_ms, "UPSTREAM_BLOCKED")
        return JSONResponse(
            status_code=502,
            content={
                "error": str(e),
                "error_code": "UPSTREAM_BLOCKED",
            },
        )


if __name__ == "__main__":
    import uvicorn

    if not os.environ.get("RUNNER_TOKEN"):
        sys.exit("RUNNER_TOKEN environment variable must be set")

    host = os.environ.get("RUNNER_HOST", DEFAULT_HOST)
    port = int(os.environ.get("RUNNER_PORT", str(DEFAULT_PORT)))
    uvicorn.run(app, host=host, port=port)
