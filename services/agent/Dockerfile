FROM python:3.12-slim
WORKDIR /app

# Install astral uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy the ROOT lockfile and workspace configurations
COPY pyproject.toml uv.lock ./

# If you have a shared folder, copy it now so uv sync can install it
COPY shared/ ./shared/

# Sync dependencies for the agent
# Compile the packages' bytecode now: otherwise every fresh container compiles them at
# startup (on the Pi's SD card that took ~25 s of each gateway restart).
ENV UV_COMPILE_BYTECODE=1
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