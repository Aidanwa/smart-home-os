# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy the rest of the frontend code and build it
# This generates the static assets inside /app/frontend/dist
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build the FastAPI Backend
# ==========================================
FROM python:3.12-slim
WORKDIR /app

# Install uv directly from the official astral image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy the python dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies using uv (creates a blazing fast virtualenv)
RUN uv sync --frozen --no-dev

# Copy the rest of the backend source code
COPY . .

# IMPORTANT: Copy the built frontend assets from Stage 1 
# and place them exactly where main.py expects them
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose the FastAPI port
EXPOSE 8000

# Start the server using uvicorn via uv
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]