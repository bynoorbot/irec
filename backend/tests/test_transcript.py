"""Tests for the transcript fetcher module."""

import asyncio
import logging
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.transcript import (
    AttemptRecord,
    RequestBlocked,
    _fetch_direct_last_resort,
    _fetch_via_worker,
    _fetch_with_retry,
    _raise_http_error,
    fetch_transcript,
)


class FakeSnippet:
    """Mimics a transcript snippet with a .text attribute."""

    def __init__(self, text: str):
        self.text = text


class FakeResult:
    """Mimics the result of api.fetch() with a .snippets attribute."""

    def __init__(self, snippets: list[FakeSnippet]):
        self.snippets = snippets


async def _fake_to_thread(fn, *args, **kwargs):
    """Replacement for asyncio.to_thread that calls fn synchronously."""
    return fn(*args, **kwargs)


@pytest.mark.asyncio
async def test_fetch_transcript_success_via_ytdlp():
    """Test successful transcript retrieval via yt-dlp."""
    with patch(
        "app.transcript._fetch_transcript_ytdlp",
        return_value="Hello everyone today we discuss stocks like AAPL and TSLA in detail",
    ):
        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            result = await fetch_transcript("abc123xyz99")

    assert result == "Hello everyone today we discuss stocks like AAPL and TSLA in detail"


@pytest.mark.asyncio
async def test_fetch_transcript_single_segment_via_ytdlp():
    """Test transcript with >= 50 chars content via yt-dlp."""
    text_50_plus = "This is a single segment transcript with more than fifty characters."
    with patch("app.transcript._fetch_transcript_ytdlp", return_value=text_50_plus):
        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            result = await fetch_transcript("abc123xyz99")

    assert result == text_50_plus


@pytest.mark.asyncio
async def test_fetch_transcript_falls_back_to_proxy_when_ytdlp_fails():
    """Test that proxy method is used when yt-dlp returns None and PROXY_ENABLED is True."""
    fake_result = FakeResult([
        FakeSnippet("From proxy method with enough characters to satisfy fifty length minimum"),
        FakeSnippet("and additional details"),
    ])

    with patch("app.transcript.PROXY_ENABLED", True):
        with patch("app.transcript._fetch_transcript_ytdlp", return_value=None):
            with patch("app.transcript._build_api") as mock_build:
                mock_api = MagicMock()
                mock_api.fetch.return_value = fake_result
                mock_build.return_value = mock_api

                with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                    result = await fetch_transcript("abc123xyz99")

    assert "From proxy method" in result


@pytest.mark.asyncio
async def test_fetch_transcript_all_methods_fail():
    """Test 422 when both yt-dlp and proxy methods fail with TranscriptsDisabled."""
    from youtube_transcript_api._errors import TranscriptsDisabled

    with patch("app.transcript.PROXY_ENABLED", True):
        with patch("app.transcript._fetch_transcript_ytdlp", return_value=None):
            with patch("app.transcript._build_api") as mock_build:
                mock_api = MagicMock()
                mock_api.fetch.side_effect = TranscriptsDisabled("abc123xyz99")
                mock_api.list.side_effect = Exception("No transcripts")
                mock_build.return_value = mock_api

                with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                    with pytest.raises(HTTPException) as exc_info:
                        await fetch_transcript("abc123xyz99")

    assert exc_info.value.status_code == 422
    assert "unavailable" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_fetch_transcript_space_separator():
    """Test that segments are joined with a single space separator."""
    text_sample = "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11"
    with patch(
        "app.transcript._fetch_transcript_ytdlp",
        return_value=text_sample,
    ):
        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            result = await fetch_transcript("abc123xyz99")

    assert result == text_sample
    assert "  " not in result


