"""Gateway -> agent internal calls (Spotify tools without the LLM). See services/agent/api/internal_routes.py."""
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
import jwt

from shared.security import JWT_SECRET_KEY

logger = logging.getLogger(__name__)

AGENT_URL = os.getenv("AGENT_INTERNAL_URL", "http://agent:8001")
_client = httpx.AsyncClient(base_url=AGENT_URL, timeout=20.0)


class AgentError(Exception):
    """The agent couldn't be reached, or the tool reported an error. The message is user-readable."""


def _token(user_id: str) -> str:
    return jwt.encode(
        {"sub": str(user_id), "scope": "internal", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        JWT_SECRET_KEY, algorithm="HS256",
    )


async def call_tool(user_id, name: str, **args) -> dict:
    """Run an agent tool as `user_id`. Returns the tool's result dict; raises AgentError when the
    agent is unreachable or the tool returns status 'error'."""
    try:
        res = await _client.post(f"/internal/tools/{name}", json={"args": args},
                                 headers={"Authorization": f"Bearer {_token(user_id)}"})
    except httpx.RequestError as e:
        raise AgentError(f"Agent unreachable ({type(e).__name__}); is the agent container running?")
    if res.status_code != 200:
        raise AgentError(f"Agent refused {name} (HTTP {res.status_code}): {res.text[:200]}")
    data = res.json()
    if data.get("status") == "error":
        raise AgentError(_tidy(data.get("message") or f"{name} failed"))
    return data


def _tidy(message: str) -> str:
    # Agent messages are written for the LLM ("[System Observation: ... Prompt the user ...]").
    if "[System Observation:" in message:
        if "absent" in message:
            return "Spotify isn't linked for this routine's owner (Settings → External Providers)."
        if "incomplete" in message:
            return "Spotify credentials are incomplete; re-link Spotify in Settings."
    return message.replace("Do not retry. ", "")


async def run_agent(user_id, prompt: str, routine_name: str, notify: bool = False) -> dict:
    """Run an instruction through the agent's LLM loop (no chat history, no memory writes).
    Returns {status, reply, tool_calls: [{name, arguments, ok, error?}], message?}."""
    try:
        res = await _client.post("/internal/agent/run", json={"prompt": prompt, "routine": routine_name, "notify": notify},
                                 headers={"Authorization": f"Bearer {_token(user_id)}"}, timeout=120.0)
    except httpx.RequestError as e:
        raise AgentError(f"Agent unreachable ({type(e).__name__}); is the agent container running?")
    if res.status_code != 200:
        raise AgentError(f"Agent refused the instruction (HTTP {res.status_code}): {res.text[:200]}")
    return res.json()
