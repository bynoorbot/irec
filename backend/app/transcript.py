"""Transcript Fetcher - Retrieves and concatenates YouTube video transcripts."""

import asyncio
import json
import logging
import os
import random
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
)
from youtube_transcript_api.proxies import WebshareProxyConfig

logger = logging.getLogger(__name__)

MAX_RETRIES: int = 2
BASE_DELAY_SECONDS: int = 3

# Minimum length for an accepted transcript (below 50 chars is rejected as EmptyTranscript)
MIN_TRANSCRIPT_LENGTH: int = 50

# Total deadline for transcript retrieval (default 25 seconds)
TRANSCRIPT_DEADLINE_SECONDS: float = float(
    os.environ.get("TRANSCRIPT_DEADLINE_SECONDS", "25")
)

# Cloudflare Worker URL for transcript proxy (bypasses datacenter IP blocks)
TRANSCRIPT_WORKER_URL: str = os.environ.get("TRANSCRIPT_WORKER_URL", "")

# Feature flag to enable/disable Webshare proxy egress
PROXY_ENABLED: bool = os.environ.get("PROXY_ENABLED", "false").lower() in (
    "true",
    "1",
    "yes",
)

# Type for an optional async retry callback: (attempt, max_retries, error, delay) -> None
AsyncRetryCallback = Callable[[int, int, str, int], None] | None


@dataclass(frozen=True)
class AttemptRecord:
    """Structured record of a single transcript fetch attempt."""

    video_id: str
    method: str
    stage: str
    http_status: int | None
    bytes: int
    duration_ms: int
    error_class: str | None


def _log_attempt(record: AttemptRecord) -> None:
    """Log one structured line per attempt without sensitive data or transcript text."""
    logger.info(
        "Transcript attempt: video_id=%s method=%s stage=%s http_status=%s bytes=%d duration_ms=%d error_class=%s",
        record.video_id,
        record.method,
        record.stage,
        str(record.http_status) if record.http_status is not None else "None",
        record.bytes,
        record.duration_ms,
        record.error_class or "None",
    )


class TerminalNoCaptionsError(Exception):
    """Raised when worker reports terminal unplayable video or no caption tracks."""