@pytest.mark.asyncio
async def test_fetch_transcript_retries_on_rate_limit():
    """Test retry logic on retryable errors (proxy path, after yt-dlp fails)."""
    fake_result = FakeResult([
        FakeSnippet("Success after retry with plenty of text to exceed fifty characters easily!"),
    ])

    call_count = 0

    def fetch_with_failure(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("429 Too Many Requests")
        return fake_result

    retry_calls: list[tuple] = []

    def on_retry(attempt, max_retries, error, delay):
        retry_calls.append((attempt, max_retries, error, delay))

    with patch("app.transcript.PROXY_ENABLED", True):
        with patch("app.transcript._fetch_transcript_ytdlp", return_value=None):
            with patch("app.transcript._build_api") as mock_build:
                mock_api = MagicMock()
                mock_api.fetch.side_effect = fetch_with_failure
                mock_build.return_value = mock_api

                with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                    with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                        result = await fetch_transcript("abc123xyz99", on_retry=on_retry)

    assert "Success after retry" in result
    actual_retries = [r for r in retry_calls if r[0] > 0]
    assert len(actual_retries) == 1
    assert actual_retries[0][0] == 1  # attempt 1


@pytest.mark.asyncio
async def test_fetch_with_retry_request_blocked():
    """Test that RequestBlocked errors trigger retry with fresh proxy."""
    fake_result = FakeResult([
        FakeSnippet("Got it after proxy block was encountered on previous attempt"),
    ])
    call_count = 0

    def fetch_side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RequestBlocked("rB6hoJTQYP8")
        return fake_result

    retry_calls: list[tuple] = []

    def on_retry(attempt, max_retries, error, delay):
        retry_calls.append((attempt, max_retries, error, delay))

    with patch("app.transcript._build_api") as mock_build:
        mock_api = MagicMock()
        mock_api.fetch.side_effect = fetch_side_effect
        mock_build.return_value = mock_api

        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                attempts: list[AttemptRecord] = []
                result = await _fetch_with_retry(
                    "rB6hoJTQYP8",
                    deadline=1e9,
                    attempts=attempts,
                    on_retry=on_retry,
                )

    assert "Got it after proxy block" in " ".join(s.text for s in result.snippets)
    assert len(retry_calls) == 1
    assert "blocked" in retry_calls[0][2].lower()


@pytest.mark.asyncio
async def test_worker_terminal_no_captions_not_retried():
    """Worker 422 NO_CAPTIONS is terminal: never retried and raises 422 immediately."""
    fake_resp = MagicMock()
    fake_resp.status_code = 422
    fake_resp.content = b'{"error":"No caption tracks","error_code":"NO_CAPTIONS"}'
    fake_resp.json.return_value = {"error": "No caption tracks", "error_code": "NO_CAPTIONS"}

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_resp
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
        with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await fetch_transcript("abc123xyz99")

    assert exc_info.value.status_code == 422
    assert "TRANSCRIPT_UNAVAILABLE" in exc_info.value.detail
    # Must only be called once (no retry for terminal error)
    assert mock_client.get.call_count == 1
    assert hasattr(exc_info.value, "attempts")
    assert len(exc_info.value.attempts) == 1
    assert exc_info.value.attempts[0].error_class == "HTTP_422_NO_CAPTIONS"


@pytest.mark.asyncio
async def test_worker_retryable_error_retried_once():
    """Worker 502 error is retryable: retries once and returns successful transcript."""
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"Upstream error","error_code":"UPSTREAM_502"}'
    fake_502.json.return_value = {"error": "Upstream error", "error_code": "UPSTREAM_502"}

    valid_text = "Success transcript text here that has definitely more than fifty characters total"
    fake_200 = MagicMock()
    fake_200.status_code = 200
    fake_200.content = b'{"transcript":"' + valid_text.encode() + b'","lang":"en"}'
    fake_200.json.return_value = {
        "transcript": valid_text,
        "length": len(valid_text),
        "lang": "en",
    }

    mock_client = AsyncMock()
    mock_client.get.side_effect = [fake_502, fake_200]
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
        with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
            with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                result = await fetch_transcript("abc123xyz99")

    assert result == valid_text
    assert mock_client.get.call_count == 2


@pytest.mark.asyncio
async def test_worker_success_records_lang_in_stage():
    """Worker success with lang='en' records stage as 'transcript:en'."""
    valid_text = "Hello world stocks with enough characters to pass the fifty length threshold."
    fake_200 = MagicMock()
    fake_200.status_code = 200
    fake_200.content = b'{"transcript":"' + valid_text.encode() + b'","lang":"en"}'
    fake_200.json.return_value = {
        "transcript": valid_text,
        "length": len(valid_text),
        "lang": "en",
    }

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_200
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    attempts: list[AttemptRecord] = []
    with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
        with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
            res = await _fetch_via_worker("vid123", deadline=1e9, attempts=attempts)

    assert res == valid_text
    assert len(attempts) == 1
    assert attempts[0].stage == "transcript:en"


