"""Demucs stem separation for the ``POST /separate`` endpoint (task 1.3).

This module owns the boundary between the FastAPI route and the heavy Demucs
model invocation. The design calls for the `htdemucs` 4-stem model, which
returns exactly four stems -- ``drums``, ``bass``, ``vocals``, ``other`` --
each encoded as a Supported_Audio_Format (WAV by default) (Req 4.1).

Design goals captured here:

* **Clean function boundary** -- ``run_separation`` is the single entry point
  the route calls. Task 1.4 (processing timeout, ``500``/``503``/``504``
  handling) wraps this function without reaching into model internals.
* **Injectable / mockable model call** -- the heavy work lives in
  ``separate_with_demucs``, referenced indirectly so it can be monkeypatched or
  swapped via the ``separate_fn`` parameter. This lets the service import and
  the tests run without ``torch``/``demucs`` installed.
* **Guarded heavy imports** -- ``torch`` and ``demucs`` are imported lazily
  *inside* ``separate_with_demucs`` so importing this module (and the app) never
  requires the multi-gigabyte ML stack to be present.

Success body shape (design API Contract, ``POST /separate`` 200 OK)::

    {
      "job_id": "b1c1f0e2-...",
      "duration_seconds": 213.4,
      "format": "wav",
      "stems": {
        "drums":  { "url": "/stems/<job_id>/drums.wav",  "bytes": 18234112 },
        "bass":   { "url": "/stems/<job_id>/bass.wav",   "bytes": 17110044 },
        "vocals": { "url": "/stems/<job_id>/vocals.wav", "bytes": 16998230 },
        "other":  { "url": "/stems/<job_id>/other.wav",  "bytes": 19002441 }
      }
    }
"""

from __future__ import annotations

import concurrent.futures
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from .config import ServiceConfig
from .errors import ServiceError

# The four stems the htdemucs model produces, in the documented order (Req 4.1).
# The Frontend later maps ``other -> melody`` (Req 4.9); the service always
# returns these raw Demucs keys.
DEMUCS_STEMS: tuple[str, ...] = ("drums", "bass", "vocals", "other")

# Stems are returned as WAV, a Supported_Audio_Format (Req 4.1). htdemucs writes
# WAV natively, so this is the output format regardless of the input encoding.
OUTPUT_FORMAT: str = "wav"

# The htdemucs 4-stem model identifier (design: Demucs_Service uses htdemucs).
MODEL_NAME: str = "htdemucs"


class SeparationFailedError(Exception):
    """Raised when stem separation fails during processing (Req 4.4).

    The separation backend (or the model invocation) raises this -- or any
    non-resource, non-timeout exception -- to signal a processing failure that
    :func:`run_separation_guarded` maps onto ``500 SEPARATION_FAILED``.
    """


class ResourceUnavailableError(Exception):
    """Raised on resource exhaustion / service unavailability (Req 4.6).

    Covers conditions other than separation failure such as out-of-memory or
    lack of capacity. :func:`run_separation_guarded` maps this (and the builtin
    :class:`MemoryError`) onto ``503 SERVICE_UNAVAILABLE``.
    """


@dataclass(frozen=True)
class RawSeparation:
    """The raw result of invoking the Demucs model.

    This is the contract every separation backend (real or mocked) must satisfy:
    the decoded ``duration_seconds`` of the input and the per-stem audio bytes
    keyed by the four ``DEMUCS_STEMS``.
    """

    duration_seconds: float
    stems: Mapping[str, bytes]


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
        """Render the documented success body (design API Contract 200 OK)."""
        return {
            "job_id": self.job_id,
            "duration_seconds": self.duration_seconds,
            "format": self.format,
            "stems": {name: stem.to_dict() for name, stem in self.stems.items()},
        }


# Type of the injectable model-invocation function.
SeparateFn = Callable[[bytes, str], RawSeparation]


def separate_with_demucs(audio_bytes: bytes, audio_format: str) -> RawSeparation:
    """Invoke the ``htdemucs`` 4-stem model on ``audio_bytes`` (Req 4.1).

    The heavy ML dependencies (``torch``, ``demucs``) are imported lazily here
    so that importing this module and the FastAPI app never requires them. In an
    environment without the model installed, this raises ``RuntimeError`` with a
    clear message; task 1.4 maps such failures onto the documented server-error
    responses.

    Args:
        audio_bytes: The validated input audio file contents.
        audio_format: The input container format (``"mp3"``/``"wav"``), used by
            the decoder; output stems are always WAV.

    Returns:
        A :class:`RawSeparation` carrying the decoded duration and the four
        stem audio payloads keyed by :data:`DEMUCS_STEMS`.
    """
    try:  # pragma: no cover - exercised only when the ML stack is installed.
        import io

        import torch  # type: ignore
        import torchaudio  # type: ignore
        from demucs.apply import apply_model  # type: ignore
        from demucs.pretrained import get_model  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on environment.
        raise RuntimeError(
            "Demucs separation requires the 'torch' and 'demucs' packages, "
            "which are not installed in this environment."
        ) from exc

    # pragma: no cover below: this real model path runs only with the heavy deps.
    model = get_model(MODEL_NAME)  # pragma: no cover
    model.eval()  # pragma: no cover

    waveform, sample_rate = torchaudio.load(io.BytesIO(audio_bytes))  # pragma: no cover
    duration_seconds = waveform.shape[-1] / float(sample_rate)  # pragma: no cover

    # demucs expects a batch dimension: (batch, channels, samples).
    with torch.no_grad():  # pragma: no cover
        sources = apply_model(model, waveform[None], device="cpu")[0]

    stems: dict[str, bytes] = {}  # pragma: no cover
    for name, source in zip(model.sources, sources):  # pragma: no cover
        buffer = io.BytesIO()
        torchaudio.save(buffer, source.cpu(), sample_rate, format=OUTPUT_FORMAT)
        stems[name] = buffer.getvalue()

    return RawSeparation(duration_seconds=duration_seconds, stems=stems)  # pragma: no cover


