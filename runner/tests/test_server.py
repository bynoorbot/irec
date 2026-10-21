"""Tests for the home transcript runner service."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

# Ensure runner package/module is on path
runner_dir = Path(__file__).resolve().parent.parent
if str(runner_dir) not in sys.path:
    sys.path.insert(0, str(runner_dir))

import server
from server import app


@pytest.fixture(autouse=True)
def set_default_token(monkeypatch):
    """Set a default runner token for test cases."""
    monkeypatch.setenv("RUNNER_TOKEN", "test-secret-token-123")


def test_refuses_to_start_without_token(monkeypatch):
    """The service must refuse to start if RUNNER_TOKEN is unset."""
    monkeypatch.delenv("RUNNER_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="RUNNER_TOKEN environment variable must be set"):
        with TestClient(app):
            pass


def test_health_endpoint():
    """GET /health returns 200 and version info without auth."""
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "version" in data


def test_auth_rejection_missing_token():
    """Request without X-Runner-Token returns 401 UNAUTHORIZED."""
    with TestClient(app) as client:
        resp = client.get("/transcript?v=12345678901")
        assert resp.status_code == 401
        assert resp.json() == {"error_code": "UNAUTHORIZED"}


def test_auth_rejection_wrong_token():
    """Request with incorrect X-Runner-Token returns 401 UNAUTHORIZED."""
    with TestClient(app) as client:
        resp = client.get(
            "/transcript?v=12345678901",
            headers={"X-Runner-Token": "wrong-token"},
        )
        assert resp.status_code == 401
        assert resp.json() == {"error_code": "UNAUTHORIZED"}


def test_token_comparison_uses_env_value(monkeypatch):
    """Verifies that token comparison dynamically checks os.environ['RUNNER_TOKEN']."""
    with TestClient(app) as client:
        monkeypatch.setenv("RUNNER_TOKEN", "token-alpha")
        resp1 = client.get(
            "/transcript?v=12345678901",
            headers={"X-Runner-Token": "token-alpha"},
        )
        # Should pass auth (might fail later on fetch or validation, but not 401)
        assert resp1.status_code != 401

        resp1_wrong = client.get(
            "/transcript?v=12345678901",
            headers={"X-Runner-Token": "token-beta"},
        )
        assert resp1_wrong.status_code == 401

        # Now dynamically rotate the token
        monkeypatch.setenv("RUNNER_TOKEN", "token-beta")
        resp2 = client.get(
            "/transcript?v=12345678901",
            headers={"X-Runner-Token": "token-beta"},
        )
        assert resp2.status_code != 401

        resp2_old = client.get(
            "/transcript?v=12345678901",
            headers={"X-Runner-Token": "token-alpha"},
        )
        assert resp2_old.status_code == 401


@pytest.mark.parametrize(
    "invalid_v",
    [
        "",
        "too_short",
        "too_long_video_id_12345",
        "has!special#char$",
        "https://www.youtube.com/watch?v=12345678901",
    ],
)
def test_invalid_video_id(invalid_v):
    """Input validation enforces ^[A-Za-z0-9_-]{11}$ and rejects URLs/malformed IDs with 400."""
    with TestClient(app) as client:
        resp = client.get(
            f"/transcript?v={invalid_v}",
            headers={"X-Runner-Token": "test-secret-token-123"},
        )
        assert resp.status_code == 400
        assert resp.json().get("error_code") == "INVALID_VIDEO_ID"


def test_transcript_200_shape():
    """Successful fetch returns 200 with transcript, length, and lang."""
    expected_text = "Here is the video transcript content with plenty of words."
    with patch(
        "server._fetch_transcript_sync",
        return_value=(expected_text, "en"),
    ):
        with TestClient(app) as client:
            resp = client.get(
                "/transcript?v=abc123xyz99",
                headers={"X-Runner-Token": "test-secret-token-123"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["transcript"] == expected_text
            assert data["length"] == len(expected_text)
            assert data["lang"] == "en"


@pytest.mark.parametrize(
    "error_exc",
    [
        TranscriptsDisabled("abc123xyz99"),
        NoTranscriptFound("abc123xyz99", ["en"], MagicMock()),
        VideoUnavailable("abc123xyz99"),
    ],
)
def test_transcript_422_mapping(error_exc):
    """TranscriptsDisabled, NoTranscriptFound, and VideoUnavailable map to 422 NO_CAPTIONS."""
    with patch("server._fetch_transcript_sync", side_effect=error_exc):
        with TestClient(app) as client:
            resp = client.get(
                "/transcript?v=abc123xyz99",
                headers={"X-Runner-Token": "test-secret-token-123"},
            )
            assert resp.status_code == 422
            data = resp.json()
            assert data["error_code"] == "NO_CAPTIONS"


def test_transcript_502_mapping_on_blocked():
    """RequestBlocked or unexpected errors map to 502 UPSTREAM_BLOCKED."""
    with patch(
        "server._fetch_transcript_sync",
        side_effect=RequestBlocked("abc123xyz99"),
    ):
        with TestClient(app) as client:
            resp = client.get(
                "/transcript?v=abc123xyz99",
                headers={"X-Runner-Token": "test-secret-token-123"},
            )
            assert resp.status_code == 502
            data = resp.json()
            assert data["error_code"] == "UPSTREAM_BLOCKED"


def test_transcript_502_mapping_on_timeout():
    """Internal timeout maps to 502 UPSTREAM_BLOCKED."""
    def slow_fetch(v):
        import time
        time.sleep(1.0)
        return ("text", "en")

    with patch("server.INTERNAL_TIMEOUT", 0.05):
        with patch("server._fetch_transcript_sync", side_effect=slow_fetch):
            with TestClient(app) as client:
                resp = client.get(
                    "/transcript?v=abc123xyz99",
                    headers={"X-Runner-Token": "test-secret-token-123"},
                )
                assert resp.status_code == 502
                data = resp.json()
                assert data["error_code"] == "UPSTREAM_BLOCKED"