async def _fetch_via_worker(
    video_id: str,
    deadline: float,
    attempts: list[AttemptRecord],
) -> str | None:
    """Fetch transcript via Cloudflare Worker proxy with structured error handling.

    - 8s client timeout per attempt (dropped from 12s).
    - Up to 3 attempts (1 initial + 2 retries) inside total deadline.
    - Classifies terminal (422 NO_CAPTIONS / NO_CAPTIONS_AGE) vs retryable (UPSTREAM_BOTWALL,
      UPSTREAM_EMPTY, UPSTREAM_NETWORK, 429, 5xx, and network errors).
    - Retries retryable failures as long as remaining budget allows, using 250 to 500ms jittered backoff.
    - Never retries a terminal error; raises TerminalNoCaptionsError.
    - Enforces len(transcript) >= 50; below that records EmptyTranscript and falls through.
    - Records winning language in stage (e.g. 'transcript:en').
    """
    if not TRANSCRIPT_WORKER_URL:
        record = AttemptRecord(
            video_id=video_id,
            method="worker",
            stage="config_check",
            http_status=None,
            bytes=0,
            duration_ms=0,
            error_class="WorkerNotConfigured",
        )
        attempts.append(record)
        _log_attempt(record)
        return None

    max_attempts = 3  # 1 initial + 2 retries on retryable
    for attempt_idx in range(max_attempts):
        now = time.monotonic()
        remaining = deadline - now
        if remaining <= 0:
            break

        timeout = min(8.0, remaining)
        t0 = time.monotonic()

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(
                    f"{TRANSCRIPT_WORKER_URL}/transcript",
                    params={"v": video_id},
                )
                duration_ms = int((time.monotonic() - t0) * 1000)

                if resp.status_code == 200:
                    try:
                        data: dict[str, Any] = resp.json()
                    except Exception:
                        data = {}
                    transcript_val = data.get("transcript", "")
                    lang_val = data.get("lang")
                    stage = f"transcript:{lang_val}" if lang_val else "transcript"
                    transcript = (
                        transcript_val.strip() if isinstance(transcript_val, str) else ""
                    )

                    if len(transcript) >= MIN_TRANSCRIPT_LENGTH:
                        record = AttemptRecord(
                            video_id=video_id,
                            method="worker",
                            stage=stage,
                            http_status=200,
                            bytes=len(transcript.encode("utf-8")),
                            duration_ms=duration_ms,
                            error_class=None,
                        )
                        attempts.append(record)
                        _log_attempt(record)
                        return transcript
                    else:
                        # Below 50 chars is treated as EmptyTranscript
                        record = AttemptRecord(
                            video_id=video_id,
                            method="worker",
                            stage=stage,
                            http_status=200,
                            bytes=len(transcript.encode("utf-8")),
                            duration_ms=duration_ms,
                            error_class="EmptyTranscript",
                        )
                        attempts.append(record)
                        _log_attempt(record)
                        return None

                # Non-200 response
                body_bytes = len(resp.content)
                try:
                    data = resp.json()
                    err_code = str(data.get("error_code", ""))
                    stage = str(data.get("stage", "fetch"))
                except Exception:
                    data = {}
                    err_code = ""
                    stage = "fetch"

                is_terminal = resp.status_code == 422 or err_code in ("NO_CAPTIONS", "NO_CAPTIONS_AGE")
                error_class = (
                    f"HTTP_{resp.status_code}_{err_code}"
                    if err_code
                    else f"HTTP_{resp.status_code}"
                )

                record = AttemptRecord(
                    video_id=video_id,
                    method="worker",
                    stage=stage,
                    http_status=resp.status_code,
                    bytes=body_bytes,
                    duration_ms=duration_ms,
                    error_class=error_class,
                )
                attempts.append(record)
                _log_attempt(record)

                if is_terminal:
                    # Never retry a terminal error
                    raise TerminalNoCaptionsError(
                        f"Worker terminal no-captions ({resp.status_code} {err_code})"
                    )

                is_retryable = (
                    resp.status_code == 429
                    or resp.status_code >= 500
                    or err_code in ("UPSTREAM_BOTWALL", "UPSTREAM_EMPTY", "UPSTREAM_NETWORK")
                )
                if is_retryable and attempt_idx < max_attempts - 1:
                    jittered_backoff = random.uniform(0.25, 0.5)
                    if time.monotonic() + jittered_backoff < deadline:
                        await asyncio.sleep(jittered_backoff)
                        continue
                return None

        except TerminalNoCaptionsError:
            raise
        except (httpx.RequestError, httpx.TimeoutException) as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            record = AttemptRecord(
                video_id=video_id,
                method="worker",
                stage="fetch",
                http_status=None,
                bytes=0,
                duration_ms=duration_ms,
                error_class=type(e).__name__,
            )
            attempts.append(record)
            _log_attempt(record)

            if attempt_idx < max_attempts - 1:
                jittered_backoff = random.uniform(0.25, 0.5)
                if time.monotonic() + jittered_backoff < deadline:
                    await asyncio.sleep(jittered_backoff)
                    continue
            return None
        except Exception as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            record = AttemptRecord(
                video_id=video_id,
                method="worker",
                stage="fetch",
                http_status=None,
                bytes=0,
                duration_ms=duration_ms,
                error_class=type(e).__name__,
            )
            attempts.append(record)
            _log_attempt(record)
            return None

    return None


