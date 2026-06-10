"""Modal deployment for the Demucs_Service.

This is an alternative to Fly.io (see fly.toml). It deploys the same FastAPI app
as an independently deployable artifact (Req 4.7, 12.1, 12.2): it has no
dependency on the Frontend, which reaches it through its own configurable
endpoint (Req 12.3) — here, the Modal-assigned ``*.modal.run`` URL.

Modal runs the *same* container image as the Dockerfile by building from it, so
the htdemucs weights are pre-baked and the API code is identical to the Fly.io
deployment.

Deploy:
    pip install modal
    modal deploy modal_app.py

Serve locally for testing:
    modal serve modal_app.py
"""

from __future__ import annotations

import modal

# Build the deployment image straight from the project Dockerfile so Modal and
# Fly.io ship byte-for-byte equivalent runtimes (weights pre-downloaded, ffmpeg
# present, app source copied in).
image = modal.Image.from_dockerfile("Dockerfile")

app = modal.App(name="harmograph-demucs", image=image)


@app.function(
    # Demucs is memory/CPU heavy; give it room to hold the model + audio.
    cpu=2.0,
    memory=8192,
    # Match the configured maximum processing time (Req 4.5).
    timeout=600,
    # Keep one warm container so model weights stay resident between requests.
    min_containers=1,
)
@modal.asgi_app()
def fastapi_app():
    """Expose the FastAPI app instance as a Modal ASGI web endpoint."""
    from app.main import app as fastapi_instance

    return fastapi_instance
