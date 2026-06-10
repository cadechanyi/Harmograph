"""End-to-end API integration tests for the Demucs_Service (task 1.6).

Where the unit/focused suites (``test_validation.py``, ``test_separation.py``,
``test_server_errors.py``) exercise individual seams, this module drives the
**full API surface end-to-end** through the FastAPI ``TestClient``: a real
``POST /separate`` multipart request flowing through validation -> separation
boundary -> response rendering, asserting the complete documented contract.

It covers the design's API Contract for ``POST /separate`` in one cohesive
place:

* the 4-stem ``200 OK`` success body shape (Req 4.1), and
* every error path with its status code, structured error envelope, and the
  guarantee that **no stem files** are returned on any failure:

    Body is not a Supported_Audio_Format -> 415 UNSUPPORTED_FORMAT   (Req 4.2)
    File exceeds max separation size     -> 413 FILE_TOO_LARGE       (Req 4.3)
    Missing / empty file field           -> 400 INVALID_REQUEST      (Req 4.2 family)
    Separation failed during processing  -> 500 SEPARATION_FAILED    (Req 4.4)
    Processing exceeded max time         -> 504 PROCESSING_TIMEOUT   (Req 4.5)
    Resource exhaustion / unavailable    -> 503 SERVICE_UNAVAILABLE  (Req 4.6)

The heavy ``htdemucs`` model (torch + demucs) is not installable here, so the
model invocation (``separate_with_demucs``) is monkeypatched behind the
separation boundary. Validation and the response contract are exercised for
real.

_Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
"""

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app import separation
from app.config import ACCEPTED_FORMATS, ServiceConfig
from app.main import app
from app.separation import DEMUCS_STEMS, OUTPUT_FORMAT, RawSeparation

client = TestClient(app)

# The four stems htdemucs always returns, in documented order (Req 4.1).
EXPECTED_STEMS = {"drums", "bass", "vocals", "other"}


# --- Shared helpers ----------------------------------------------------------


def _install_fake_model(monkeypatch, *, duration_seconds: float = 180.0, stem_bytes: int = 2048):
    """Monkeypatch the heavy model with a fast fake returning four stems.

    Lets the success-path tests run end-to-end without torch/demucs installed.
    """

    def _fake_separate(audio_bytes, audio_format):
        return RawSeparation(
            duration_seconds=duration_seconds,
            stems={name: b"\x00" * stem_bytes for name in DEMUCS_STEMS},
        )

    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate)


def _post_audio(filename="song.wav", data=b"riff-wave-bytes", content_type="audio/wav"):
    """POST a multipart audio file to /separate."""
    return client.post("/separate", files={"file": (filename, data, content_type)})


def _assert_error_envelope(body: dict) -> dict:
    """Assert the { error: { code, message, details } } envelope; return inner."""
    assert set(body.keys()) == {"error"}, f"unexpected top-level keys: {body.keys()}"
    error = body["error"]
    assert set(error.keys()) == {"code", "message", "details"}
    assert isinstance(error["code"], str) and error["code"]
    assert isinstance(error["message"], str) and error["message"]
    assert isinstance(error["details"], dict)
    return error


def _assert_no_stem_files(body: dict) -> None:
    """No error response may carry stem files (every error path, Req 4.2-4.6)."""
    assert "stems" not in body
    assert "job_id" not in body
    assert "url" not in body


# --- 200 OK: 4-stem success body shape (Req 4.1) -----------------------------


def test_separate_success_returns_full_4_stem_body(monkeypatch):
    """A validated request returns the complete documented 200 success body."""
    _install_fake_model(monkeypatch, duration_seconds=213.4, stem_bytes=4096)

    response = _post_audio(filename="song.mp3", data=b"id3-audio", content_type="audio/mpeg")

    assert response.status_code == 200
    body = response.json()

    # Top-level shape: exactly the four documented keys.
    assert set(body.keys()) == {"job_id", "duration_seconds", "format", "stems"}

    # job_id is a valid UUID; duration and format match the contract.
    uuid.UUID(body["job_id"])
    assert body["duration_seconds"] == 213.4
    assert body["format"] == OUTPUT_FORMAT == "wav"

    # Exactly the four htdemucs stems, each a { url, bytes } entry (Req 4.1).
    assert set(body["stems"].keys()) == EXPECTED_STEMS
    for name in EXPECTED_STEMS:
        entry = body["stems"][name]
        assert set(entry.keys()) == {"url", "bytes"}
        # Each stem is a Supported_Audio_Format (WAV) download URL.
        assert entry["url"] == f"/stems/{body['job_id']}/{name}.wav"
        assert isinstance(entry["bytes"], int)
        assert entry["bytes"] == 4096


# --- 415 Unsupported Media Type (Req 4.2) ------------------------------------


def test_separate_unsupported_format_returns_415(monkeypatch):
    """A non-MP3/WAV body is rejected 415 with accepted formats and no stems."""
    # Patch the model to prove it is never reached on a validation failure.
    monkeypatch.setattr(
        separation,
        "separate_with_demucs",
        lambda *a, **k: pytest.fail("model must not run on unsupported format"),
    )

    response = _post_audio(filename="clip.ogg", data=b"oggdata", content_type="audio/ogg")

    assert response.status_code == 415
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "UNSUPPORTED_FORMAT"
    assert error["details"]["accepted"] == list(ACCEPTED_FORMATS)
    _assert_no_stem_files(body)


