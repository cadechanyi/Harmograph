"""Request validation for the Demucs_Service ``POST /separate`` endpoint (task 1.2).

Validation runs *before* any separation logic so that malformed requests are
rejected cheaply and never reach the Demucs model. Each rejection maps to the
structured error body and status codes documented in the design's API Contract:

    Missing/empty file field           -> 400 INVALID_REQUEST       (Req 4.2 family)
    Body is not a Supported_Audio_Format -> 415 UNSUPPORTED_FORMAT  (Req 4.2)
    File exceeds max separation size    -> 413 FILE_TOO_LARGE        (Req 4.3)

The accepted formats are MP3 and WAV (``ACCEPTED_FORMATS``). Format is accepted
when either the multipart content type matches a known audio MIME type or the
uploaded filename carries an accepted extension.

``validate_separation_request`` returns the validated file bytes so the
separation step (task 1.3) can consume them without re-reading the upload,
keeping a clean seam between validation and separation.
"""

from __future__ import annotations

import os

from fastapi import UploadFile

from .config import ACCEPTED_CONTENT_TYPES, ACCEPTED_FORMATS, ServiceConfig
from .errors import ServiceError


def is_supported_format(content_type: str | None, filename: str | None) -> bool:
    """Return True when the upload looks like a Supported_Audio_Format (MP3/WAV).

    A request is considered a supported format when its multipart content type
    matches a known audio MIME type, or its filename ends with an accepted
    extension (``.mp3`` / ``.wav``). The extension fallback covers clients that
    send a generic content type such as ``application/octet-stream``.
    """
    if content_type:
        normalized = content_type.split(";", 1)[0].strip().lower()
        if normalized in ACCEPTED_CONTENT_TYPES:
            return True

    if filename:
        ext = os.path.splitext(filename)[1].lstrip(".").lower()
        if ext in ACCEPTED_FORMATS:
            return True

    return False


# MIME types that unambiguously indicate MP3, used to infer the input format.
_MP3_CONTENT_TYPES = ("audio/mpeg", "audio/mp3")


def infer_audio_format(content_type: str | None, filename: str | None) -> str:
    """Infer the input container format (``"mp3"`` or ``"wav"``).

    Resolution order mirrors :func:`is_supported_format`: the filename extension
    is authoritative when present, otherwise the content type is consulted.
    Defaults to ``"wav"`` when neither yields a recognized format. Only called
    after a request has passed format validation, so the input is known to be a
    Supported_Audio_Format.
    """
    if filename:
        ext = os.path.splitext(filename)[1].lstrip(".").lower()
        if ext in ACCEPTED_FORMATS:
            return ext

    if content_type:
        normalized = content_type.split(";", 1)[0].strip().lower()
        if normalized in _MP3_CONTENT_TYPES:
            return "mp3"

    return "wav"


async def validate_separation_request(
    file: UploadFile | None,
    config: ServiceConfig,
) -> bytes:
    """Validate the ``POST /separate`` request and return the file bytes.

    Validation precedence (each raises ``ServiceError`` with the documented
    status and structured body):

    1. Missing file field            -> 400 ``INVALID_REQUEST``
    2. Unsupported format            -> 415 ``UNSUPPORTED_FORMAT``
       (``details.accepted = ["mp3", "wav"]``)
    3. Empty file (zero bytes)       -> 400 ``INVALID_REQUEST``
    4. Exceeds max separation size   -> 413 ``FILE_TOO_LARGE``
       (``details.max_bytes``)

    Returns:
        The validated upload contents as ``bytes`` for the separation step.
    """
    # 1. The file field must be present (Req 4.2 family).
    if file is None:
        raise ServiceError(
            status_code=400,
            code="INVALID_REQUEST",
            message="A file field is required.",
            details={"field": "file"},
        )

    # 2. The body must be a Supported_Audio_Format (Req 4.2).
    if not is_supported_format(file.content_type, file.filename):
        raise ServiceError(
            status_code=415,
            code="UNSUPPORTED_FORMAT",
            message="Unsupported audio format. Accepted formats are MP3 and WAV.",
            details={"accepted": list(ACCEPTED_FORMATS)},
        )

    # Read the upload once; the bytes are returned for the separation step.
    contents = await file.read()
    await file.seek(0)

    # 3. The file must be non-empty (Req 4.2 family: missing/empty file field).
    if len(contents) == 0:
        raise ServiceError(
            status_code=400,
            code="INVALID_REQUEST",
            message="The uploaded file is empty.",
            details={"field": "file"},
        )

    # 4. The file must not exceed the configured max separation size (Req 4.3).
    if len(contents) > config.max_bytes:
        raise ServiceError(
            status_code=413,
            code="FILE_TOO_LARGE",
            message="The uploaded file exceeds the maximum allowed size.",
            details={"max_bytes": config.max_bytes},
        )

    return contents
