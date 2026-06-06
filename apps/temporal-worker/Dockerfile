# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Pegasus Temporal Worker image (Phase 2 Unit 5).
#
# IMPORTANT: build context MUST be the repo root, NOT apps/temporal-worker/.
# The COPY lines below reach into sibling packages:
#   - packages/workflows-sdk-python/  (the SDK; provides PegasusClient, the
#     `pegasus_workflow` decorator that workflow modules use, and the
#     temporalio re-export surface)
#   - packages/workflows-stdlib/      (the curated workflows the worker
#     registers — `send_quote_followup` for Phase 2 Unit 5)
#   - apps/temporal-worker/           (this app)
#
# CI invokes:
#   docker build -f apps/temporal-worker/Dockerfile -t <tag> .
# (the trailing dot is the repo root). See .github/workflows/temporal-worker.yml.
# ---------------------------------------------------------------------------

# ---- Builder stage --------------------------------------------------------
# Use a full Python image so any wheels with native deps (grpcio etc.) build
# cleanly, then copy the resolved site-packages into a slim runtime stage.
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# System deps needed only at build time (gcc for any native wheel fallback;
# pruned in the runtime stage). Pinned via apt to whatever the slim base
# happens to ship to keep image-size small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy the SDK + stdlib package sources first so their layers are cached
# independently of the worker source — they change far less often.
COPY packages/workflows-sdk-python /build/packages/workflows-sdk-python
COPY packages/workflows-stdlib /build/packages/workflows-stdlib
COPY apps/temporal-worker /build/apps/temporal-worker

# Install into a single venv that we'll copy whole into the runtime stage.
# Editable installs of the SDK and stdlib so any future changes flow without
# a rebuild of the wheel cache.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip \
    && pip install /build/packages/workflows-sdk-python \
    && pip install /build/apps/temporal-worker

# stdlib is a Python source tree, not a packaged wheel — bundle it as plain
# files into /opt/stdlib so the worker registry can import it by adjusting
# sys.path. Keeping it source-form (vs. installing) preserves the
# curated-only boundary; the worker only registers what registry.py
# explicitly maps, regardless of what's importable.
RUN cp -r /build/packages/workflows-stdlib /opt/stdlib


# ---- Runtime stage --------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Make /opt/stdlib importable so the worker can `import send_quote_followup.workflow`.
    PYTHONPATH=/opt/stdlib \
    # All env the worker reads at startup is documented in config.py;
    # provide a default ENV_NAME so the entrypoint surfaces a friendly
    # error rather than crashing if the operator forgets one.
    ENV_NAME=unknown

# Non-root user — the worker has no need for elevated privileges.
RUN groupadd --system pegasus && useradd --system --gid pegasus --home /home/pegasus --create-home pegasus

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/stdlib /opt/stdlib

ENV PATH="/opt/venv/bin:$PATH"

USER pegasus
WORKDIR /home/pegasus

# Entrypoint: the worker module. SIGTERM is delivered by ECS/Fargate on
# scale-in (or `aws ecs update-service --force-new-deployment`); worker.py
# installs a handler that triggers graceful drain.
ENTRYPOINT ["python", "-m", "pegasus_temporal_worker.worker"]