def _build_api() -> YouTubeTranscriptApi:
    """Build the transcript API client, with proxy only if PROXY_ENABLED."""
    if not PROXY_ENABLED:
        return YouTubeTranscriptApi()

    proxy_user = os.environ.get("WEBSHARE_PROXY_USER")
    proxy_pass = os.environ.get("WEBSHARE_PROXY_PASS")

    if proxy_user and proxy_pass:
        locations_str = os.environ.get("WEBSHARE_PROXY_LOCATIONS", "")
        locations = (
            [loc.strip() for loc in locations_str.split(",") if loc.strip()]
            or None
        )

        proxy_config = WebshareProxyConfig(
            proxy_username=proxy_user,
            proxy_password=proxy_pass,
            filter_ip_locations=locations,
            retries_when_blocked=2,
        )
        return YouTubeTranscriptApi(proxy_config=proxy_config)

    return YouTubeTranscriptApi()


def _fetch_transcript_ytdlp(
    video_id: str,
    deadline: float,
    attempts: list[AttemptRecord],
) -> str | None:
    """Fallback transcript fetch using yt-dlp with mobile/TV client strategies.

    Strategies cut to 'mweb' and 'tv'.
    Downloads subtitle using the same proxy and UA as extraction.
    12s per combination, respecting deadline.
    Enforces minimum 50 chars length.
    """
    import yt_dlp

    url = f"https://www.youtube.com/watch?v={video_id}"
    user_agent = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )

    proxy_url: str | None = None
    if PROXY_ENABLED:
        proxy_user = os.environ.get("WEBSHARE_PROXY_USER")
        proxy_pass = os.environ.get("WEBSHARE_PROXY_PASS")
        if proxy_user and proxy_pass:
            proxy_url = f"http://{proxy_user}:{proxy_pass}@p.webshare.io:80"

    # Cut strategies strictly to mweb and tv
    client_strategies: list[dict[str, str]] = [
        {"player_client": "mweb"},
        {"player_client": "tv"},
    ]

    proxy_options: list[str | None] = [proxy_url, None] if proxy_url else [None]

    for strategy in client_strategies:
        for proxy in proxy_options:
            if time.monotonic() >= deadline:
                return None

            t0 = time.monotonic()
            stage_label = f"{strategy.get('player_client', 'unknown')}_proxy={bool(proxy)}"
            ydl_opts: dict[str, Any] = {
                "skip_download": True,
                "writeautomaticsub": True,
                "writesubtitles": True,
                "subtitleslangs": ["en", "en-US", "en-GB"],
                "subtitlesformat": "json3",
                "quiet": True,
                "no_warnings": True,
                "ignore_no_formats_error": True,
                "extractor_args": {"youtube": strategy},
                "http_headers": {
                    "User-Agent": user_agent,
                    "Accept-Language": "en-US,en;q=0.9",
                },
                "socket_timeout": 12,
            }
            if proxy:
                ydl_opts["proxy"] = proxy

            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    if not info:
                        duration_ms = int((time.monotonic() - t0) * 1000)
                        rec = AttemptRecord(
                            video_id=video_id,
                            method="ytdlp",
                            stage=stage_label,
                            http_status=None,
                            bytes=0,
                            duration_ms=duration_ms,
                            error_class="NoInfoExtracted",
                        )
                        attempts.append(rec)
                        _log_attempt(rec)
                        continue

                    subs: dict[str, Any] = info.get("subtitles", {}) or {}
                    auto_subs: dict[str, Any] = (
                        info.get("automatic_captions", {}) or {}
                    )

                    sub_data: list[dict[str, Any]] | None = None
                    for lang in ["en", "en-US", "en-GB"]:
                        if lang in subs:
                            sub_data = subs[lang]
                            break
                        if lang in auto_subs:
                            sub_data = auto_subs[lang]
                            break

                    if not sub_data:
                        for key in list(subs.keys()) + list(auto_subs.keys()):
                            if key.startswith("en"):
                                sub_data = subs.get(key) or auto_subs.get(key)
                                break

                    if not sub_data:
                        duration_ms = int((time.monotonic() - t0) * 1000)
                        rec = AttemptRecord(
                            video_id=video_id,
                            method="ytdlp",
                            stage=stage_label,
                            http_status=None,
                            bytes=0,
                            duration_ms=duration_ms,
                            error_class="NoEnglishSubtitles",
                        )
                        attempts.append(rec)
                        _log_attempt(rec)
                        continue

                    sub_url: str | None = None
                    for fmt in sub_data:
                        if fmt.get("ext") == "json3":
                            sub_url = fmt.get("url")
                            break
                    if not sub_url:
                        for fmt in sub_data:
                            if fmt.get("ext") in ("vtt", "srv1", "srv2", "srv3"):
                                sub_url = fmt.get("url")
                                break

                    if not sub_url:
                        duration_ms = int((time.monotonic() - t0) * 1000)
                        rec = AttemptRecord(
                            video_id=video_id,
                            method="ytdlp",
                            stage=stage_label,
                            http_status=None,
                            bytes=0,
                            duration_ms=duration_ms,
                            error_class="NoDownloadableFormat",
                        )
                        attempts.append(rec)
                        _log_attempt(rec)
                        continue

                    # Download subtitle with same proxy and UA as extraction (12s timeout)
                    client_kwargs: dict[str, Any] = {
                        "headers": {
                            "User-Agent": user_agent,
                            "Accept-Language": "en-US,en;q=0.9",
                        },
                        "timeout": 12.0,
                    }
                    if proxy:
                        client_kwargs["proxy"] = proxy

                    with httpx.Client(**client_kwargs) as sub_client:
                        sub_resp = sub_client.get(sub_url)
                        sub_resp.raise_for_status()

                    content_type = sub_resp.headers.get("content-type", "")
                    text = sub_resp.text
                    duration_ms = int((time.monotonic() - t0) * 1000)

                    # Parse json3 format
                    if "json" in content_type or text.strip().startswith("{"):
                        data = json.loads(text)
                        events = data.get("events", [])
                        segments: list[str] = []
                        for event in events:
                            for seg in event.get("segs", []):
                                t = seg.get("utf8", "").strip()
                                if t and t != "\n":
                                    segments.append(t)
                        if segments:
                            full_text = " ".join(segments).strip()
                            if len(full_text) >= MIN_TRANSCRIPT_LENGTH:
                                rec = AttemptRecord(
                                    video_id=video_id,
                                    method="ytdlp",
                                    stage=stage_label,
                                    http_status=200,
                                    bytes=len(full_text.encode("utf-8")),
                                    duration_ms=duration_ms,
                                    error_class=None,
                                )
                                attempts.append(rec)
                                _log_attempt(rec)
                                return full_text
                            else:
                                rec = AttemptRecord(
                                    video_id=video_id,
                                    method="ytdlp",
                                    stage=stage_label,
                                    http_status=200,
                                    bytes=len(full_text.encode("utf-8")),
                                    duration_ms=duration_ms,
                                    error_class="EmptyTranscript",
                                )
                                attempts.append(rec)
                                _log_attempt(rec)
                                continue
                    else:
                        # VTT or other plain text format
                        lines: list[str] = []
                        for line in text.split("\n"):
                            line = line.strip()
                            if (
                                not line
                                or "-->" in line
                                or line.startswith("WEBVTT")
                                or line.isdigit()
                            ):
                                continue
                            clean = re.sub(r"<[^>]+>", "", line)
                            if clean:
                                lines.append(clean)
                        if lines:
                            full_text = " ".join(lines).strip()
                            if len(full_text) >= MIN_TRANSCRIPT_LENGTH:
                                rec = AttemptRecord(
                                    video_id=video_id,
                                    method="ytdlp",
                                    stage=stage_label,
                                    http_status=200,
                                    bytes=len(full_text.encode("utf-8")),
                                    duration_ms=duration_ms,
                                    error_class=None,
                                )
                                attempts.append(rec)
                                _log_attempt(rec)
                                return full_text
                            else:
                                rec = AttemptRecord(
                                    video_id=video_id,
                                    method="ytdlp",
                                    stage=stage_label,
                                    http_status=200,
                                    bytes=len(full_text.encode("utf-8")),
                                    duration_ms=duration_ms,
                                    error_class="EmptyTranscript",
                                )
                                attempts.append(rec)
                                _log_attempt(rec)
                                continue

            except Exception as e:
                duration_ms = int((time.monotonic() - t0) * 1000)
                rec = AttemptRecord(
                    video_id=video_id,
                    method="ytdlp",
                    stage=stage_label,
                    http_status=None,
                    bytes=0,
                    duration_ms=duration_ms,
                    error_class=type(e).__name__,
                )
                attempts.append(rec)
                _log_attempt(rec)
                continue

    return None


