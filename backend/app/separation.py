"""Demucs stem separation for ``POST /separate``.

Runs the ``htdemucs`` 4-stem model on an uploaded audio file and writes the
separated stems to disk so they can be served back and played individually
(Phase 1: verify separation quality).

Design notes:
* Heavy ML imports (``torch``, ``demucs``) are performed lazily inside
  :func:`separate_to_files` so importing this module (and the FastAPI app) never
  requires the multi-gigabyte stack. The test suite injects a fake separator.
* The separation runs on a worker thread bounded by the configured processing
  timeout; on timeout / failure / resource exhaustion a structured
  :class:`ServiceError` is raised and no stems are returned.
* Stems are written to ``<STEMS_DIR>/<job_id>/<stem>.wav`` and served by the app
  at ``/stems/<job_id>/<stem>.wav``.
"""

from __future__ import annotations

import concurrent.futures
import os
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from .config import ServiceConfig
from .errors import ServiceError

# The four stems htdemucs produces. The Frontend maps ``other -> melody``.
DEMUCS_STEMS: tuple[str, ...] = ("drums", "bass", "vocals", "other")

# Stems are written as WAV (a Supported_Audio_Format).
OUTPUT_FORMAT: str = "wav"

# The htdemucs 4-stem model identifier. Override with DEMUCS_MODEL (e.g.
# "htdemucs_6s" adds guitar + piano stems).
MODEL_NAME: str = os.getenv("DEMUCS_MODEL_NAME", "htdemucs")

# Cache of loaded demucs models, keyed by model name, so the (multi-second)
# load from disk happens once per process instead of on every request.
_MODEL_CACHE: dict[str, Any] = {}


def _load_model(name: str):  # pragma: no cover - needs the ML stack.
    """Load (and cache) a demucs model by name."""
    cached = _MODEL_CACHE.get(name)
    if cached is not None:
        return cached
    from demucs.pretrained import get_model  # type: ignore

    model = get_model(name)
    model.eval()
    _MODEL_CACHE[name] = model
    return model


def _overlap() -> float:
    """Window overlap for apply_model. Lower = faster, slightly softer seams."""
    try:
        return float(os.getenv("DEMUCS_OVERLAP", "0.25"))
    except ValueError:
        return 0.25


