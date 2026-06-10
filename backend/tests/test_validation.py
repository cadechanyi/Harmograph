"""Tests for ``POST /separate`` request validation (task 1.2).

Covers each rejection path of the design's API Contract error table:

    Missing/empty file field           -> 400 INVALID_REQUEST
    Body is not a Supported_Audio_Format -> 415 UNSUPPORTED_FORMAT
    File exceeds max separation size    -> 413 FILE_TOO_LARGE

_Requirements: 4.2, 4.3_
"""

import pytest
from fastapi.testclient import TestClient

from app.config import ACCEPTED_FORMATS, ServiceConfig
from app.main import app
from app.validation import is_supported_format

client = TestClient(app)


def _mock_separation(monkeypatch):
    """Patch the heavy Demucs model with a fast fake returning four stems.

    Lets validation tests that pass through to the separation step assert the
    200 success body without the torch/demucs stack installed.
    """
    from app import separation

    def _fake_separate(audio_bytes, audio_format):
        return separation.RawSeparation(
            duration_seconds=10.0,
            stems={name: b"audio" for name in separation.DEMUCS_STEMS},
        )

    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate)


def _assert_error_envelope(body: dict) -> dict:
    """Assert the structured error envelope shape and return the inner error."""
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message", "details"}
    return body["error"]


# --- Missing / empty file field -> 400 INVALID_REQUEST -----------------------


def test_missing_file_field_returns_400_invalid_request():
    response = client.post("/separate")
    assert response.status_code == 400
    error = _assert_error_envelope(response.json())
    assert error["code"] == "INVALID_REQUEST"


def test_empty_file_returns_400_invalid_request():
    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"", "audio/wav")},
    )
    assert response.status_code == 400
    error = _assert_error_envelope(response.json())
    assert error["code"] == "INVALID_REQUEST"


# --- Unsupported format -> 415 UNSUPPORTED_FORMAT ----------------------------


def test_unsupported_content_type_returns_415():
    response = client.post(
        "/separate",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 415
    error = _assert_error_envelope(response.json())
    assert error["code"] == "UNSUPPORTED_FORMAT"
    assert error["details"]["accepted"] == ["mp3", "wav"]


def test_unsupported_format_lists_accepted_formats():
    response = client.post(
        "/separate",
        files={"file": ("clip.ogg", b"oggdata", "audio/ogg")},
    )
    assert response.status_code == 415
    error = _assert_error_envelope(response.json())
    assert error["details"]["accepted"] == list(ACCEPTED_FORMATS)


# --- File too large -> 413 FILE_TOO_LARGE ------------------------------------


def test_oversize_file_returns_413_with_max_bytes(monkeypatch):
    # Override the config so the test does not allocate 100 MB.
    small_config = ServiceConfig(max_bytes=10)
    monkeypatch.setattr("app.main.get_config", lambda: small_config)
    max_bytes = small_config.max_bytes

    response = client.post(
        "/separate",
        files={"file": ("song.mp3", b"x" * (max_bytes + 1), "audio/mpeg")},
    )
    assert response.status_code == 413
    error = _assert_error_envelope(response.json())
    assert error["code"] == "FILE_TOO_LARGE"
    assert error["details"]["max_bytes"] == max_bytes


def test_file_at_max_size_passes_validation(monkeypatch):
    # A file exactly at the limit is accepted and reaches the separation step.
    small_config = ServiceConfig(max_bytes=16)
    monkeypatch.setattr("app.main.get_config", lambda: small_config)
    _mock_separation(monkeypatch)
    max_bytes = small_config.max_bytes

    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"y" * max_bytes, "audio/wav")},
    )
    # Validation passed -> separation runs and returns the 200 success body.
    assert response.status_code == 200
    assert set(response.json()["stems"].keys()) == {"drums", "bass", "vocals", "other"}


# --- Format accepted via extension fallback ----------------------------------


@pytest.mark.parametrize(
    "filename,content_type",
    [
        ("song.mp3", "application/octet-stream"),
        ("song.wav", "application/octet-stream"),
        ("song.MP3", None),
        ("song.WAV", None),
    ],
)
def test_supported_via_extension_fallback_passes_validation(filename, content_type, monkeypatch):
    _mock_separation(monkeypatch)
    files = {"file": (filename, b"audio-bytes", content_type)}
    response = client.post("/separate", files=files)
    # Recognized as a supported format -> reaches separation, returns 200.
    assert response.status_code == 200
    assert set(response.json()["stems"].keys()) == {"drums", "bass", "vocals", "other"}


# --- is_supported_format unit checks -----------------------------------------


@pytest.mark.parametrize(
    "content_type,filename,expected",
    [
        ("audio/mpeg", "song.mp3", True),
        ("audio/wav", "song.wav", True),
        ("audio/x-wav", None, True),
        ("audio/mpeg; charset=binary", "song.mp3", True),
        (None, "song.mp3", True),
        (None, "song.wav", True),
        ("application/octet-stream", "song.wav", True),
        ("text/plain", "notes.txt", False),
        ("audio/ogg", "clip.ogg", False),
        (None, None, False),
        (None, "noext", False),
    ],
)
def test_is_supported_format(content_type, filename, expected):
    assert is_supported_format(content_type, filename) is expected
