"""Skeleton tests for the Demucs_Service FastAPI app (task 1.1).

These verify the app imports, the three routes are mounted, and the shared
structured error body helper produces the documented envelope. Validation and
separation behavior are covered by later tasks (1.2-1.6).
"""

from fastapi.testclient import TestClient

from app.config import get_config
from app.errors import error_body
from app.main import app

client = TestClient(app)


def test_app_imports_and_has_routes():
    paths = {route.path for route in app.routes}
    assert "/separate" in paths
    assert "/health" in paths
    assert "/meta" in paths


def test_health_returns_ok_envelope():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == get_config().model
    assert "version" in body


def test_meta_returns_limits_and_accepted_formats():
    response = client.get("/meta")
    assert response.status_code == 200
    body = response.json()
    assert body["max_bytes"] == 104_857_600
    assert body["timeout_seconds"] == 600
    assert body["accepted"] == ["mp3", "wav"]


def test_separate_with_mocked_model_returns_success_body(monkeypatch):
    # A validated request invokes the separation boundary (task 1.3). The heavy
    # Demucs model is mocked so the success body shape can be asserted without
    # the torch/demucs stack installed.
    from app import separation

    def _fake_separate(audio_bytes, audio_format):
        return separation.RawSeparation(
            duration_seconds=42.0,
            stems={name: b"x" * 8 for name in separation.DEMUCS_STEMS},
        )

    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate)

    response = client.post(
        "/separate",
        files={"file": ("song.mp3", b"audio-bytes", "audio/mpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"job_id", "duration_seconds", "format", "stems"}
    assert set(body["stems"].keys()) == {"drums", "bass", "vocals", "other"}


def test_error_body_helper_shape():
    body = error_body("SOME_CODE", "a message", {"k": "v"})
    assert body == {
        "error": {
            "code": "SOME_CODE",
            "message": "a message",
            "details": {"k": "v"},
        }
    }
    # Defaults to empty details when none provided.
    assert error_body("C", "m")["error"]["details"] == {}
