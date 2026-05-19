FROM python:3.12-slim
WORKDIR /app

# Install astral uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy the ROOT lockfile and workspace configurations
COPY pyproject.toml uv.lock ./

# Sync dependencies for the agent
RUN uv sync --frozen --no-dev --package agent

# Correctly copy the agent source code, preserving the folder structure
COPY services/agent/ ./services/agent/

# Expose port if it acts as a server
EXPOSE 8001 

# Tell Python where to find your modules
ENV PYTHONPATH=/app/services/agent:/app

# Start the server using uvicorn via uv run
CMD ["uv", "run", "uvicorn", "services.agent.main:app", "--host", "0.0.0.0", "--port", "8001"]