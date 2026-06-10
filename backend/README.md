# Demucs_Service

Stem separation microservice for Harmograph. A Dockerized Python FastAPI app
wrapping Facebook's Demucs model. Deployed independently of the Frontend
(Req 4.7, 12.1, 12.2).

## Layout

```
backend/
  app/
    __init__.py     # package + version
    config.py       # service limits (max_bytes, timeout, accepted formats)
    errors.py       # shared structured error body helper
    main.py         # FastAPI app + routes: POST /separate, GET /health, GET /meta
  tests/            # pytest suite
  requirements.txt
  pyproject.toml
```

## API

| Route | Purpose |
| --- | --- |
| `POST /separate` | Stem separation (skeleton stub; implemented in tasks 1.2–1.5) |
| `GET /health` | Readiness probe: `{ status, model, version }` (no audio) |
| `GET /meta` | Service limits: `{ max_bytes, timeout_seconds, accepted }` (no audio) |

All error responses use the shared envelope:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

## Develop

```bash
# from backend/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# run the dev server
uvicorn app.main:app --reload

# run tests
pytest
```

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `DEMUCS_MAX_BYTES` | `104857600` | Max upload size (100 MB) |
| `DEMUCS_TIMEOUT_SECONDS` | `600` | Max processing time |
| `DEMUCS_MODEL` | `demucs` | Model id reported by `/health` |