@pytest.mark.asyncio
async def test_short_transcript_rejected_as_empty_transcript():
    """Transcripts below 50 chars are rejected on worker path and recorded as EmptyTranscript."""
    # Worker returns 20 chars (< 50)
    fake_200 = MagicMock()
    fake_200.status_code = 200
    fake_200.content = b'{"transcript":"Too short"}'
    fake_200.json.return_value = {"transcript": "Too short"}

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_200
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    attempts: list[AttemptRecord] = []
    with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
        with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
            res = await _fetch_via_worker("vid123", deadline=1e9, attempts=attempts)

    assert res is None
    assert len(attempts) == 1
    assert attempts[0].error_class == "EmptyTranscript"


@pytest.mark.asyncio
async def test_worker_200_empty_body_not_accepted():
    """Worker 200 with empty transcript is not accepted, falls through."""
    fake_empty_200 = MagicMock()
    fake_empty_200.status_code = 200
    fake_empty_200.content = b'{"transcript":"","length":0}'
    fake_empty_200.json.return_value = {"transcript": "", "length": 0}

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_empty_200
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    valid_fallback = "Fallback ytdlp with more than fifty characters to pass length check successfully."
    with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
        with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
            with patch("app.transcript.PROXY_ENABLED", True):
                with patch("app.transcript._fetch_transcript_ytdlp", return_value=valid_fallback):
                    with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                        result = await fetch_transcript("abc123xyz99")

    assert result == valid_fallback


@pytest.mark.asyncio
async def test_hanging_stage_yields_504_within_deadline():
    """A stage that hangs beyond the deadline is cancelled by wait_for, raising 504."""
    async def slow_ytdlp(*args, **kwargs):
        await asyncio.sleep(5.0)
        return "Should never return"

    with patch("app.transcript.TRANSCRIPT_DEADLINE_SECONDS", 0.05):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", ""):
            with patch("app.transcript.asyncio.to_thread", side_effect=slow_ytdlp):
                t0 = time.monotonic()
                with pytest.raises(HTTPException) as exc_info:
                    await fetch_transcript("hanging_vid")
                elapsed = time.monotonic() - t0

    assert exc_info.value.status_code == 504
    assert "INGEST_DEADLINE" in exc_info.value.detail
    assert elapsed < 1.0


@pytest.mark.asyncio
async def test_ytdlp_skipped_when_proxy_disabled_and_worker_configured():
    """When PROXY_ENABLED is False and worker is configured, yt-dlp is skipped to prevent IP block."""
    mock_client = AsyncMock()
    fake_500 = MagicMock()
    fake_500.status_code = 500
    fake_500.content = b'{"error":"Server error"}'
    fake_500.json.return_value = {"error": "Server error"}
    mock_client.get.return_value = fake_500
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("app.transcript._fetch_transcript_ytdlp") as mock_ytdlp:
                        with patch("app.transcript._fetch_direct_last_resort", return_value=None):
                            with pytest.raises(HTTPException) as exc_info:
                                await fetch_transcript("abc123xyz99")

    mock_ytdlp.assert_not_called()
    attempts = getattr(exc_info.value, "attempts", [])
    ytdlp_attempts = [a for a in attempts if a.method == "ytdlp"]
    assert len(ytdlp_attempts) == 1
    assert ytdlp_attempts[0].error_class == "skipped:no_proxy"


@pytest.mark.asyncio
async def test_ytdlp_runs_when_worker_url_empty_and_proxy_disabled():
    """When TRANSCRIPT_WORKER_URL is empty (dev/residential), yt-dlp runs direct even if PROXY_ENABLED is False."""
    valid_text = "Dev direct yt-dlp returning transcript with plenty of characters exceeding fifty"
    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", ""):
            with patch("app.transcript._fetch_transcript_ytdlp", return_value=valid_text) as mock_ytdlp:
                with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                    result = await fetch_transcript("abc123xyz99")

    assert result == valid_text
    assert mock_ytdlp.call_count == 1


