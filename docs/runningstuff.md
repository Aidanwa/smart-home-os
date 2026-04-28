

## Running api from root dir:

When you run a command from the root, Python looks for a folder named core in the root. Since core is tucked away inside services/gateway/core, Python can't find it.

Option 1: The Uvicorn --app-dir Flag (Easiest)
Uvicorn has a specific flag that tells it, "Treat this directory as the base for the application." This effectively adds services/gateway to your Python path so that from core... works.

Run this from the root:

PowerShell
uv run --package gateway uvicorn --app-dir services/gateway main:app --reload
Note: Since we told Uvicorn to look inside services/gateway, the path to the app is just main:app instead of services.gateway.main:app.