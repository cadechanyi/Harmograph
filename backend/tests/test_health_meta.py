"""Tests for the GET /health and GET /meta endpoints (task 1.5).

These cover the design's API Contract for the two non-audio operations:

    GET /health -> 200 { status, model, version } when ready
    GET /meta   -> { max_bytes, timeout_seconds, accepted }

Both endpoints carry no audio data (Req 12.7): they expose no request body /
file parameters, accept only GET, and ignore any payload a client sends.
"""

from fastapi.testclient import TestClient

from app import __version__
from app.config import ACCEPTED_FORMATS, get_config
from app.main import app

client = TestClient(app)


# --- GET /health -----------------------------------------------------------


def test_health_returns_200_with_status_model_version():
    """GET /health returns 200 with exactly { status, model, version }."""
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"status", "model", "version"}
    assert body["status"] == "ok"
    assert body["model"] == get_config().model
    assert body["version"] == __version__


def test_health_only_allows_get():
    """/health is a readiness probe; non-GET methods are not allowed."""
    assert client.post("/health").status_code == 405
    assert client.put("/health").status_code == 405
    assert client.delete("/health").status_code == 405


def test_health_carries_no_audio_data():
    """Req 12.7: /health accepts no audio data.

    The endpoint declares no body/file parameters, so a payload sent by a
    client is ignored and the readiness response is unchanged.
    """
    audio_bytes = b"RIFF\x00\x00\x00\x00WAVEfake-audio-data"
    response = client.request("GET", "/health", content=audio_bytes)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_health_route_declares_no_request_parameters():
    """The /health handler takes no audio/body parameters (Req 12.7)."""
    health_routes = [r for r in app.routes if getattr(r, "path", None) == "/health"]
    assert health_routes, "GET /health route must be mounted"
    assert health_routes[0].dependant.body_params == []


# --- GET /meta -------------------------------------------------------------


def test_meta_returns_limits_and_accepted_formats():
    """GET /meta returns exactly { max_bytes, timeout_seconds, accepted }."""
    config = get_config()
    response = client.get("/meta")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"max_bytes", "timeout_seconds", "accepted"}
    assert body["max_bytes"] == config.max_bytes
    assert body["timeout_seconds"] == config.timeout_seconds
    assert body["accepted"] == list(ACCEPTED_FORMATS)


def test_meta_default_values_match_design_contract():
    """The documented MVP defaults are 100 MB / 600 s / [mp3, wav]."""
    body = client.get("/meta").json()
    assert body["max_bytes"] == 104_857_600
    assert body["timeout_seconds"] == 600
    assert body["accepted"] == ["mp3", "wav"]


def test_meta_only_allows_get():
    """/meta is a metadata probe; non-GET methods are not allowed."""
    assert client.post("/meta").status_code == 405
    assert client.put("/meta").status_code == 405
    assert client.delete("/meta").status_code == 405


def test_meta_carries_no_audio_data():
    """Req 12.7: /meta accepts no audio data; any payload is ignored."""
    audio_bytes = b"ID3fake-mp3-audio-data"
    response = client.request("GET", "/meta", content=audio_bytes)

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] == list(ACCEPTED_FORMATS)


def test_meta_route_declares_no_request_parameters():
    """The /meta handler takes no audio/body parameters (Req 12.7)."""
    meta_routes = [r for r in app.routes if getattr(r, "path", None) == "/meta"]
    assert meta_routes, "GET /meta route must be mounted"
    assert meta_routes[0].dependant.body_params == []