async def _fetch_with_retry(
    video_id: str,
    deadline: float,
    attempts: list[AttemptRecord],
    on_retry: AsyncRetryCallback = None,
) -> Any:
    """Attempt transcript fetch with exponential backoff on rate-limit errors.

    - Rebuilds API client on retry.
    - Does not sleep after final attempt.
    - Treats ProxyError / 502 tunnel failures as step-fatal (break out immediately).
    """
    last_exception: Exception | None = None

    for attempt in range(MAX_RETRIES):
        if time.monotonic() >= deadline:
            break

        t0 = time.monotonic()
        try:
            api = _build_api()
            result = await asyncio.to_thread(
                api.fetch, video_id, languages=["en", "en-US", "en-GB"]
            )
            duration_ms = int((time.monotonic() - t0) * 1000)
            text_len = sum(
                len(getattr(s, "text", "").encode("utf-8"))
                for s in getattr(result, "snippets", [])
            )
            record = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api",
                stage=f"attempt_{attempt + 1}",
                http_status=200,
                bytes=text_len,
                duration_ms=duration_ms,
                error_class=None,
            )
            attempts.append(record)
            _log_attempt(record)
            return result
        except (TranscriptsDisabled, NoTranscriptFound) as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            record = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api",
                stage=f"attempt_{attempt + 1}",
                http_status=None,
                bytes=0,
                duration_ms=duration_ms,
                error_class=type(e).__name__,
            )
            attempts.append(record)
            _log_attempt(record)
            raise
        except Exception as e:
            last_exception = e
            duration_ms = int((time.monotonic() - t0) * 1000)
            error_class = type(e).__name__
            error_str = str(e).lower()

            record = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api",
                stage=f"attempt_{attempt + 1}",
                http_status=502 if "502" in error_str else None,
                bytes=0,
                duration_ms=duration_ms,
                error_class=error_class,
            )
            attempts.append(record)
            _log_attempt(record)

            # Treat ProxyError / 502 tunnel failures as step-fatal (break out, no retry)
            is_proxy_fatal = (
                "proxyerror" in error_class.lower()
                or "502" in error_str
                or "tunnel" in error_str
            )
            if is_proxy_fatal:
                logger.warning(
                    "Step-fatal proxy/tunnel failure for %s: %s",
                    video_id,
                    e,
                )
                break

            if isinstance(e, RequestBlocked):
                if attempt < MAX_RETRIES - 1:
                    delay = BASE_DELAY_SECONDS * (2**attempt)
                    logger.warning(
                        "Proxy blocked for %s (attempt %d/%d), retrying in %ds with fresh proxy",
                        video_id,
                        attempt + 1,
                        MAX_RETRIES,
                        delay,
                    )
                    if on_retry:
                        on_retry(
                            attempt + 1,
                            MAX_RETRIES,
                            "Proxy blocked, rotating IP",
                            delay,
                        )
                    await asyncio.sleep(delay)
                continue

            is_retryable = (
                "429" in error_str
                or "too many" in error_str
                or "max retries" in error_str
                or "connection" in error_str
                or "timeout" in error_str
                or "retryerror" in error_str
            )
            if is_retryable:
                if attempt < MAX_RETRIES - 1:
                    delay = BASE_DELAY_SECONDS * (2**attempt)
                    logger.warning(
                        "Retryable error fetching transcript for %s (attempt %d/%d): %s, retrying in %ds",
                        video_id,
                        attempt + 1,
                        MAX_RETRIES,
                        error_class,
                        delay,
                    )
                    if on_retry:
                        on_retry(attempt + 1, MAX_RETRIES, error_class, delay)
                    await asyncio.sleep(delay)
            else:
                # Non-retryable error: do not retry
                raise

    if last_exception:
        raise last_exception
    raise HTTPException(
        status_code=502,
        detail="UPSTREAM_BLOCKED: proxy retries exhausted",
    )


