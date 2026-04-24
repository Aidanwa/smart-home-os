Managing Dependencies
To add a dependency to a specific service, you use the --package flag.

Add FastAPI to Gateway: uv add fastapi --package gateway

Add LangChain to Agent: uv add langchain --package agent

Sync everything: uv sync (This creates one .venv at the root that contains everything for your IDE/LSP to work perfectly).



The "Shared" Package Logic
Since both your Gateway and Agent will need to know the database schema (your init.sql tables), you should put your SQLAlchemy/SQLModel code in the /shared folder.

In /services/agent/pyproject.toml, you simply add:

Ini, TOML
[tool.uv.sources]
shared = { workspace = true }
Now, in your Agent code, you can just do from shared.models import User. uv handles the "linking" automatically.



Docker Integration (The Production Environment)
This is where uv really shines. You want to use a multi-stage build. You use uv to build the environment, but you don't necessarily need the uv binary in your final, tiny production image.

Example Dockerfile for /services/gateway
Dockerfile
# Stage 1: Build
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app

# Copy the workspace files
COPY uv.lock pyproject.toml /app/
COPY shared /app/shared
COPY services/gateway /app/services/gateway

# Install dependencies for the gateway package specifically
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package gateway

# Stage 2: Runtime
FROM python:3.12-slim-bookworm

WORKDIR /app

# Copy the venv from the builder
COPY --from=builder /app/.venv /app/.venv

# Ensure we use the venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy the source code
COPY services/gateway/main.py /app/main.py

CMD ["python", "main.py"]