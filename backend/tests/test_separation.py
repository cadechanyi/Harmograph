"""Tests for Demucs stem separation in ``POST /separate`` (task 1.3).

The actual ``htdemucs`` model (torch + demucs) is not installable in this
environment, so these tests mock the model invocation behind the separation
boundary and assert the documented success body shape (design API Contract,
``POST /separate`` 200 OK):

    { "job_id", "duration_seconds", "format", "stems": { drums, bass, vocals, other } }

where each stem entry is ``{ "url", "bytes" }``.

_Requirements: 4.1_
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app import separation
from app.config import ServiceConfig
from app.main import app
from app.separation import (
    DEMUCS_STEMS,
    OUTPUT_FORMAT,
    RawSeparation,
    SeparationResult,
    StemFile,
    run_separation,
)

client = TestClient(app)

CONFIG = ServiceConfig()


def _fake_raw(duration_seconds: float = 30.0, stem_bytes: int = 1024) -> RawSeparation:
    """Build a fake RawSeparation with the four Demucs stems."""
    return RawSeparation(
        duration_seconds=duration_seconds,
        stems={name: b"\x00" * stem_bytes for name in DEMUCS_STEMS},
    )


def _fake_separate_fn(duration_seconds: float = 30.0, stem_bytes: int = 1024):
    def _fn(audio_bytes: bytes, audio_format: str) -> RawSeparation:
        return _fake_raw(duration_seconds, stem_bytes)

    return _fn


# --- run_separation (unit) ---------------------------------------------------


def test_run_separation_returns_four_demucs_stems():
    result = run_separation(
        b"audio", "wav", CONFIG, separate_fn=_fake_separate_fn()
    )
    assert isinstance(result, SeparationResult)
    assert set(result.stems.keys()) == {"drums", "bass", "vocals", "other"}


def test_run_separation_success_body_shape():
    result = run_separation(
        b"audio", "wav", CONFIG, separate_fn=_fake_separate_fn(duration_seconds=213.4)
    )
    body = result.to_body()

    assert set(body.keys()) == {"job_id", "duration_seconds", "format", "stems"}
    assert body["duration_seconds"] == 213.4
    assert body["format"] == OUTPUT_FORMAT == "wav"

    # job_id is a valid UUID string.
    uuid.UUID(body["job_id"])

    for name in DEMUCS_STEMS:
        entry = body["stems"][name]
        assert set(entry.keys()) == {"url", "bytes"}
        assert entry["url"] == f"/stems/{body['job_id']}/{name}.wav"
        assert isinstance(entry["bytes"], int)


def test_run_separation_reports_each_stem_byte_count():
    result = run_separation(
        b"audio", "wav", CONFIG, separate_fn=_fake_separate_fn(stem_bytes=4096)
    )
    for name in DEMUCS_STEMS:
        assert result.stems[name].bytes == 4096


def test_run_separation_generates_unique_job_ids():
    fn = _fake_separate_fn()
    first = run_separation(b"audio", "wav", CONFIG, separate_fn=fn)
    second = run_separation(b"audio", "wav", CONFIG, separate_fn=fn)
    assert first.job_id != second.job_id


def test_run_separation_rejects_wrong_stem_set():
    def _bad_fn(audio_bytes, audio_format):
        return RawSeparation(duration_seconds=1.0, stems={"drums": b"x", "bass": b"y"})

    with pytest.raises(ValueError):
        run_separation(b"audio", "wav", CONFIG, separate_fn=_bad_fn)


def test_run_separation_resolves_module_level_fn_when_not_injected(monkeypatch):
    # With no separate_fn argument, run_separation resolves the module-level
    # separate_with_demucs at call time, so monkeypatching it is honored.
    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate_fn())
    result = run_separation(b"audio", "wav", CONFIG)
    assert set(result.stems.keys()) == set(DEMUCS_STEMS)


# --- StemFile / SeparationResult dataclass rendering -------------------------


def test_stemfile_to_dict():
    assert StemFile(url="/stems/abc/drums.wav", bytes=10).to_dict() == {
        "url": "/stems/abc/drums.wav",
        "bytes": 10,
    }


# --- Endpoint integration (mocked model) -------------------------------------


def test_separate_endpoint_returns_200_success_body(monkeypatch):
    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate_fn(duration_seconds=120.0))

    response = client.post(
        "/separate",
        files={"file": ("song.wav", b"riff-wave-bytes", "audio/wav")},
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"job_id", "duration_seconds", "format", "stems"}
    assert body["duration_seconds"] == 120.0
    assert body["format"] == "wav"
    assert set(body["stems"].keys()) == {"drums", "bass", "vocals", "other"}
    for name in ("drums", "bass", "vocals", "other"):
        entry = body["stems"][name]
        assert set(entry.keys()) == {"url", "bytes"}
        assert entry["url"].endswith(f"/{name}.wav")


def test_separate_endpoint_each_stem_is_supported_audio_format(monkeypatch):
    # Every stem URL is a WAV file, a Supported_Audio_Format (Req 4.1).
    monkeypatch.setattr(separation, "separate_with_demucs", _fake_separate_fn())
    response = client.post(
        "/separate",
        files={"file": ("song.mp3", b"id3-mp3-bytes", "audio/mpeg")},
    )
    assert response.status_code == 200
    for entry in response.json()["stems"].values():
        assert entry["url"].endswith(".wav")