async def _fetch_proxy_stage(
    video_id: str,
    deadline: float,
    attempts: list[AttemptRecord],
    on_retry: AsyncRetryCallback = None,
) -> str | None:
    """Run youtube-transcript-api with proxy and any-language fallback."""
    if on_retry:
        on_retry(0, 0, "Primary methods failed, trying proxy", 0)

    try:
        result = await _fetch_with_retry(
            video_id,
            deadline=deadline,
            attempts=attempts,
            on_retry=on_retry,
        )
        raw_text = " ".join(
            getattr(s, "text", "") for s in getattr(result, "snippets", [])
        ).strip()
        if len(raw_text) >= MIN_TRANSCRIPT_LENGTH:
            return raw_text
        else:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api",
                stage="length_check",
                http_status=200,
                bytes=len(raw_text.encode("utf-8")),
                duration_ms=0,
                error_class="EmptyTranscript",
            )
            attempts.append(rec)
            _log_attempt(rec)
    except (TranscriptsDisabled, NoTranscriptFound):
        pass

    # Try any available language fallback
    api = _build_api()
    t0 = time.monotonic()
    try:
        transcript_list = await asyncio.to_thread(api.list, video_id)
        first_transcript = next(iter(transcript_list))
        fallback_result = await asyncio.to_thread(first_transcript.fetch)
        duration_ms = int((time.monotonic() - t0) * 1000)
        fallback_text = " ".join(
            getattr(snippet, "text", "")
            for snippet in getattr(fallback_result, "snippets", [])
        ).strip()
        if len(fallback_text) >= MIN_TRANSCRIPT_LENGTH:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api_any_lang",
                stage="fetch",
                http_status=200,
                bytes=len(fallback_text.encode("utf-8")),
                duration_ms=duration_ms,
                error_class=None,
            )
            attempts.append(rec)
            _log_attempt(rec)
            return fallback_text
        else:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api_any_lang",
                stage="length_check",
                http_status=200,
                bytes=len(fallback_text.encode("utf-8")),
                duration_ms=duration_ms,
                error_class="EmptyTranscript",
            )
            attempts.append(rec)
            _log_attempt(rec)
            return None
    except Exception as fallback_err:
        duration_ms = int((time.monotonic() - t0) * 1000)
        rec = AttemptRecord(
            video_id=video_id,
            method="youtube_transcript_api_any_lang",
            stage="fallback_fetch",
            http_status=None,
            bytes=0,
            duration_ms=duration_ms,
            error_class=type(fallback_err).__name__,
        )
        attempts.append(rec)
        _log_attempt(rec)
        return None

    return None


