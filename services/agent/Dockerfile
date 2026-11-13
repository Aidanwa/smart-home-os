FROM python:3.12-slim
WORKDIR /app

# Install uv (pinned: a new release under a floating tag would invalidate every layer below)
COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /uvx /bin/

# Third-party packages first, from the lockfile and the workspace members' pyproject files only,
# so this slow layer (minutes on the Pi's SD card) is cached until uv.lock changes. Copying all
# of shared/ before it meant any edit there reinstalled everything.
# Compile the packages' bytecode now: otherwise every fresh container compiles them at
# startup (on the Pi's SD card that took ~25 s of each gateway restart).
ENV UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
COPY shared/pyproject.toml ./shared/
COPY services/gateway/pyproject.toml ./services/gateway/
COPY services/agent/pyproject.toml ./services/agent/
COPY services/database/pyproject.toml ./services/database/
RUN uv sync --frozen --no-dev --package agent --no-install-workspace

# Then the shared package itself (seconds)
COPY shared/ ./shared/
RUN uv sync --frozen --no-dev --package agent

# Correctly copy the agent source code, preserving the folder structure
COPY services/agent/ ./services/agent/

# Expose port if it acts as a server
EXPOSE 8001 

# Tell Python where to find your modules
ENV PYTHONPATH=/app/services/agent:/app

# Start the server using uvicorn via uv run
# --no-sync: the build installed the locked packages; don't re-check them at every start.
CMD ["uv", "run", "--no-sync", "uvicorn", "services.agent.main:app", "--host", "0.0.0.0", "--port", "8001"]