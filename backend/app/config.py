"""Service configuration for the Demucs_Service.

Values are sourced from environment variables with MVP-friendly defaults that
match the design's API Contract (``GET /meta``) and requirements.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Accepted upload formats (Supported_Audio_Format): MP3 and WAV (Req 4.2).
ACCEPTED_FORMATS: tuple[str, ...] = ("mp3", "wav")

# MIME types that map to the accepted formats, used for content-type validation.
ACCEPTED_CONTENT_TYPES: tuple[str, ...] = (
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
)


@dataclass(frozen=True)
class ServiceConfig:
    """Runtime limits for the Demucs_Service."""

    # Maximum stem-separation upload size in bytes (Req 4.3). Default 100 MB.
    max_bytes: int = int(os.getenv("DEMUCS_MAX_BYTES", str(104_857_600)))
    # Maximum processing time before timing out (Req 4.5). Default 10 minutes.
    timeout_seconds: int = int(os.getenv("DEMUCS_TIMEOUT_SECONDS", str(600)))
    # Demucs model identifier reported by /health.
    model: str = os.getenv("DEMUCS_MODEL", "demucs")


def get_config() -> ServiceConfig:
    """Return the active service configuration."""
    return ServiceConfig()