async def _fetch_direct_last_resort(
    video_id: str,
    timeout: float,
    attempts: list[AttemptRecord],
) -> str | None:
    """Run youtube-transcript-api directly with no proxy as a bounded last resort.

    Runs once, capped by min(8.0, remaining_deadline), no retries, no multi-retry sleeps.
    Records attempt and returns transcript if successful (>= 50 chars), else None.
    If it raises RequestBlocked/IpBlocked/timeout/etc., records attempt and continues.
    """
    from youtube_transcript_api import YouTubeTranscriptApi

    t0 = time.monotonic()
    api = YouTubeTranscriptApi()

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                api.fetch, video_id, languages=["en", "en-US", "en-GB"]
            ),
            timeout=timeout,
        )
        duration_ms = int((time.monotonic() - t0) * 1000)
        raw_text = " ".join(
            getattr(s, "text", "") for s in getattr(result, "snippets", [])
        ).strip()

        if len(raw_text) >= MIN_TRANSCRIPT_LENGTH:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api_direct",
                stage="direct",
                http_status=200,
                bytes=len(raw_text.encode("utf-8")),
                duration_ms=duration_ms,
                error_class=None,
            )
            attempts.append(rec)
            _log_attempt(rec)
            return raw_text
        else:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api_direct",
                stage="direct",
                http_status=200,
                bytes=len(raw_text.encode("utf-8")),
                duration_ms=duration_ms,
                error_class="EmptyTranscript",
            )
            attempts.append(rec)
            _log_attempt(rec)
            return None
    except TimeoutError:
        duration_ms = int((time.monotonic() - t0) * 1000)
        rec = AttemptRecord(
            video_id=video_id,
            method="youtube_transcript_api_direct",
            stage="direct",
            http_status=None,
            bytes=0,
            duration_ms=duration_ms,
            error_class="TimeoutError",
        )
        attempts.append(rec)
        _log_attempt(rec)
        return None
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        error_class = type(e).__name__
        rec = AttemptRecord(
            video_id=video_id,
            method="youtube_transcript_api_direct",
            stage="direct",
            http_status=None,
            bytes=0,
            duration_ms=duration_ms,
            error_class=error_class,
        )
        attempts.append(rec)
        _log_attempt(rec)
        return None