def _stem_url(job_id: str, stem: str) -> str:
    """Build the download URL for a stem (design: ``/stems/<job_id>/<stem>.wav``)."""
    return f"/stems/{job_id}/{stem}.{OUTPUT_FORMAT}"


def run_separation(
    audio_bytes: bytes,
    audio_format: str,
    config: ServiceConfig,
    separate_fn: SeparateFn | None = None,
) -> SeparationResult:
    """Separate ``audio_bytes`` into four stems and build the success payload.

    This is the clean boundary the route calls. It assigns a ``job_id``, invokes
    the (injectable) model function, validates that exactly the four documented
    stems came back, and assembles the :class:`SeparationResult` whose
    ``to_body()`` matches the design's 200 OK contract.

    Args:
        audio_bytes: The validated input audio contents.
        audio_format: The input container format (``"mp3"``/``"wav"``).
        config: Active service configuration (reserved for task 1.4 wrapping).
        separate_fn: Optional override for the model invocation. When ``None``
            the module-level :func:`separate_with_demucs` is resolved at call
            time, so tests can monkeypatch it.

    Returns:
        The assembled :class:`SeparationResult`.

    Raises:
        ValueError: If the model returns a stem set other than the four
            documented Demucs stems.
    """
    # Resolve the model function at call time so monkeypatching the module-level
    # ``separate_with_demucs`` is honored even when no explicit override is given.
    fn = separate_fn if separate_fn is not None else separate_with_demucs

    job_id = str(uuid.uuid4())
    raw = fn(audio_bytes, audio_format)

    returned = set(raw.stems.keys())
    expected = set(DEMUCS_STEMS)
    if returned != expected:
        raise ValueError(
            f"Demucs returned stems {sorted(returned)}; expected {sorted(expected)}."
        )

    # Build the stems mapping in the documented order (drums, bass, vocals, other).
    stems = {
        name: StemFile(url=_stem_url(job_id, name), bytes=len(raw.stems[name]))
        for name in DEMUCS_STEMS
    }

    return SeparationResult(
        job_id=job_id,
        duration_seconds=raw.duration_seconds,
        format=OUTPUT_FORMAT,
        stems=stems,
    )


def run_separation_guarded(
    audio_bytes: bytes,
    audio_format: str,
    config: ServiceConfig,
    separate_fn: SeparateFn | None = None,
) -> SeparationResult:
    """Run :func:`run_separation` with a processing timeout and error mapping.

    This is the boundary the route calls. It wraps the (CPU-bound, possibly
    long-running) separation work so that the documented server-error responses
    are produced without leaking raw exceptions or stem files (design API
    Contract error table):

    * Exceeds ``config.timeout_seconds`` -> ``504 PROCESSING_TIMEOUT`` with
      ``details.timeout_seconds`` and no stem files (Req 4.5).
    * Separation fails during processing (e.g. a model ``RuntimeError`` or a
      :class:`SeparationFailedError`) -> ``500 SEPARATION_FAILED`` (Req 4.4).
    * Resource exhaustion / unavailability (:class:`MemoryError` or
      :class:`ResourceUnavailableError`) -> ``503 SERVICE_UNAVAILABLE`` (Req 4.6).

    The separation runs on a worker thread so the timeout can fire even when the
    model call blocks. On timeout the worker is left to unwind in the background
    (a thread cannot be force-killed); the executor is shut down without waiting
    so the request returns promptly. No stem files are returned on any error
    path -- a :class:`ServiceError` is raised instead, rendered by the app's
    structured exception handler.

    Raises:
        ServiceError: ``504`` / ``500`` / ``503`` per the conditions above.
    """
    timeout = config.timeout_seconds
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(
        run_separation, audio_bytes, audio_format, config, separate_fn
    )
    try:
        result = future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        # Do not wait on the still-running worker; return the timeout promptly.
        future.cancel()
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=504,
            code="PROCESSING_TIMEOUT",
            message="Stem separation did not complete within the maximum processing time.",
            details={"timeout_seconds": timeout},
        )
    except (MemoryError, ResourceUnavailableError) as exc:
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=503,
            code="SERVICE_UNAVAILABLE",
            message="The service is temporarily unavailable due to resource exhaustion.",
        ) from exc
    except ServiceError:
        # A structured error already; let it propagate unchanged.
        executor.shutdown(wait=False)
        raise
    except Exception as exc:  # noqa: BLE001 - any other failure is a processing failure.
        executor.shutdown(wait=False)
        raise ServiceError(
            status_code=500,
            code="SEPARATION_FAILED",
            message="Stem separation failed during processing.",
        ) from exc
    else:
        executor.shutdown(wait=False)
        return result