# --- 413 Payload Too Large (Req 4.3) -----------------------------------------


def test_separate_oversize_file_returns_413(monkeypatch):
    """A file exceeding max separation size is rejected 413 with no stems."""
    small_config = ServiceConfig(max_bytes=32)
    monkeypatch.setattr("app.main.get_config", lambda: small_config)
    monkeypatch.setattr(
        separation,
        "separate_with_demucs",
        lambda *a, **k: pytest.fail("model must not run on oversize file"),
    )

    response = _post_audio(data=b"x" * (small_config.max_bytes + 1))

    assert response.status_code == 413
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "FILE_TOO_LARGE"
    assert error["details"]["max_bytes"] == small_config.max_bytes
    _assert_no_stem_files(body)


# --- 400 Bad Request: missing / empty file field (Req 4.2 family) ------------


def test_separate_missing_file_field_returns_400():
    """A request with no file field is rejected 400 with no stems."""
    response = client.post("/separate")

    assert response.status_code == 400
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "INVALID_REQUEST"
    _assert_no_stem_files(body)


def test_separate_empty_file_returns_400():
    """A zero-byte file is rejected 400 with no stems."""
    response = _post_audio(data=b"")

    assert response.status_code == 400
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "INVALID_REQUEST"
    _assert_no_stem_files(body)


# --- 500 Internal Server Error: separation failed (Req 4.4) ------------------


def test_separate_separation_failure_returns_500(monkeypatch):
    """A failure during processing maps to 500 SEPARATION_FAILED with no stems."""

    def _fail(audio_bytes, audio_format):
        raise RuntimeError("demucs crashed mid-separation")

    monkeypatch.setattr(separation, "separate_with_demucs", _fail)

    response = _post_audio()

    assert response.status_code == 500
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "SEPARATION_FAILED"
    _assert_no_stem_files(body)


# --- 504 Gateway Timeout: processing exceeded max time (Req 4.5) -------------


def test_separate_timeout_returns_504(monkeypatch):
    """Separation exceeding the max processing time maps to 504 with no stems."""
    timeout_config = ServiceConfig(timeout_seconds=0)
    monkeypatch.setattr("app.main.get_config", lambda: timeout_config)

    def _slow(audio_bytes, audio_format):
        time.sleep(0.5)
        return RawSeparation(
            duration_seconds=10.0,
            stems={name: b"audio" for name in DEMUCS_STEMS},
        )

    monkeypatch.setattr(separation, "separate_with_demucs", _slow)

    response = _post_audio()

    assert response.status_code == 504
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "PROCESSING_TIMEOUT"
    assert error["details"]["timeout_seconds"] == 0
    _assert_no_stem_files(body)


# --- 503 Service Unavailable: resource exhaustion (Req 4.6) ------------------


def test_separate_resource_exhaustion_returns_503(monkeypatch):
    """Resource exhaustion (OOM) maps to 503 SERVICE_UNAVAILABLE with no stems."""

    def _oom(audio_bytes, audio_format):
        raise MemoryError("out of memory")

    monkeypatch.setattr(separation, "separate_with_demucs", _oom)

    response = _post_audio()

    assert response.status_code == 503
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "SERVICE_UNAVAILABLE"
    _assert_no_stem_files(body)


# --- Cross-cutting: every error path shares the structured envelope ----------


def test_all_error_paths_share_structured_envelope_and_omit_stems(monkeypatch):
    """Sweep every documented failure: correct status + envelope + no stems.

    A single end-to-end sweep asserting the design's error table holds uniformly
    across 415 / 413 / 400 / 500 / 504 / 503 (Req 4.2-4.6).
    """
    # 415 unsupported format.
    r415 = _post_audio(filename="x.txt", data=b"text", content_type="text/plain")
    assert r415.status_code == 415

    # 413 too large.
    small_config = ServiceConfig(max_bytes=8)
    monkeypatch.setattr("app.main.get_config", lambda: small_config)
    r413 = _post_audio(data=b"y" * 64)
    monkeypatch.undo()  # restore default config for subsequent cases
    assert r413.status_code == 413

    # 400 empty file.
    r400 = _post_audio(data=b"")
    assert r400.status_code == 400

    # 500 separation failed.
    monkeypatch.setattr(
        separation, "separate_with_demucs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    r500 = _post_audio()
    assert r500.status_code == 500

    # 503 resource exhaustion.
    monkeypatch.setattr(
        separation, "separate_with_demucs", lambda *a, **k: (_ for _ in ()).throw(MemoryError("oom"))
    )
    r503 = _post_audio()
    assert r503.status_code == 503

    # 504 timeout.
    timeout_config = ServiceConfig(timeout_seconds=0)
    monkeypatch.setattr("app.main.get_config", lambda: timeout_config)

    def _slow(audio_bytes, audio_format):
        time.sleep(0.5)
        return RawSeparation(duration_seconds=1.0, stems={n: b"a" for n in DEMUCS_STEMS})

    monkeypatch.setattr(separation, "separate_with_demucs", _slow)
    r504 = _post_audio()
    assert r504.status_code == 504

    # Every error response: structured envelope, no stem files.
    for response in (r415, r413, r400, r500, r503, r504):
        body = response.json()
        _assert_error_envelope(body)
        _assert_no_stem_files(body)
