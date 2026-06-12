# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Pegasus tenant-runner image (Phase 3 Unit 8).
#
# Trusted shim that executes UNTRUSTED tenant workflow code. The image
# contains ONLY our code + the SDK toolchain:
#   - packages/workflows-sdk-python/  (pegasus_workflows + temporalio/httpx)
#   - apps/tenant-runner/             (this app)
# NO tenant code is baked in — artifacts are downloaded at startup via
# broker-issued presigned URLs, sha256-verified, and unpacked into
# per-workflow venvs under /home/pegasus/work.
#
# IMPORTANT: build context MUST be the repo root, NOT apps/tenant-runner/:
#   docker build -f apps/tenant-runner/Dockerfile -t pegasus-tenant-runner .
#
# Deliberate divergence from apps/temporal-worker/Dockerfile: packages are
# installed into the SYSTEM interpreter (not /opt/venv). The runner creates
# a per-workflow venv with `--system-site-packages --without-pip`, and venvs
# chain to the BASE interpreter — packages inside a /opt/venv would be
# invisible to them. System-site install is what makes venv creation work
# with zero network access (the SDK is already importable).
# ---------------------------------------------------------------------------

# ---- Builder stage --------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# SDK first — it changes far less often than the runner, so its layer caches.
COPY packages/workflows-sdk-python /build/packages/workflows-sdk-python
COPY apps/tenant-runner /build/apps/tenant-runner

# Install into an isolated prefix that maps 1:1 onto /usr/local in the
# runtime stage (system interpreter — see header for why not a venv).
RUN pip install --upgrade pip \
    && pip install --prefix=/install \
        /build/packages/workflows-sdk-python \
        /build/apps/tenant-runner


# ---- Runtime stage --------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # All env the runner reads at startup is documented in config.py;
    # ENV_NAME gets a default so a missing override surfaces a friendly
    # config error instead of a crash without context.
    ENV_NAME=unknown \
    RUNNER_WORK_DIR=/home/pegasus/work

# Non-root user — tenant code must not run with elevated privileges, and the
# shim doesn't need them either.
RUN groupadd --system pegasus \
    && useradd --system --gid pegasus --home /home/pegasus --create-home pegasus \
    && mkdir -p /home/pegasus/work \
    && chown pegasus:pegasus /home/pegasus/work

COPY --from=builder /install /usr/local

USER pegasus
WORKDIR /home/pegasus

# SIGTERM (ECS task stop) triggers the same graceful drain as idle-exit;
# see pegasus_tenant_runner/runner.py.
ENTRYPOINT ["python", "-m", "pegasus_tenant_runner.runner"]