@pytest.mark.asyncio
async def test_raise_http_error_summary_logging(caplog):
    """_raise_http_error logs a single summary line with video_id and ordered flow."""
    attempts = [
        AttemptRecord("test_vid_123", "worker", "fetch", 502, 20, 100, "HTTP_502_UPSTREAM_502"),
        AttemptRecord("test_vid_123", "ytdlp", "skip_check", None, 0, 0, "skipped:no_proxy"),
        AttemptRecord("test_vid_123", "youtube_transcript_api_proxy", "proxy_check", None, 0, 0, "skipped:no_proxy"),
    ]

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as exc_info:
            _raise_http_error(
                502,
                "UPSTREAM_BLOCKED: All paths blocked",
                attempts,
                video_id="test_vid_123",
            )

    assert exc_info.value.status_code == 502
    expected_flow = "worker:HTTP_502_UPSTREAM_502 -> ytdlp:skipped:no_proxy -> youtube_transcript_api_proxy:skipped:no_proxy"
    assert any(
        "test_vid_123" in record.message and expected_flow in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_deadline_exceeded_raises_504():
    """Total deadline exhaustion raises HTTPException 504 INGEST_DEADLINE."""
    with patch("app.transcript.TRANSCRIPT_DEADLINE_SECONDS", 0.0):
        with pytest.raises(HTTPException) as exc_info:
            await fetch_transcript("abc123xyz99")

    assert exc_info.value.status_code == 504
    assert "INGEST_DEADLINE" in exc_info.value.detail


@pytest.mark.asyncio
async def test_fetch_with_retry_proxy_tunnel_fatal():
    """ProxyError or 502 tunnel failure breaks out immediately without retrying."""
    with patch("app.transcript._build_api") as mock_build:
        mock_api = MagicMock()
        mock_api.fetch.side_effect = Exception("502 Tunnel Connection Failed")
        mock_build.return_value = mock_api

        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            with patch("app.transcript.asyncio.sleep", new=AsyncMock()) as mock_sleep:
                attempts: list[AttemptRecord] = []
                with pytest.raises(Exception):
                    await _fetch_with_retry(
                        "abc123xyz99",
                        deadline=1e9,
                        attempts=attempts,
                    )

    assert len(attempts) == 1
    mock_sleep.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_with_retry_no_sleep_after_final_attempt():
    """When retries are exhausted, do not sleep after the final attempt."""
    with patch("app.transcript._build_api") as mock_build:
        mock_api = MagicMock()
        mock_api.fetch.side_effect = RequestBlocked("abc123xyz99")
        mock_build.return_value = mock_api

        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
            with patch("app.transcript.asyncio.sleep", new=AsyncMock()) as mock_sleep:
                attempts: list[AttemptRecord] = []
                with pytest.raises(RequestBlocked):
                    await _fetch_with_retry(
                        "abc123xyz99",
                        deadline=1e9,
                        attempts=attempts,
                    )

    assert len(attempts) == 2
    # Sleep should be called exactly once (after attempt 1, NOT after attempt 2)
    assert mock_sleep.call_count == 1


@pytest.mark.asyncio
async def test_direct_last_resort_runs_when_proxy_disabled_and_succeeds():
    """When PROXY_ENABLED is False and worker/ytdlp fail, direct last resort runs and succeeds."""
    mock_client = AsyncMock()
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"Upstream error","error_code":"UPSTREAM_502"}'
    fake_502.json.return_value = {"error": "Upstream error", "error_code": "UPSTREAM_502"}
    mock_client.get.return_value = fake_502
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    valid_text = "Direct last resort transcript with plenty of text exceeding fifty characters threshold"
    fake_result = FakeResult([FakeSnippet(valid_text)])

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("youtube_transcript_api.YouTubeTranscriptApi.fetch", return_value=fake_result) as mock_fetch:
                        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                            result = await fetch_transcript("abc123xyz99")

    assert result == valid_text
    assert mock_fetch.call_count == 1


@pytest.mark.asyncio
async def test_direct_last_resort_records_blocked_error_and_raises_502():
    """When direct last resort encounters RequestBlocked, it records the attempt and raises 502."""
    mock_client = AsyncMock()
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"Upstream error","error_code":"UPSTREAM_502"}'
    fake_502.json.return_value = {"error": "Upstream error", "error_code": "UPSTREAM_502"}
    mock_client.get.return_value = fake_502
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("youtube_transcript_api.YouTubeTranscriptApi.fetch", side_effect=RequestBlocked("abc123xyz99")):
                        with patch("app.transcript.asyncio.to_thread", side_effect=_fake_to_thread):
                            with pytest.raises(HTTPException) as exc_info:
                                await fetch_transcript("abc123xyz99")

    assert exc_info.value.status_code == 502
    assert "UPSTREAM_BLOCKED" in exc_info.value.detail
    attempts = getattr(exc_info.value, "attempts", [])
    direct_attempts = [a for a in attempts if a.method == "youtube_transcript_api_direct"]
    assert len(direct_attempts) == 1
    assert direct_attempts[0].error_class == "RequestBlocked"


