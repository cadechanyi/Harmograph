"""Demucs_Service FastAPI application entrypoint.

This module wires the FastAPI app instance and the route stubs for the API
contract documented in the design:

    POST /separate   -> stem separation (validation/separation land in tasks 1.2-1.5)
    GET  /health     -> readiness probe (no audio)
    GET  /meta       -> service limits the Frontend can pre-validate against (no audio)

Every error response uses the shared structured error body envelope
``{ "error": { "code", "message", "details" } }`` (design: API Contract).

The service is an independently deployable artifact (Req 4.7, 12.2).
"""

from __future__ import annotations

from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import ACCEPTED_FORMATS, get_config
from .errors import error_response
from .separation import run_separation_guarded
from .validation import infer_audio_format, validate_separation_request

app = FastAPI(
    title="Demucs_Service",
    version=__version__,
    description="Stem separation microservice for Harmograph (Demucs htdemucs 4-stem).",
)


@app.exception_handler(StarletteHTTPException)
async def structured_http_exception_handler(_request, exc: StarletteHTTPException) -> JSONResponse:
    """Render HTTPExceptions using the structured error body envelope.

    If the exception ``detail`` is already an error envelope (raised via
    ``ServiceError``), pass it through unchanged. Otherwise wrap the detail in
    the standard envelope so all error responses share one shape.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return error_response(exc.status_code, "HTTP_ERROR", str(detail))


@app.get("/health")
async def health() -> dict:
    """Readiness probe. Returns 200 when the service is ready (Req 12.7).

    Carries no audio data.
    """
    config = get_config()
    return {"status": "ok", "model": config.model, "version": __version__}


@app.get("/meta")
async def meta() -> dict:
    """Service limits the Frontend can use to pre-validate (Req 12.7).

    Carries no audio data.
    """
    config = get_config()
    return {
        "max_bytes": config.max_bytes,
        "timeout_seconds": config.timeout_seconds,
        "accepted": list(ACCEPTED_FORMATS),
    }


@app.post("/separate")
async def separate(file: UploadFile | None = None) -> JSONResponse:
    """Stem separation endpoint.

    Request validation (task 1.2) runs first and rejects missing/empty,
    unsupported-format, and oversize uploads with the documented structured
    errors. A validated request is then separated into the four ``htdemucs``
    stems (task 1.3) and returned with the documented 200 OK success body.
    Processing-timeout and server-error handling (task 1.4) wrap the separation:
    a ``504 PROCESSING_TIMEOUT`` when it exceeds the configured maximum
    processing time, ``500 SEPARATION_FAILED`` when separation fails, and
    ``503 SERVICE_UNAVAILABLE`` on resource exhaustion -- each returning no stem
    files via the structured error envelope.
    """
    config = get_config()

    # Validate before any separation work (task 1.2). Raises ServiceError on
    # rejection, rendered by the structured exception handler. Validation
    # precedence is preserved: validation is decided before separation runs.
    contents = await validate_separation_request(file, config)

    # Invoke the htdemucs 4-stem model behind the separation boundary (task 1.3),
    # guarded by the processing timeout and server-error mapping (task 1.4).
    audio_format = infer_audio_format(file.content_type, file.filename)
    result = run_separation_guarded(contents, audio_format, config)
    return JSONResponse(status_code=200, content=result.to_body())
