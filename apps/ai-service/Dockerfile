# apps/ai-service/Dockerfile — FastAPI voice-to-invoice microservice.
#
# Build context is the MONOREPO ROOT (root docker-compose.yml's
# `build.context: .`), purely for consistency with the other two
# Dockerfiles' COPY paths and the shared root .dockerignore — this app has
# no dependency on any other workspace member (pure Python, its own
# pyproject.toml, no pnpm/Node involvement at all).
#
# Multi-stage: builder (resolve + install deps into a venv, so the runtime
# stage doesn't need build tooling) -> runtime (slim base + venv + app code
# only).

FROM python:3.12-slim AS builder
WORKDIR /build

# Only the dependency manifest is needed to resolve+install deps; copying
# app/ separately below keeps this layer cached across source-only changes.
COPY apps/ai-service/pyproject.toml ./pyproject.toml
# `[build-system]` in pyproject.toml uses setuptools, and
# `[tool.setuptools.packages.find] include = ["app*"]` expects an `app/`
# package directory to exist for `pip install .` to succeed (setuptools
# validates the discovered package layout at build time even for a
# metadata-only resolve) — a minimal placeholder is enough for this layer;
# the real `app/` is copied in and takes over before the runtime stage.
RUN mkdir app && touch app/__init__.py

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# Production image: base `dependencies` only, not the `[dev]` extra
# (pytest/ruff — see pyproject.toml's `[project.optional-dependencies]`).
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY apps/ai-service/app ./app
COPY apps/ai-service/pyproject.toml ./pyproject.toml

# Matches the Caddyfile's `reverse_proxy ai-service:8000` and uvicorn's own
# conventional default port for this service.
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
