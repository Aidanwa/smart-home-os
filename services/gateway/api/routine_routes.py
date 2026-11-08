"""Routines CRUD, enable/disable, run-now, run history and a preview for the editor.

Routines are household-wide: any logged-in user may manage any routine. The creator is the
run-as owner (whose Spotify/LLM credentials later action types will use).
"""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database.core import get_db
from shared.database.models import Routine, RoutineRun, User, UserPreference
from api.auth import get_current_user
from scheduler.engine import Scheduler
from scheduler import agent_client
from scheduler.schema import (DeviceAction, DeviceCondition, DeviceTrigger, FadeAction, GroupAction, RoutineSpec,
                              SpotifyCtrlAction, SpotifyPlayAction, leaf_conditions)
from scheduler.timing import upcoming

ALERT_STATUSES = ("failed", "partial", "missed", "interrupted")

router = APIRouter(prefix="/api/routines", tags=["Routines"])


def get_scheduler(request: Request) -> Scheduler:
    return request.app.state.scheduler


class EnabledRequest(BaseModel):
    enabled: bool


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _out(r: Routine, sched: Scheduler, owner_name: str | None = None) -> dict:
    return {
        "id": str(r.id), "name": r.name, "description": r.description, "enabled": r.enabled,
        "mode": r.mode, "grace_minutes": r.grace_minutes,
        "triggers": r.triggers, "conditions": r.conditions, "actions": r.actions,
        "owner_user_id": str(r.owner_user_id), "owner_username": owner_name,
        "last_run_at": _iso(r.last_run_at), "last_run_status": r.last_run_status,
        "next_fire_at": _iso(sched.next_fire_at(r.id)), "running": sched.is_running(r.id),
        "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at),
    }


def _run_out(run: RoutineRun) -> dict:
    return {
        "id": str(run.id), "trigger_id": run.trigger_id, "trigger_type": run.trigger_type,
        "scheduled_for": _iso(run.scheduled_for), "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at), "status": run.status, "late_seconds": run.late_seconds,
        "trigger_detail": run.trigger_detail, "steps": run.steps, "error": run.error,
    }


def _apply(r: Routine, spec: RoutineSpec):
    data = spec.model_dump(mode="json")
    for field in ("name", "description", "enabled", "mode", "grace_minutes", "triggers", "conditions", "actions"):
        setattr(r, field, data[field])


def _require_location_for_sun(spec: RoutineSpec, sched: Scheduler):
    if spec.uses_sun() and sched.active and sched.loc is None:
        raise HTTPException(status_code=422, detail="Sunrise/sunset needs the home location: set your address in Settings → Home first.")


async def _get_or_404(db: AsyncSession, routine_id: uuid.UUID) -> Routine:
    r = await db.get(Routine, routine_id)
    if not r:
        raise HTTPException(status_code=404, detail="Routine not found")
    return r