def stems_root() -> Path:
    """Directory under which per-job stem folders are written and served."""
    root = os.getenv("DEMUCS_STEMS_DIR") or os.path.join(
        tempfile.gettempdir(), "harmograph_stems"
    )
    path = Path(root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def separation_device() -> str:
    """Torch device for separation. Defaults to CPU for reliability on macOS.

    Set ``DEMUCS_DEVICE=mps`` to use Apple Silicon GPU acceleration (faster, but
    some demucs ops have historically been flaky on MPS).
    """
    return os.getenv("DEMUCS_DEVICE", "cpu")


@dataclass(frozen=True)
class StemFile:
    """A single separated stem entry in the success body (``{ url, bytes }``)."""

    url: str
    bytes: int

    def to_dict(self) -> dict[str, Any]:
        return {"url": self.url, "bytes": self.bytes}


@dataclass(frozen=True)
class SeparationResult:
    """The full ``POST /separate`` success payload."""

    job_id: str
    duration_seconds: float
    format: str
    stems: Mapping[str, StemFile]

    def to_body(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "duration_seconds": self.duration_seconds,
            "format": self.format,
            "stems": {name: stem.to_dict() for name, stem in self.stems.items()},
        }


# Signature of the injectable separator: (input_path, out_dir) -> (duration, {stem: wav_path}).
SeparateFn = Callable[[str, str], tuple[float, dict[str, str]]]


def separate_to_files(input_path: str, out_dir: str) -> tuple[float, dict[str, str]]:
    """Run htdemucs on ``input_path`` and write each stem WAV into ``out_dir``.

    Returns the input duration in seconds and a mapping of stem name to the
    written WAV path. Heavy imports are lazy so the module imports without the
    ML stack present.
    """
    try:  # pragma: no cover - exercised only with the ML stack installed.
        import numpy as np  # type: ignore
        import soundfile as sf  # type: ignore
        import torch  # type: ignore
        from demucs.apply import apply_model  # type: ignore
        from demucs.audio import AudioFile  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on environment.
        raise RuntimeError(
            "Demucs separation requires the 'torch' and 'demucs' packages."
        ) from exc

    # pragma: no cover below — the real model path runs only with the heavy deps.
    device = separation_device()  # pragma: no cover
    model = _load_model(MODEL_NAME)  # pragma: no cover (cached after first load)
    samplerate = int(model.samplerate)  # pragma: no cover
    channels = int(model.audio_channels)  # pragma: no cover

    # Decode (any ffmpeg-supported format) and conform to the model's rate/channels.
    wav = AudioFile(input_path).read(  # pragma: no cover
        streams=0, samplerate=samplerate, channels=channels
    )
    duration = float(wav.shape[-1]) / float(samplerate)  # pragma: no cover

    # Normalize as demucs does, then restore scale on the separated sources.
    ref = wav.mean(0)  # pragma: no cover
    mean = ref.mean()  # pragma: no cover
    std = ref.std() + 1e-8  # pragma: no cover
    wav = (wav - mean) / std  # pragma: no cover

    with torch.no_grad():  # pragma: no cover
        sources = apply_model(
            model, wav[None], device=device, shifts=1, split=True, overlap=_overlap()
        )[0]
    sources = sources * std + mean  # pragma: no cover

    paths: dict[str, str] = {}  # pragma: no cover
    for name, source in zip(model.sources, sources):  # pragma: no cover
        out_path = os.path.join(out_dir, f"{name}.{OUTPUT_FORMAT}")
        # soundfile expects (frames, channels); demucs gives (channels, samples).
        data = source.detach().cpu().numpy().T
        sf.write(out_path, np.clip(data, -1.0, 1.0), samplerate, subtype="PCM_16")
        paths[name] = out_path
    return duration, paths


def _stem_url(job_id: str, stem: str) -> str:
    return f"/stems/{job_id}/{stem}.{OUTPUT_FORMAT}"


def run_separation(
    audio_bytes: bytes,
    audio_format: str,
    config: ServiceConfig,
    separate_fn: SeparateFn | None = None,
) -> SeparationResult:
    """Persist the upload, separate it, and build the success payload.

    Writes the input to a temp file, runs the (injectable) separator, writes the
    stems under ``<STEMS_DIR>/<job_id>/``, and assembles the result with URLs the
    app serves at ``/stems/<job_id>/<stem>.wav``.
    """
    fn = separate_fn if separate_fn is not None else separate_to_files

    job_id = str(uuid.uuid4())
    out_dir = stems_root() / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = f".{audio_format}" if audio_format else ""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        input_path = tmp.name

    try:
        duration, stem_paths = fn(input_path, str(out_dir))
    finally:
        try:
            os.unlink(input_path)
        except OSError:
            pass

    stems = {
        name: StemFile(url=_stem_url(job_id, name), bytes=_safe_size(path))
        for name, path in stem_paths.items()
    }

    return SeparationResult(
        job_id=job_id,
        duration_seconds=duration,
        format=OUTPUT_FORMAT,
        stems=stems,
    )


def _safe_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def run_separation_guarded(
    audio_bytes: bytes,
    audio_format: str,
    config: ServiceConfig,
    separate_fn: SeparateFn | None = None,
) -> SeparationResult:
    """Run :func:`run_separation` with a processing timeout and error mapping.

    * Exceeds ``config.timeout_seconds`` -> ``504 PROCESSING_TIMEOUT``.
    * Resource exhaustion (``MemoryError``) -> ``503 SERVICE_UNAVAILABLE``.
    * Any other failure -> ``500 SEPARATION_FAILED``.
    """
    timeout = config.timeout_seconds
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(
        run_separation, audio_bytes, audio_format, config, separate_fn
    )
    try:
        result = future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        future.cancel()
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=504,
            code="PROCESSING_TIMEOUT",
            message="Stem separation did not complete within the maximum processing time.",
            details={"timeout_seconds": timeout},
        )
    except MemoryError as exc:
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=503,
            code="SERVICE_UNAVAILABLE",
            message="The service is temporarily unavailable due to resource exhaustion.",
        ) from exc
    except ServiceError:
        executor.shutdown(wait=False)
        raise
    except Exception as exc:  # noqa: BLE001
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=500,
            code="SEPARATION_FAILED",
            message="Stem separation failed during processing.",
        ) from exc
    else:
        executor.shutdown(wait=False)
        return result
