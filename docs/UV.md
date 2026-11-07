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
Now, in your Agent code, you can do `from shared.database.models import User`.

Caveat: `shared/pyproject.toml` installs top-level packages `database` and `alembic`, not `shared`.
`shared.*` imports actually resolve as a namespace package because the repo root is on `sys.path`
(Dockerfiles set `PYTHONPATH=/app/services/<svc>:/app`; locally, run from the repo root).