@router.get("")
async def list_routines(db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
                        sched: Scheduler = Depends(get_scheduler)):
    rows = (await db.execute(
        select(Routine, User.username).join(User, User.id == Routine.owner_user_id).order_by(Routine.name)
    )).all()
    return {
        "timezone": sched.tz.key,
        "scheduler_active": sched.active,
        "routines": [_out(r, sched, name) for r, name in rows],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_routine(spec: RoutineSpec, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    _require_location_for_sun(spec, sched)
    r = Routine(owner_user_id=user.id)
    _apply(r, spec)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    await sched.reload(r.id)
    return _out(r, sched, user.username)


@router.post("/preview")
async def preview_routine(spec: RoutineSpec, request: Request, user=Depends(get_current_user),
                          sched: Scheduler = Depends(get_scheduler)):
    """Validates a draft (422 on errors) and returns upcoming fire times plus non-fatal warnings."""
    bus = request.app.state.bus
    warnings = []
    raw_groups = await bus.redis.get("gateway:groups")
    group_ids = {g.get("id") for g in json.loads(raw_groups)} if raw_groups else set()
    twin = {k: json.loads(v) for k, v in (await bus.redis.hgetall("gateway:digital_twin")).items()}
    for a in spec.actions:
        device = getattr(a, "device", None) if isinstance(a, (DeviceAction, FadeAction)) else None
        group = getattr(a, "group", None) if isinstance(a, (GroupAction, FadeAction)) else None
        if device is not None and device not in twin:
            warnings.append(f"Action {a.id}: device {device} isn't on the network")
        if group is not None and group not in group_ids:
            warnings.append(f"Action {a.id}: group {group} doesn't exist")
    speakers = {a.speaker for a in spec.actions if isinstance(a, (SpotifyPlayAction, SpotifyCtrlAction)) and a.speaker}
    if speakers:
        try:
            found = [d["name"].lower() for d in (await agent_client.call_tool(user.id, "spot_devices")).get("data", [])]
            for sp in sorted(speakers):
                if not any(sp.lower() in name for name in found):
                    warnings.append(f"Spotify speaker '{sp}' isn't available right now")
        except agent_client.AgentError as e:
            warnings.append(f"Couldn't check Spotify: {e}")
    watched = [(f"Trigger {t.id}", t) for t in spec.triggers if isinstance(t, DeviceTrigger)]
    watched += [(f"Condition {i}", c) for i, c in enumerate(leaf_conditions(spec.conditions), 1) if isinstance(c, DeviceCondition)]
    for label, item in watched:
        if item.device not in twin:
            warnings.append(f"{label}: device {item.device} isn't on the network")
        elif item.attribute not in twin[item.device]:
            name = twin[item.device].get("friendly_name", item.device)
            warnings.append(f"{label}: {name} hasn't reported '{item.attribute}' yet")
    if spec.uses_sun() and sched.loc is None:
        warnings.append("Sunrise/sunset needs the home location (Settings → Home)")
    if not spec.triggers:
        warnings.append("No triggers: this routine only runs when you press Run now")
    if not sched.active:
        warnings.append("The scheduler isn't running on this gateway; see the gateway logs")
    fires = upcoming(spec.triggers, datetime.now(timezone.utc), sched.tz, sched.loc) if spec.enabled else []
    return {"timezone": sched.tz.key, "next_fires": [_iso(t) for t in fires], "warnings": warnings}


@router.get("/attributes")
async def device_attributes(request: Request, user=Depends(get_current_user)):
    """What each device reports, for the trigger/condition pickers: Z2M's exposes metadata where
    known (type, unit, allowed values), else guessed from the device's current reading."""
    bus = request.app.state.bus
    raw = await bus.redis.get("gateway:device_exposes")
    exposes = json.loads(raw) if raw else {}
    twin = {k: json.loads(v) for k, v in (await bus.redis.hgetall("gateway:digital_twin")).items()}
    skip = {"ieee_address", "friendly_name", "linkquality", "last_seen", "update"}
    out = {}
    for ieee, state in twin.items():
        props = exposes.get(ieee)
        if props is None:
            props = []
            for k, v in state.items():
                if k in skip or isinstance(v, (dict, list)):
                    continue
                if isinstance(v, bool):
                    props.append({"property": k, "type": "binary", "value_on": True, "value_off": False})
                elif isinstance(v, (int, float)):
                    props.append({"property": k, "type": "numeric"})
                else:
                    props.append({"property": k, "type": "text"})
        out[ieee] = {"friendly_name": state.get("friendly_name", ieee), "properties": props,
                     "current": {p["property"]: state.get(p["property"]) for p in props}}
    return out


@router.get("/spotify/devices")
async def spotify_devices(user: User = Depends(get_current_user)):
    """Speakers on the current user's Spotify account (for the editor's speaker picker)."""
    try:
        return (await agent_client.call_tool(user.id, "spot_devices")).get("data", [])
    except agent_client.AgentError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/spotify/search")
async def spotify_search(q: str, user: User = Depends(get_current_user)):
    """Music picker: the user's own playlists first, then Spotify's catalogue."""
    q = q.strip()
    if len(q) < 2:
        return []
    mine, catalog = await asyncio.gather(
        agent_client.call_tool(user.id, "spot_search_playlist", query=q),
        agent_client.call_tool(user.id, "spot_search", q=q, types=["playlist", "album", "artist", "track"], limit=4),
        return_exceptions=True,
    )
    if isinstance(mine, Exception) and isinstance(catalog, Exception):
        raise HTTPException(status_code=502, detail=str(catalog))
    out, seen = [], set()

    def add(kind, name, subtitle, uri):
        if uri and name and uri not in seen:
            seen.add(uri)
            out.append({"kind": kind, "name": name, "subtitle": subtitle, "uri": uri})

    if not isinstance(mine, Exception):
        for p in mine.get("data") or []:
            add("playlist", p.get("name"), "Your playlist", p.get("uri"))
    if not isinstance(catalog, Exception):
        data = catalog.get("data") or {}
        for p in data.get("playlists", []):
            add("playlist", p.get("name"), f"Playlist · {p.get('owner')}", p.get("uri"))
        for a in data.get("albums", []):
            add("album", a.get("name"), f"Album · {', '.join(a.get('artists') or [])}", a.get("uri"))
        for a in data.get("artists", []):
            add("artist", a.get("name"), "Artist", a.get("uri"))
        for t in data.get("tracks", []):
            add("track", t.get("name"), f"Song · {', '.join(t.get('artists') or [])}", t.get("uri"))
    return out


@router.get("/alerts")
async def alerts(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Failed/partial/missed/interrupted runs since this user last opened the Routines tab."""
    prefs = await db.get(UserPreference, user.id)
    seen = (prefs.ui_settings or {}).get("routines_seen_at") if prefs else None
    since = datetime.fromisoformat(seen) if seen else datetime.now(timezone.utc) - timedelta(days=7)
    count = await db.scalar(
        select(func.count()).select_from(RoutineRun)
        .where(RoutineRun.status.in_(ALERT_STATUSES), RoutineRun.started_at > since)
    )
    return {"count": count or 0, "since": since.isoformat()}


@router.post("/alerts/seen")
async def alerts_seen(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    prefs = await db.get(UserPreference, user.id)
    if prefs is None:
        prefs = UserPreference(user_id=user.id, ui_settings={}, agent_settings={})
        db.add(prefs)
    prefs.ui_settings = {**(prefs.ui_settings or {}), "routines_seen_at": datetime.now(timezone.utc).isoformat()}
    await db.commit()
    return {"count": 0}


@router.get("/{routine_id}")
async def get_routine(routine_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                      user=Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    return _out(await _get_or_404(db, routine_id), sched)


@router.put("/{routine_id}")
async def update_routine(routine_id: uuid.UUID, spec: RoutineSpec, db: AsyncSession = Depends(get_db),
                         user=Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    r = await _get_or_404(db, routine_id)
    _require_location_for_sun(spec, sched)
    _apply(r, spec)
    await db.commit()
    await db.refresh(r)
    await sched.reload(r.id)
    return _out(r, sched)


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_routine(routine_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                         user=Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    r = await _get_or_404(db, routine_id)
    await db.delete(r)
    await db.commit()
    await sched.reload(routine_id)
    return None


@router.post("/{routine_id}/enabled")
async def set_enabled(routine_id: uuid.UUID, body: EnabledRequest, db: AsyncSession = Depends(get_db),
                      user=Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    r = await _get_or_404(db, routine_id)
    r.enabled = body.enabled
    await db.commit()
    await db.refresh(r)
    await sched.reload(r.id)
    return _out(r, sched)


@router.post("/{routine_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_now(routine_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                  user=Depends(get_current_user), sched: Scheduler = Depends(get_scheduler)):
    await _get_or_404(db, routine_id)
    try:
        run_id = await sched.run_now(routine_id)
    except LookupError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if run_id is None:
        raise HTTPException(status_code=409, detail="This routine is already running (mode: single)")
    return {"run_id": str(run_id)}


@router.get("/{routine_id}/runs")
async def list_runs(routine_id: uuid.UUID, limit: int = 20, db: AsyncSession = Depends(get_db),
                    user=Depends(get_current_user)):
    await _get_or_404(db, routine_id)
    runs = (await db.scalars(
        select(RoutineRun).where(RoutineRun.routine_id == routine_id)
        .order_by(RoutineRun.started_at.desc()).limit(max(1, min(limit, 100)))
    )).all()
    return [_run_out(run) for run in runs]
