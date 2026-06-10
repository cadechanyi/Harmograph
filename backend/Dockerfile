# syntax=docker/dockerfile:1
#
# Demucs_Service container image.
#
# Builds a self-contained image that bundles the FastAPI app AND the Demucs
# `htdemucs` 4-stem model weights. The weights are pre-downloaded at build time
# (see the "pre-fetch model weights" layer) so the running container performs no
# network fetch on first request and can run fully offline.
#
# The service is an independently deployable artifact (Req 4.7, 12.1, 12.2):
# this image has no dependency on the Frontend and is deployed on its own (see
# fly.toml for Fly.io and modal_app.py for Modal).

FROM python:3.11-slim AS runtime

# --- Environment -------------------------------------------------------------
# - PYTHONUNBUFFERED: stream logs immediately for container log collectors.
# - PIP_NO_CACHE_DIR: keep image small.
# - TORCH_HOME: pin the torch hub cache to a known path so the pre-downloaded
#   Demucs weights are baked into an image layer and resolved at runtime.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TORCH_HOME=/opt/demucs-cache/torch \
    PORT=8000

# --- System dependencies -----------------------------------------------------
# ffmpeg: audio decode/encode backend used by Demucs / torchaudio for MP3/WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# --- Python dependencies -----------------------------------------------------
# Install dependencies before copying app source so the (slow) ML install layer
# is cached across app-only changes. torch/torchaudio come from the CPU wheel
# index to avoid pulling large CUDA runtimes.
COPY requirements-docker.txt ./requirements-docker.txt
RUN pip install --upgrade pip \
    && pip install \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements-docker.txt

# --- Pre-fetch model weights -------------------------------------------------
# Download the htdemucs 4-stem model into TORCH_HOME at build time so the image
# is self-contained and the first request does not block on a download.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

# --- Application source -------------------------------------------------------
COPY app ./app

# --- Runtime hardening --------------------------------------------------------
# Run as an unprivileged user; grant it read access to the model cache.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /opt/demucs-cache
USER appuser

EXPOSE 8000

# Liveness/readiness against the audio-free /health endpoint (Req 12.7).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request,sys; \
url='http://127.0.0.1:%s/health' % os.getenv('PORT','8000'); \
sys.exit(0 if urllib.request.urlopen(url, timeout=4).status == 200 else 1)"

# Honor an injected $PORT (Fly.io / Modal / generic PaaS) but default to 8000.
# JSON exec form with `exec` so the shell hands its PID to uvicorn and OS
# signals (SIGTERM on stop/restart) reach the server, while ${PORT} still
# expands at runtime.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
