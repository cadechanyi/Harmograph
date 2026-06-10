"""Demucs_Service FastAPI application entrypoint.

Routes:
    POST /separate              -> run htdemucs, write 4 stems, return their URLs
    GET  /stems/<job>/<s>.wav   -> serve a separated stem file (static mount)
    GET  /health                -> readiness probe (no audio)
    GET  /meta                  -> service limits (no audio)

Every error response uses the structured envelope
``{ "error": { "code", "message", "details" } }``.

CORS is enabled so the Frontend (a separate origin, e.g. http://localhost:3002)
can POST uploads and fetch stems.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import ACCEPTED_FORMATS, get_config
from .errors import error_response
from .separation import run_separation_guarded, stems_root
from .validation import infer_audio_format, validate_separation_request

app = FastAPI(
    title="Demucs_Service",
    version=__version__,
    description="Stem separation microservice for Harmograph (Demucs htdemucs 4-stem).",
)

# Allow the Frontend (a distinct origin during local dev and in production) to
# call the API. Origins are configurable via DEMUCS_CORS_ORIGINS (comma list);
# defaults to "*" for frictionless local development.
_origins_env = os.getenv("DEMUCS_CORS_ORIGINS", "*")
_allow_origins = ["*"] if _origins_env.strip() == "*" else [
    o.strip() for o in _origins_env.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve separated stems so the Frontend can play each one back.
app.mount("/stems", StaticFiles(directory=str(stems_root())), name="stems")


@app.exception_handler(StarletteHTTPException)
async def structured_http_exception_handler(_request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return error_response(exc.status_code, "HTTP_ERROR", str(detail))


@app.get("/health")
async def health() -> dict:
    """Readiness probe. Carries no audio data."""
    config = get_config()
    return {"status": "ok", "model": config.model, "version": __version__}


@app.get("/meta")
async def meta() -> dict:
    """Service limits the Frontend can use to pre-validate. Carries no audio."""
    config = get_config()
    return {
        "max_bytes": config.max_bytes,
        "timeout_seconds": config.timeout_seconds,
        "accepted": list(ACCEPTED_FORMATS),
    }


@app.post("/separate")
async def separate(file: UploadFile | None = None) -> JSONResponse:
    """Validate the upload, separate it into 4 stems, and return their URLs."""
    config = get_config()

    contents = await validate_separation_request(file, config)
    audio_format = infer_audio_format(file.content_type, file.filename)
    result = run_separation_guarded(contents, audio_format, config)
    return JSONResponse(status_code=200, content=result.to_body())
