## Running gateway FE + BE from docker container:

bash (in root)
docker-compose up --build -d gateway

## Running gateway api and frontend from root dir:

Option 1: The Uvicorn --app-dir Flag (Easiest)
Uvicorn has a specific flag that tells it, "Treat this directory as the base for the application." This effectively adds services/gateway to your Python path so that from core... works.

Run this from the root:

PowerShell
uv run --package gateway uvicorn --app-dir services/gateway main:app --reload
Note: Since we told Uvicorn to look inside services/gateway, the path to the app is just main:app instead of services.gateway.main:app

-----------------------------------------------
When you are actively developing the UI, the best workflow is to run them separately on your host machine:

Terminal 1 (Backend - port 8000):
cd services/gateway
uv run uvicorn main:app --reload

Terminal 2 (Frontend - port 5173): 
cd services/gateway/frontend
npm run dev

Note: If you do this, you'll need to add a proxy in your vite.config.ts so the frontend on 5173 knows to forward /api requests to 8000.
