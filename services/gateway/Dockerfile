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

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy the ROOT lockfile and workspace configurations
COPY pyproject.toml uv.lock ./
# If you have a shared folder, copy it now so uv sync can install it
COPY shared/ ./shared/

# Sync dependencies (this uses the root lockfile but creates the venv in /app)
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
CMD ["uv", "run", "uvicorn", "services.gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]