def _raise_http_error(
    status_code: int,
    detail: str,
    attempts: list[AttemptRecord],
    video_id: str = "",
) -> None:
    """Raise HTTPException with attached attempt records and a single summary log line."""
    vid = video_id or (attempts[0].video_id if attempts else "unknown")
    flow = (
        " -> ".join(f"{a.method}:{a.error_class or 'none'}" for a in attempts)
        if attempts
        else "no_attempts"
    )
    logger.error(
        "Transcript fetch failed for video_id=%s: %s | flow: %s",
        vid,
        detail,
        flow,
    )
    exc = HTTPException(status_code=status_code, detail=detail)
    exc.attempts = attempts  # type: ignore[attr-defined]
    raise exc


async def fetch_transcript(
    video_id: str,
    on_retry: AsyncRetryCallback = None,
) -> str:
    """Fetch the transcript for a YouTube video and concatenate segments.

    Enforces a strict total deadline (TRANSCRIPT_DEADLINE_SECONDS, default 25s).
    Wraps each remaining stage in asyncio.wait_for to prevent overrun from blocking threads.
    Enforces minimum 50 characters length on all return paths.
    Collects per-attempt record list attached to logs and final error.

    Strategy ladder:
    1. Cloudflare Worker proxy (edge IPs, not blocked by YouTube)
    2. yt-dlp with mobile/TV client strategies (only if PROXY_ENABLED or no worker URL)
    3. youtube-transcript-api (with proxy if PROXY_ENABLED, else direct bounded last resort)

    Raises:
        HTTPException(422): TRANSCRIPT_UNAVAILABLE for terminal no-captions.
        HTTPException(502): UPSTREAM_BLOCKED when all available paths were blocked.
        HTTPException(504): INGEST_DEADLINE on deadline exhaustion.
    """
    deadline = time.monotonic() + TRANSCRIPT_DEADLINE_SECONDS
    attempts: list[AttemptRecord] = []
    has_terminal_no_captions = False

    def _get_rem() -> float:
        return deadline - time.monotonic()

    rem = _get_rem()
    if rem <= 0:
        _raise_http_error(
            504,
            "INGEST_DEADLINE: transcript fetch exceeded deadline before starting",
            attempts,
            video_id=video_id,
        )

    # Method 1: Cloudflare Worker
    try:
        worker_result = await asyncio.wait_for(
            _fetch_via_worker(
                video_id,
                deadline=deadline,
                attempts=attempts,
            ),
            timeout=rem,
        )
        if worker_result:
            return worker_result
    except TimeoutError:
        _raise_http_error(
            504,
            "INGEST_DEADLINE: transcript fetch exceeded deadline during worker stage",
            attempts,
            video_id=video_id,
        )
    except TerminalNoCaptionsError:
        has_terminal_no_captions = True
        _raise_http_error(
            422,
            "TRANSCRIPT_UNAVAILABLE: No captions available for video",
            attempts,
            video_id=video_id,
        )

    rem = _get_rem()
    if rem <= 0:
        _raise_http_error(
            504,
            "INGEST_DEADLINE: transcript fetch exceeded deadline after worker",
            attempts,
            video_id=video_id,
        )

    # Method 2: yt-dlp (runs ONLY when PROXY_ENABLED is True OR TRANSCRIPT_WORKER_URL is empty)
    should_run_ytdlp = PROXY_ENABLED or not TRANSCRIPT_WORKER_URL
    if not should_run_ytdlp:
        rec = AttemptRecord(
            video_id=video_id,
            method="ytdlp",
            stage="skip_check",
            http_status=None,
            bytes=0,
            duration_ms=0,
            error_class="skipped:no_proxy",
        )
        attempts.append(rec)
        _log_attempt(rec)
    else:
        try:
            ytdlp_result = await asyncio.wait_for(
                asyncio.to_thread(
                    _fetch_transcript_ytdlp,
                    video_id,
                    deadline,
                    attempts,
                ),
                timeout=rem,
            )
            if ytdlp_result:
                return ytdlp_result
        except TimeoutError:
            _raise_http_error(
                504,
                "INGEST_DEADLINE: transcript fetch exceeded deadline during yt-dlp stage",
                attempts,
                video_id=video_id,
            )

    rem = _get_rem()
    if rem <= 0:
        _raise_http_error(
            504,
            "INGEST_DEADLINE: transcript fetch exceeded deadline after yt-dlp",
            attempts,
            video_id=video_id,
        )

    # Method 3: youtube-transcript-api (proxy if PROXY_ENABLED, else direct bounded last resort)
    if not PROXY_ENABLED:
        direct_timeout = min(8.0, rem)
        try:
            direct_res = await asyncio.wait_for(
                _fetch_direct_last_resort(video_id, direct_timeout, attempts),
                timeout=rem,
            )
            if direct_res:
                return direct_res
        except TimeoutError:
            rec = AttemptRecord(
                video_id=video_id,
                method="youtube_transcript_api_direct",
                stage="direct",
                http_status=None,
                bytes=0,
                duration_ms=int(direct_timeout * 1000),
                error_class="TimeoutError",
            )
            attempts.append(rec)
            _log_attempt(rec)
    else:
        try:
            proxy_res = await asyncio.wait_for(
                _fetch_proxy_stage(video_id, deadline, attempts, on_retry),
                timeout=rem,
            )
            if proxy_res:
                return proxy_res
            has_terminal_no_captions = True
        except TimeoutError:
            _raise_http_error(
                504,
                "INGEST_DEADLINE: transcript fetch exceeded deadline during proxy stage",
                attempts,
                video_id=video_id,
            )
        except Exception as e:
            logger.warning(
                "Proxy transcript fetch failed for %s: %s",
                video_id,
                e,
            )

    rem = _get_rem()
    if rem <= 0:
        _raise_http_error(
            504,
            "INGEST_DEADLINE: transcript fetch exceeded deadline",
            attempts,
            video_id=video_id,
        )

    if has_terminal_no_captions:
        _raise_http_error(
            422,
            "TRANSCRIPT_UNAVAILABLE: No captions available for video",
            attempts,
            video_id=video_id,
        )

    _raise_http_error(
        502,
        "UPSTREAM_BLOCKED: All transcript fetch paths were blocked or unavailable",
        attempts,
        video_id=video_id,
    )
