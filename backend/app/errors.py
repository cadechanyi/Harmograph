"""Shared structured error body helpers for the Demucs_Service.

Every error response returned by the service uses the same JSON envelope so the
Frontend can parse failures uniformly (design: API Contract error responses):

    { "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
"""

from __future__ import annotations

from typing import Any, Mapping

from fastapi import HTTPException
from fastapi.responses import JSONResponse


def error_body(code: str, message: str, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Build the structured error body envelope.

    Args:
        code: Machine-readable error code (e.g. ``UNSUPPORTED_FORMAT``).
        message: Human-readable description of the failure.
        details: Optional structured context (e.g. ``{"max_bytes": 104857600}``).

    Returns:
        A dict of the shape ``{"error": {"code", "message", "details"}}``.
    """
    return {
        "error": {
            "code": code,
            "message": message,
            "details": dict(details) if details else {},
        }
    }


class ServiceError(HTTPException):
    """An HTTPException whose detail is already a structured error body.

    Using this lets route handlers ``raise ServiceError(...)`` and rely on the
    registered exception handler to emit the envelope with the right status.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=error_body(code, message, details))
        self.code = code


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Mapping[str, Any] | None = None,
) -> JSONResponse:
    """Build a JSONResponse carrying the structured error body."""
    return JSONResponse(status_code=status_code, content=error_body(code, message, details))
