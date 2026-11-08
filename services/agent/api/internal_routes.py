"""Internal endpoints for the gateway's routine scheduler. Runs allow-listed tools directly, no LLM.

Reachable only on the Docker network: the agent publishes no host port, and the gateway proxies
only /api/agent/*, never /internal/*. Requests must carry a gateway-minted JWT with
scope "internal" (a normal session cookie is not accepted).
"""
import json
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (ROUTINE_RUN_EXCLUDED_TOOLS, ROUTINE_RUN_NOTE, SYSTEM_PROMPT, TOOL_REGISTRY,
                              gateway_client, memory_manager, spotify_service, weather_service)
from core.orchestrator import SmartHomeOrchestrator
from core.provider_factory import build_llm_provider
from shared.database.core import get_db
from shared.security import JWT_SECRET_KEY

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["Internal"])


def internal_user(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Internal token missing")
    try:
        payload = jwt.decode(auth[7:], JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Internal token invalid or expired")
    if payload.get("scope") != "internal" or not payload.get("sub"):
        raise HTTPException(status_code=403, detail="Not an internal token")
    return payload["sub"]


async def _devices(user_id: str, **_):
    data = await spotify_service._request(user_id, "GET", "/me/player/devices")
    return {"status": "success", "data": [
        {"name": d.get("name"), "type": d.get("type"), "is_active": d.get("is_active"), "volume": d.get("volume_percent")}
        for d in data.get("devices", []) if d.get("name")
    ]}


async def _player(user_id: str, **_):
    """What's playing where, at what volume (used by the volume ramp to notice manual changes)."""
    st = await spotify_service._request(user_id, "GET", "/me/player") or {}
    dev = st.get("device") or {}
    return {"status": "success", "data": {
        "is_playing": bool(st.get("is_playing")), "device": dev.get("name"), "volume": dev.get("volume_percent"),
    }}


TOOLS = {
    "spot_play": spotify_service.spotify_play,
    "spot_ctrl": spotify_service.spotify_controller,
    "spot_search": spotify_service.spotify_search,
    "spot_search_playlist": spotify_service.spotify_search_playlist,
    "spot_devices": _devices,
    "spot_player": _player,
}


class ToolCall(BaseModel):
    args: dict = Field(default_factory=dict)


@router.post("/tools/{name}")
async def run_tool(name: str, call: ToolCall, user_id: str = Depends(internal_user)):
    tool = TOOLS.get(name)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' isn't available internally")
    args = {k: v for k, v in call.args.items() if k != "user_id"}
    try:
        result = await tool(user_id=user_id, **args)
    except Exception as e:
        # Tools normally return {"status": "error"} themselves; this catches config problems
        # such as Spotify not being linked (raised from the token code).
        logger.warning(f"Internal tool {name} failed: {e}")
        return {"status": "error", "message": str(e)}
    logger.info(f"Internal tool {name} for user {user_id}: {result.get('status')}")
    return result


class AgentRun(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    routine: str = ""


def _tool_ok(output: str) -> tuple[bool, str | None]:
    try:
        data = json.loads(output)
    except Exception:
        return True, None
    if not isinstance(data, dict):
        return True, None
    if data.get("error"):
        return False, str(data["error"])
    if data.get("status") in ("error", "partial_success"):
        return False, str(data.get("message") or data.get("status"))
    return True, None


@router.post("/agent/run")
async def run_agent(body: AgentRun, user_id: str = Depends(internal_user), db: AsyncSession = Depends(get_db)):
    """'Ask the agent' routine action: one instruction through the LLM loop, unattended. No chat
    history is read or written, and memory/routine tools are withheld."""
    try:
        llm = await build_llm_provider(user_id, db)
    except ValueError as e:
        return {"status": "error", "message": str(e), "reply": "", "tool_calls": []}

    orch = SmartHomeOrchestrator(
        llm_provider=llm, gateway_client=gateway_client, memory_manager=memory_manager,
        weather_service=weather_service, spotify_service=spotify_service,
        system_prompt_tmpl=SYSTEM_PROMPT, tool_map=TOOL_REGISTRY, ephemeral=True,
        prompt_suffix=ROUTINE_RUN_NOTE.format(routine=body.routine or "unnamed"),
        excluded_tools=ROUTINE_RUN_EXCLUDED_TOOLS,
    )
    reply, calls, pending = "", [], []
    try:
        async for chunk in orch.process_intent_stream(user_id, body.prompt):
            kind = chunk.get("type")
            if kind == "text_chunk":
                reply += chunk["content"]
            elif kind == "tool_call" and chunk.get("status") == "pending":
                try:
                    args = json.loads(chunk.get("arguments") or "{}")
                except Exception:
                    args = chunk.get("arguments")
                entry = {"name": chunk.get("name"), "arguments": args, "ok": None}
                calls.append(entry)
                pending.append(entry)
            elif kind == "tool_result" and pending:
                entry = pending.pop(0)  # results come back in call order
                entry["ok"], err = _tool_ok(chunk.get("output") or "")
                if err:
                    entry["error"] = err[:300]
    except Exception as e:
        logger.exception("Routine agent run crashed")
        return {"status": "error", "message": f"Agent run failed: {e}", "reply": reply.strip(), "tool_calls": calls}

    failed = [c for c in calls if c["ok"] is False]
    if "[Error:" in reply:
        status, message = "error", "The AI provider returned an error"
    elif "Max reasoning steps reached" in reply:
        status, message = "error", "The agent hit its step limit without finishing"
    elif failed:
        status, message = "error", "; ".join(f"{c['name']}: {c.get('error')}" for c in failed)
    else:
        status, message = "success", None
    logger.info(f"Routine agent run for '{body.routine}': {status}, {len(calls)} tool call(s)")
    return {"status": status, "message": message, "reply": reply.strip(), "tool_calls": calls}
