# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy package files using paths relative to project root
COPY services/gateway/frontend/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY services/gateway/frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build the FastAPI Backend
# ==========================================
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
RUN uv sync --frozen --no-dev --package gateway --no-install-workspace

# Then the shared package itself (seconds)
COPY shared/ ./shared/
RUN uv sync --frozen --no-dev --package gateway

# Copy the backend source code
COPY services/gateway/ ./services/gateway/

# IMPORTANT: Copy the built frontend assets from Stage 1 
# Put them exactly where main.py expects them (e.g., inside services/gateway)
COPY --from=frontend-builder /app/frontend/dist ./services/gateway/frontend/dist

# Expose the FastAPI port
EXPOSE 8000

# Tell Python where to find the 'core' and 'api' folders
ENV PYTHONPATH=/app/services/gateway:/app

# Start the server using uvicorn via uv. 
# Make sure to run it from the correct directory or use the module path.
# --no-sync: the build installed the locked packages; don't re-check them at every start.
CMD ["uv", "run", "--no-sync", "uvicorn", "services.gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]