@pytest.mark.asyncio
async def test_direct_last_resort_skipped_when_deadline_exhausted():
    """When deadline is exhausted before method 3, direct last resort is skipped and 504 is raised."""
    mock_client = AsyncMock()
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"Upstream error","error_code":"UPSTREAM_502"}'
    fake_502.json.return_value = {"error": "Upstream error", "error_code": "UPSTREAM_502"}
    mock_client.get.return_value = fake_502
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    clock_time = 0.0

    def mock_clock():
        return clock_time

    async def advance_after_worker(*args, **kwargs):
        nonlocal clock_time
        # Advance clock beyond deadline (deadline is 0.0 + 25 = 25.0)
        clock_time = 30.0
        return fake_502

    mock_client.get.side_effect = advance_after_worker

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("app.transcript._fetch_direct_last_resort") as mock_direct:
                        with patch("app.transcript.time.monotonic", side_effect=mock_clock):
                            with pytest.raises(HTTPException) as exc_info:
                                await fetch_transcript("abc123xyz99")

    assert exc_info.value.status_code == 504
    assert "INGEST_DEADLINE" in exc_info.value.detail
    mock_direct.assert_not_called()


@pytest.mark.asyncio
async def test_worker_upstream_empty_retried_once():
    """Worker UPSTREAM_EMPTY (502) is retried once and is never terminal."""
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"All candidate URLs returned empty","error_code":"UPSTREAM_EMPTY"}'
    fake_502.json.return_value = {"error": "All candidate URLs returned empty", "error_code": "UPSTREAM_EMPTY"}

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_502
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("app.transcript._fetch_direct_last_resort", return_value=None):
                        with pytest.raises(HTTPException) as exc_info:
                            await fetch_transcript("abc123xyz99")

    # Worker was retried once -> total 2 calls
    assert mock_client.get.call_count == 2
    # Not terminal -> raises 502 UPSTREAM_BLOCKED, not 422
    assert exc_info.value.status_code == 502
    assert "UPSTREAM_BLOCKED" in exc_info.value.detail


@pytest.mark.asyncio
async def test_worker_upstream_botwall_retried_once_never_terminal():
    """Worker UPSTREAM_BOTWALL (502) is retryable, retried once when fast, never terminal."""
    fake_botwall = MagicMock()
    fake_botwall.status_code = 502
    fake_botwall.content = b'{"error":"Video not playable: Sign in to confirm you are not a bot","error_code":"UPSTREAM_BOTWALL"}'
    fake_botwall.json.return_value = {
        "error": "Video not playable: Sign in to confirm you are not a bot",
        "error_code": "UPSTREAM_BOTWALL",
    }

    mock_client = AsyncMock()
    mock_client.get.return_value = fake_botwall
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.asyncio.sleep", new=AsyncMock()):
                    with patch("app.transcript._fetch_direct_last_resort", return_value=None):
                        with pytest.raises(HTTPException) as exc_info:
                            await fetch_transcript("abc123xyz99")

    # Worker was retried once (call_count == 2)
    assert mock_client.get.call_count == 2
    # Never terminal 422 -> final status 502
    assert exc_info.value.status_code == 502
    assert "UPSTREAM_BLOCKED" in exc_info.value.detail


@pytest.mark.asyncio
async def test_worker_slow_failure_not_retried():
    """Worker failure that took over 5 seconds is NOT retried."""
    fake_502 = MagicMock()
    fake_502.status_code = 502
    fake_502.content = b'{"error":"Slow failure","error_code":"UPSTREAM_502"}'
    fake_502.json.return_value = {"error": "Slow failure", "error_code": "UPSTREAM_502"}

    clock_time = 100.0

    def mock_clock():
        return clock_time

    async def fake_slow_get(*args, **kwargs):
        nonlocal clock_time
        # Advance clock by 5.5 seconds during the HTTP request to simulate slow response
        clock_time += 5.5
        return fake_502

    mock_client = AsyncMock()
    mock_client.get.side_effect = fake_slow_get
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None

    with patch("app.transcript.PROXY_ENABLED", False):
        with patch("app.transcript.TRANSCRIPT_WORKER_URL", "https://worker.test"):
            with patch("app.transcript.httpx.AsyncClient", return_value=mock_client):
                with patch("app.transcript.time.monotonic", side_effect=mock_clock):
                    with patch("app.transcript._fetch_direct_last_resort", return_value=None):
                        with pytest.raises(HTTPException):
                            await fetch_transcript("abc123xyz99")

    # Exactly 1 call because duration (5500ms > 5000ms) prevents retry
    assert mock_client.get.call_count == 1
