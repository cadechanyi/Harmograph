"""Tests for processing-timeout and server-error handling in ``POST /separate`` (task 1.4).

These exercise the design's API Contract server-error table by injecting
failing / slow / out-of-memory separation functions behind the separation
boundary and asserting the documented status codes, structured error bodies,
and that **no stem files** are returned on any error path:

    Separation failed during processing -> 500 SEPARATION_FAILED   (Req 4.4)
    Processing exceeded max time        -> 504 PROCESSING_TIMEOUT  (Req 4.5)
    Resource exhaustion / unavailable   -> 503 SERVICE_UNAVAILABLE (Req 4.6)

_Requirements: 4.4, 4.5, 4.6_
"""

import time

import pytest
from fastapi.testclient import TestClient

from app import separation
from app.config import ServiceConfig
from app.errors import ServiceError
from app.main import app
from app.separation import (
    DEMUCS_STEMS,
    RawSeparation,
    ResourceUnavailableError,
    SeparationFailedError,
    run_separation_guarded,
)

client = TestClient(app)

CONFIG = ServiceConfig()


def _good_raw() -> RawSeparation:
    return RawSeparation(
        duration_seconds=10.0,
        stems={name: b"audio" for name in DEMUCS_STEMS},
    )


def _assert_error_envelope(body: dict) -> dict:
    """Assert the structured error envelope shape and return the inner error."""
    assert set(body.keys()) == {"error"}
    assert set(body["error"].keys()) == {"code", "message", "details"}
    return body["error"]


# --- run_separation_guarded (unit) -------------------------------------------


def test_guarded_success_passes_through():
    def _fn(audio_bytes, audio_format):
        return _good_raw()

    result = run_separation_guarded(b"audio", "wav", CONFIG, separate_fn=_fn)
    assert set(result.stems.keys()) == set(DEMUCS_STEMS)


def test_guarded_runtime_error_maps_to_500():
    def _fn(audio_bytes, audio_format):
        raise RuntimeError("model blew up")

    with pytest.raises(ServiceError) as excinfo:
        run_separation_guarded(b"audio", "wav", CONFIG, separate_fn=_fn)
    assert excinfo.value.status_code == 500
    assert excinfo.value.code == "SEPARATION_FAILED"


def test_guarded_separation_failed_error_maps_to_500():
    def _fn(audio_bytes, audio_format):
        raise SeparationFailedError("separation failed")

    with pytest.raises(ServiceError) as excinfo:
        run_separation_guarded(b"audio", "wav", CONFIG, separate_fn=_fn)
    assert excinfo.value.status_code == 500
    assert excinfo.value.code == "SEPARATION_FAILED"


def test_guarded_memory_error_maps_to_503():
    def _fn(audio_bytes, audio_format):
        raise MemoryError("out of memory")

    with pytest.raises(ServiceError) as excinfo:
        run_separation_guarded(b"audio", "wav", CONFIG, separate_fn=_fn)
    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "SERVICE_UNAVAILABLE"


def test_guarded_resource_unavailable_maps_to_503():
    def _fn(audio_bytes, audio_format):
        raise ResourceUnavailableError("no capacity")

    with pytest.raises(ServiceError) as excinfo:
        run_separation_guarded(b"audio", "wav", CONFIG, separate_fn=_fn)
    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "SERVICE_UNAVAILABLE"


def test_guarded_timeout_maps_to_504_with_timeout_seconds():
    # A zero-second timeout fires before a slow separation can complete.
    timeout_config = ServiceConfig(timeout_seconds=0)

    def _slow_fn(audio_bytes, audio_format):
        time.sleep(0.5)
        return _good_raw()

    with pytest.raises(ServiceError) as excinfo:
        run_separation_guarded(b"audio", "wav", timeout_config, separate_fn=_slow_fn)
    assert excinfo.value.status_code == 504
    assert excinfo.value.code == "PROCESSING_TIMEOUT"
    assert excinfo.value.detail["error"]["details"]["timeout_seconds"] == 0


# --- Endpoint integration (mocked model) -------------------------------------


def test_separate_endpoint_500_on_separation_failure(monkeypatch):
    def _fail(audio_bytes, audio_format):
        raise RuntimeError("demucs crashed")

    monkeypatch.setattr(separation, "separate_with_demucs", _fail)
    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"riff-bytes", "audio/wav")},
    )
    assert response.status_code == 500
    error = _assert_error_envelope(response.json())
    assert error["code"] == "SEPARATION_FAILED"
    # No stem files on the error path.
    assert "stems" not in response.json()


def test_separate_endpoint_503_on_resource_exhaustion(monkeypatch):
    def _oom(audio_bytes, audio_format):
        raise MemoryError("OOM")

    monkeypatch.setattr(separation, "separate_with_demucs", _oom)
    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"riff-bytes", "audio/wav")},
    )
    assert response.status_code == 503
    error = _assert_error_envelope(response.json())
    assert error["code"] == "SERVICE_UNAVAILABLE"
    assert "stems" not in response.json()


def test_separate_endpoint_504_on_timeout(monkeypatch):
    timeout_config = ServiceConfig(timeout_seconds=0)
    monkeypatch.setattr("app.main.get_config", lambda: timeout_config)

    def _slow(audio_bytes, audio_format):
        time.sleep(0.5)
        return _good_raw()

    monkeypatch.setattr(separation, "separate_with_demucs", _slow)
    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"riff-bytes", "audio/wav")},
    )
    assert response.status_code == 504
    body = response.json()
    error = _assert_error_envelope(body)
    assert error["code"] == "PROCESSING_TIMEOUT"
    assert error["details"]["timeout_seconds"] == 0
    assert "stems" not in body


def test_validation_precedence_over_server_errors(monkeypatch):
    # Even when the model would fail, a validation error is decided first:
    # an empty file is rejected with 400 before separation runs.
    def _fail(audio_bytes, audio_format):
        raise RuntimeError("should never be called")

    monkeypatch.setattr(separation, "separate_with_demucs", _fail)
    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"", "audio/wav")},
    )
    assert response.status_code == 400
    error = _assert_error_envelope(response.json())
    assert error["code"] == "INVALID_REQUEST"
