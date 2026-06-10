"""Deployment smoke tests (task 18.1) for the Demucs_Service.

These assert the service is an independently deployable artifact (Req 4.7,
12.1, 12.2): it builds, runs, and answers its readiness/metadata endpoints with
NO Frontend present or running, and its deployment configuration is
self-contained.

Two layers of assertions:

  1. RUNTIME (standalone): boot the FastAPI app via TestClient — there is no
     Frontend in this process — and assert ``GET /health`` returns
     ``200 { status, model, version }`` and ``GET /meta`` works, proving the
     service answers on its own.

  2. STRUCTURAL (deploy config is self-contained): assert the Dockerfile
     references the app, pre-downloads the htdemucs weights, and launches
     uvicorn; and that the Fly.io (fly.toml) and Modal (modal_app.py) configs
     exist and deploy the service alone (its own app, its own /health check),
     with no reference to the Frontend.

NOTE ON `docker build`: actually building the container image requires Docker
and downloads multi-GB ML wheels + model weights, so it is environment-bound
and not run here (mirroring how the browser suites document jsdom limits). The
structural assertions below verify the image *recipe* is correct and
self-contained; an optional `docker build` can be run wherever Docker is
available using `backend/Dockerfile`.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app import __version__
from app.config import ACCEPTED_FORMATS, get_config
from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parent.parent

client = TestClient(app)


# --- 1. RUNTIME: the service answers standalone (no Frontend) ---------------


def test_health_responds_standalone():
    """GET /health returns 200 { status, model, version } with no Frontend.

    The app is booted in-process via TestClient — nothing else (no Frontend) is
    running — yet the readiness probe answers fully (Req 4.7, 12.1, 12.2, 12.7).
    """
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"status", "model", "version"}
    assert body["status"] == "ok"
    assert body["model"] == get_config().model
    assert body["version"] == __version__


def test_meta_responds_standalone():
    """GET /meta works standalone, exposing the service limits."""
    response = client.get("/meta")

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"max_bytes", "timeout_seconds", "accepted"}
    assert body["accepted"] == list(ACCEPTED_FORMATS)


# --- 2. STRUCTURAL: the Dockerfile is a self-contained image recipe ---------


def _read(relpath: str) -> str:
    return (BACKEND_ROOT / relpath).read_text(encoding="utf-8")


def _strip_comments_and_docstrings(relpath: str) -> str:
    """Return only the *functional* config of a file.

    Deploy configs explain their independence from the Frontend in prose
    (comments/docstrings), so coupling must be judged on executable directives
    only. This drops ``#`` comment lines and any triple-quoted docstring blocks,
    leaving the directives a deployer would actually run.
    """
    import re

    text = _read(relpath)
    # Remove triple-quoted blocks (Python module docstrings).
    text = re.sub(r'"""[\s\S]*?"""', "", text)
    text = re.sub(r"'''[\s\S]*?'''", "", text)
    functional_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        # Drop trailing inline comments for # and TOML/Dockerfile lines.
        functional_lines.append(line.split("#", 1)[0] if "#" in line else line)
    return "\n".join(functional_lines)


def test_dockerfile_present_and_self_contained():
    """The Dockerfile builds the app image and pre-bakes the htdemucs weights.

    A self-contained image (Req 4.7, 12.1, 12.2) copies the FastAPI app source,
    pre-downloads the htdemucs model weights at build time (so the running
    container needs no network fetch), and launches the app with uvicorn.
    """
    dockerfile = BACKEND_ROOT / "Dockerfile"
    assert dockerfile.exists(), "backend/Dockerfile must exist for deployment"

    content = dockerfile.read_text(encoding="utf-8")

    # Bundles the application source.
    assert "COPY app" in content
    # Pre-downloads the htdemucs 4-stem weights at build time.
    assert "get_model('htdemucs')" in content or 'get_model("htdemucs")' in content
    # Launches the FastAPI app via uvicorn.
    assert "uvicorn app.main:app" in content
    # Exposes a port to serve the API on its own.
    assert "EXPOSE 8000" in content


def test_dockerfile_does_not_depend_on_frontend():
    """The image recipe is backend-only — no Frontend artifacts are copied in.

    Judged on functional directives (comments explaining independence are
    expected and ignored): the image must not build or copy Frontend code.
    """
    functional = _strip_comments_and_docstrings("Dockerfile").lower()
    assert "frontend" not in functional
    assert "next build" not in functional
    assert "npm" not in functional


# --- 2b. STRUCTURAL: deploy configs deploy the service alone ----------------


def test_fly_config_deploys_service_alone():
    """fly.toml deploys the Demucs_Service as its own Fly app with a /health check."""
    fly = BACKEND_ROOT / "fly.toml"
    assert fly.exists(), "backend/fly.toml must exist for independent deployment"

    content = fly.read_text(encoding="utf-8")
    # Its own app name + builds from the backend Dockerfile.
    assert 'app = "harmograph-demucs"' in content
    assert 'dockerfile = "Dockerfile"' in content
    # Health check targets the audio-free readiness endpoint.
    assert 'path = "/health"' in content


def test_modal_config_deploys_service_alone():
    """modal_app.py deploys the same image as an independent Modal ASGI app."""
    modal_app = BACKEND_ROOT / "modal_app.py"
    assert modal_app.exists(), "backend/modal_app.py must exist as a deploy option"

    content = modal_app.read_text(encoding="utf-8")
    # Builds from the same self-contained Dockerfile.
    assert 'from_dockerfile("Dockerfile")' in content
    # Serves the FastAPI app instance directly.
    assert "from app.main import app" in content
    assert "asgi_app" in content


def test_deploy_configs_do_not_reference_frontend():
    """Neither deploy config functionally couples the service to the Frontend.

    Prose comments documenting independence are expected; only executable
    directives are checked.
    """
    for relpath in ("fly.toml", "modal_app.py"):
        functional = _strip_comments_and_docstrings(relpath).lower()
        assert "frontend" not in functional, (
            f"{relpath} must not functionally reference the Frontend"
        )
