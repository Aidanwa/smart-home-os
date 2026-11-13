# services/agent/tools/routines_api.py
"""Agent tools for routines (rt_*). They call the gateway's /api/routines as the chatting user.

The model refers to devices and groups by name; routines store IEEE addresses and group ids, so
names are translated both ways here. Validation is the gateway's (the same rules as the editor);
its errors are handed back so the model can fix the JSON and try again.
"""
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from tools.gateway_api import GatewayClient

logger = logging.getLogger(__name__)

ROUTINE_FORMAT = """Routine JSON for rt_save. Refer to devices and groups by their names from Home State.
{"name": str, "enabled": true, "mode": "single"|"restart", "grace_minutes": 5, "delete_when_done": false,
 "triggers": [...], "conditions": [...], "actions": [...]}   (ids like "t1"/"a1" are optional)
TRIGGERS (any one starts it; [] = manual only):
 {"type":"time","at":"HH:MM","days":["mon",..,"sun"] or null (= every day),"date":null}
  One-time (a reminder): "date":"YYYY-MM-DD" with "days":null; it fires once; finished ones drop out of rt_list.
  For simple reminders and anything that happens only once, set "delete_when_done": true (only allowed when every
  trigger has a date): it's deleted after it runs successfully. Leave it false if the user may want to reuse it.
 {"type":"sun","event":"sunrise"|"sunset","offset_min":-30,"days":null}
 {"type":"room","room":ROOM_NAME,"state":"occupied"|"empty","for_s":seconds or null,"cooldown_s":0,"fire_on_start":false}
  A room is occupied while any presence/motion sensor in it (see Rooms in Home State) detects someone.
  Prefer this over a sensor's presence reading. E.g. "lights off when the bedroom's been empty 10 min" =
  room trigger state "empty", for_s 600.
 {"type":"presence","who":USERNAME|"anyone"|"everyone","state":"home"|"away","for_s":seconds or null,"cooldown_s":0,"fire_on_start":false}
  Home/away from people's phones (see Presence in Home State). "anyone" home = first person arrives; "anyone" away =
  last person leaves (nobody home); "everyone" home = the last person arrives. For leaving, use for_s 300 so a phone
  briefly crossing the edge of home doesn't fire it.
 {"type":"device","device":NAME,"attribute":"state"|"temperature"|"power"|"action"|...,
  "op":"eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"changes","value":X (null for changes),
  "rearm":margin or null (numeric ops only: won't refire until it moves back past threshold by this much),
  "for_s":seconds the match must hold or null, "cooldown_s":0, "fire_on_start":false (also fire if already true)}
  Button presses: attribute "action", op "eq" with the button value (e.g. "on_press"), or "changes" for any press.
CONDITIONS (all must hold; for OR use one {"type":"any","conditions":[...]}):
 {"type":"time_window","after":"22:00","before":"06:00"}  {"type":"days","days":["sat","sun"]}
 {"type":"sun","state":"up"|"down"}  {"type":"device","device":NAME,"attribute":..,"op":"eq"|"ne"|"gt"|"gte"|"lt"|"lte","value":X}
 {"type":"room","room":ROOM_NAME,"state":"occupied"|"empty","for_s":seconds or null (has been for at least this long)}
 {"type":"presence","who":USERNAME|"anyone"|"everyone","state":"home"|"away","for_s":null}  ("anyone" away = nobody home)
 Only when it's dark in a room: a device condition on its sensor's "illuminance" (lux), e.g. "lt" 30.
ACTIONS (in order):
 {"type":"device","device":NAME,"set":{"state":"ON"|"OFF"|"TOGGLE","brightness":0-254,"color_temp":150-500,"transition":s}}
 {"type":"group","group":GROUP_NAME,"set":{...same...}}
 {"type":"delay","seconds":N}  (max 43200)
 {"type":"fade","device":NAME or null,"group":GROUP_NAME or null,"to_brightness":0-254 (0 = off),
  "from_brightness":1-254 or null,"to_color_temp":mired or null,"from_color_temp":null,"duration_s":N (max 6000),
  "method":"native","wait":false}   (mired = 1000000/Kelvin; 2700K≈370, 4000K=250)
 {"type":"spotify_play","speaker":"Bedroom Speakers","uri":"spotify:playlist:..." (get it with spot_search/spot_search_playlist),
  "title":str,"volume":0-100 or null,"ramp_to":0-100 or null,"ramp_s":seconds or null,"shuffle":true|false|null}
 {"type":"spotify_ctrl","cmd":"pause"|"resume"|"next"|"previous"|"volume","speaker":null,"volume":null}
 {"type":"agent","prompt":"plain-language instruction","notify":null|"owner"|"everyone"}  (uses the LLM; max 2 runs/hour;
  notify sends the agent's reply as a push notification, e.g. "each morning, summarise the weather and tell me")
 {"type":"notify","title":str or null (null = routine name),"message":str,"to":"owner"|"everyone"}
  Push notification to the phone app. "owner" = the user you're talking to. E.g. "remind me at 6 to take
  the bins out" = one-time time trigger + notify; "tell me when the washer is done" = power trigger + notify.
 {"type":"routine","routine":ROUTINE_NAME,"wait":false,"check_conditions":false}
  Starts another routine (its own run). wait: finish it before the next action. check_conditions: obey its
  conditions (default: ignored, like Run now). Off routines don't run; loops are refused.
Values are device-native: temperature is always °C (convert from °F), brightness 0-254 (50% = 127).
"""


_SPEC_FIELDS = ("name", "description", "enabled", "mode", "grace_minutes", "delete_when_done", "triggers", "conditions",
                "actions")

# Fields left out of rt_list output when they hold their default (saves tokens; rt_save fills them back in).
_DEFAULTS = {"stop_on_error": False, "wait": False, "check_conditions": False, "fire_on_start": False, "cooldown_s": 0,
             "method": "native", "delete_when_done": False}


def _strip_nulls(v):
    """Drop None values and defaulted fields. Other False values (shuffle off, contact false) stay."""
    if isinstance(v, dict):
        return {k: _strip_nulls(x) for k, x in v.items()
                if x is not None and not (k in _DEFAULTS and x == _DEFAULTS[k])}
    if isinstance(v, list):
        return [_strip_nulls(x) for x in v]
    return v


class RoutineTools:
    def __init__(self, gateway: GatewayClient):
        self.gw = gateway
        self._rooms: dict[str, str] = {}  # room id -> name, loaded by _names
        self._people: dict[str, str] = {}  # user id -> username (presence "who"), loaded by _names

    async def _call(self, user_id, method: str, path: str, **kw):
        return await self.gw.client.request(method, path, cookies=self.gw._mint_user_context_cookie(user_id), **kw)

    async def _names(self, user_id, routines: list | None = None) -> tuple[dict, dict, dict]:
        """({ieee: device name}, {group id: group name}, {routine id: routine name}).
        Pass `routines` (the /api/routines list) when it's already fetched."""
        devs = (await self._call(user_id, "GET", "/api/devices")).json().get("devices", {})
        groups = (await self._call(user_id, "GET", "/api/groups")).json() or []
        if routines is None:
            res = await self._call(user_id, "GET", "/api/routines")
            routines = res.json().get("routines", []) if res.status_code == 200 else []
        rooms_res = await self._call(user_id, "GET", "/api/zones/occupancy")
        self._rooms = {rid: r.get("name", rid) for rid, r in rooms_res.json().items()} if rooms_res.status_code == 200 else {}
        pres_res = await self._call(user_id, "GET", "/api/presence")
        self._people = {p["user_id"]: p["username"] for p in pres_res.json().get("people", [])} if pres_res.status_code == 200 else {}
        return ({ieee: d.get("friendly_name", ieee) for ieee, d in devs.items()},
                {g["id"]: g["friendly_name"] for g in groups},
                {r["id"]: r["name"] for r in routines})

    # ---------------------------------------------------------------- name translation

    @staticmethod
    def _walk(routine: dict):
        """Yield every dict that can hold a device/group reference."""
        for t in routine.get("triggers") or []:
            yield t
        for c in routine.get("conditions") or []:
            yield c
            for sub in (c.get("conditions") or []) if isinstance(c, dict) else []:
                yield sub
        for a in routine.get("actions") or []:
            yield a

    def _to_ids(self, routine: dict, devices: dict, groups: dict, routines: dict) -> list[str]:
        dev_by_name = {n.lower(): ieee for ieee, n in devices.items()}
        grp_by_name = {n.lower(): gid for gid, n in groups.items()}
        rt_by_name = {n.lower(): rid for rid, n in routines.items()}
        room_by_name = {n.lower(): rid for rid, n in self._rooms.items()}
        problems = []
        for item in self._walk(routine):
            if not isinstance(item, dict):
                continue
            if item.get("type") == "room" and isinstance(item.get("room"), str):
                rm = item["room"]
                if rm.lower() in room_by_name:
                    item["room"] = room_by_name[rm.lower()]
                elif rm not in self._rooms:
                    problems.append(f"unknown room '{rm}' (rooms: {', '.join(sorted(self._rooms.values())) or 'none'})")
            if item.get("type") == "presence" and isinstance(item.get("who"), str) and item["who"] not in ("anyone", "everyone"):
                who = item["who"]
                person_by_name = {n.lower(): uid for uid, n in self._people.items()}
                if who.lower() in person_by_name:
                    item["who"] = person_by_name[who.lower()]
                elif who not in self._people:
                    problems.append(f"unknown person '{who}' (people: {', '.join(sorted(self._people.values())) or 'none'}; or anyone/everyone)")
            if item.get("type") == "routine" and isinstance(item.get("routine"), str):
                r = item["routine"]
                if r.lower() in rt_by_name:
                    item["routine"] = rt_by_name[r.lower()]
                elif r not in routines:
                    problems.append(f"unknown routine '{r}' (routines: {', '.join(sorted(routines.values())) or 'none'})")
            d = item.get("device")
            if isinstance(d, str) and d and not d.startswith("0x"):
                if d.lower() in dev_by_name:
                    item["device"] = dev_by_name[d.lower()]
                else:
                    problems.append(f"unknown device '{d}'")
            g = item.get("group")
            if isinstance(g, str):
                if g.lower() in grp_by_name:
                    item["group"] = grp_by_name[g.lower()]
                elif g.isdigit():
                    item["group"] = int(g)
                else:
                    problems.append(f"unknown group '{g}'")
        if problems:
            problems.append(f"devices: {', '.join(sorted(devices.values()))}; groups: {', '.join(sorted(groups.values())) or 'none'}")
        return problems

    def _to_names(self, routine: dict, devices: dict, groups: dict, routines: dict) -> dict:
        for item in self._walk(routine):
            if isinstance(item, dict):
                if item.get("type") == "room" and item.get("room") in self._rooms:
                    item["room"] = self._rooms[item["room"]]
                if item.get("type") == "presence" and item.get("who") in self._people:
                    item["who"] = self._people[item["who"]]
                if item.get("type") == "routine" and item.get("routine") in routines:
                    item["routine"] = routines[item["routine"]]
                if isinstance(item.get("device"), str) and item["device"] in devices:
                    item["device"] = devices[item["device"]]
                if isinstance(item.get("group"), int) and item["group"] in groups:
                    item["group"] = groups[item["group"]]
        return routine

    @staticmethod
    def _fill_ids(routine: dict):
        for key, prefix in (("triggers", "t"), ("actions", "a")):
            items = [x for x in routine.get(key) or [] if isinstance(x, dict)]
            used = {x.get("id") for x in items}
            n = 1
            for x in items:
                if not x.get("id"):
                    while f"{prefix}{n}" in used:
                        n += 1
                    x["id"] = f"{prefix}{n}"
                    used.add(x["id"])

    @staticmethod
    def _when(iso: str | None, tz: str) -> str | None:
        if not iso:
            return None
        return datetime.fromisoformat(iso).astimezone(ZoneInfo(tz)).strftime("%a %d %b %H:%M")

    def _brief(self, r: dict, tz: str, devices: dict, groups: dict, routines: dict) -> dict:
        definition = {k: r.get(k) for k in ("mode", "grace_minutes", "delete_when_done", "triggers", "conditions", "actions")}
        definition = _strip_nulls(self._to_names(json.loads(json.dumps(definition)), devices, groups, routines))
        if definition.get("mode") == "single":
            definition.pop("mode")
        if definition.get("grace_minutes") == 5:
            definition.pop("grace_minutes")
        return {
            "id": r.get("id"), "name": r.get("name"), "enabled": r.get("enabled", True),
            "next_run": self._when(r.get("next_fire_at"), tz),
            "last_run": f"{r['last_run_status']} at {self._when(r['last_run_at'], tz)}" if r.get("last_run_status") else None,
            "definition": definition,
        }

    # ---------------------------------------------------------------- tools

    async def rt_format(self, user_id: str, **kwargs):
        """Tool: the routine JSON format (call before rt_save)."""
        return {"status": "success", "format": ROUTINE_FORMAT}

    async def rt_list(self, user_id: str, **kwargs):
        """Tool: all routines, with full definitions using device/group names."""
        res = await self._call(user_id, "GET", "/api/routines")
        if res.status_code != 200:
            return {"status": "error", "message": f"Couldn't list routines (HTTP {res.status_code})"}
        data = res.json()
        devices, groups, routines = await self._names(user_id, data["routines"])
        # Reminders that already fired are history, not something to edit: leave them out.
        done = [r for r in data["routines"] if r.get("done")]
        live = [r for r in data["routines"] if r not in done]
        out = {"status": "success", "timezone": data["timezone"],
               "routines": [self._brief(r, data["timezone"], devices, groups, routines) for r in live]}
        if done:
            out["finished_reminders_hidden"] = len(done)
        return out

    async def rt_save(self, user_id: str, routine: str, id: str | None = None, **kwargs):
        """Tool: create a routine (id null) or replace one (id given) from JSON."""
        try:
            body = json.loads(routine)
            assert isinstance(body, dict)
        except Exception:
            return {"status": "error", "message": "routine must be a JSON object (see rt_format)."}
        if isinstance(body.get("definition"), dict):  # a whole rt_list entry was passed back
            body = {**body, **body.pop("definition")}
        body = {k: v for k, v in body.items() if k in _SPEC_FIELDS}
        if id:  # update: start from the saved routine so unchanged fields (and enabled) are kept
            cur = await self._call(user_id, "GET", f"/api/routines/{id}")
            if cur.status_code != 200:
                return {"status": "error", "message": f"No routine with id {id}; use rt_list."}
            saved = cur.json()
            body = {**{k: saved[k] for k in _SPEC_FIELDS if k in saved}, **body}
        devices, groups, routines = await self._names(user_id)
        problems = self._to_ids(body, devices, groups, routines)
        if problems:
            return {"status": "error", "message": "; ".join(problems)}
        self._fill_ids(body)
        if id:
            res = await self._call(user_id, "PUT", f"/api/routines/{id}", json=body)
        else:
            res = await self._call(user_id, "POST", "/api/routines", json=body)
        if res.status_code == 422:
            detail = res.json().get("detail")
            if isinstance(detail, list):
                detail = "; ".join(f"{'.'.join(str(p) for p in e.get('loc', [])[1:])}: {e.get('msg')}" for e in detail)
            return {"status": "error", "message": f"Invalid routine: {detail}. Fix it and call rt_save again."}
        if res.status_code == 404:
            return {"status": "error", "message": f"No routine with id {id}; use rt_list."}
        if res.status_code not in (200, 201):
            return {"status": "error", "message": f"Gateway refused the routine (HTTP {res.status_code}): {res.text[:200]}"}
        saved = res.json()
        listing = (await self._call(user_id, "GET", "/api/routines")).json()
        tz = listing.get("timezone", "UTC")
        routines = {r["id"]: r["name"] for r in listing.get("routines", [])}
        brief = self._brief(saved, tz, devices, groups, routines)
        message = "Saved. Read back what it does in one short sentence."
        if saved.get("done"):
            message = "Saved, but that time has already passed, so it won't run. Fix the date/time with rt_save."
        return {"status": "success", "message": message, **brief}

    async def rt_enable(self, user_id: str, id: str, enabled: bool, **kwargs):
        """Tool: turn a routine on or off."""
        res = await self._call(user_id, "POST", f"/api/routines/{id}/enabled", json={"enabled": enabled})
        if res.status_code != 200:
            return {"status": "error", "message": f"Couldn't change routine {id} (HTTP {res.status_code}); use rt_list for ids."}
        return {"status": "success", "name": res.json()["name"], "enabled": enabled}

    async def rt_run(self, user_id: str, id: str, **kwargs):
        """Tool: run a routine now (conditions are skipped)."""
        res = await self._call(user_id, "POST", f"/api/routines/{id}/run")
        if res.status_code == 202:
            return {"status": "success", "message": "Started."}
        return {"status": "error", "message": res.json().get("detail", f"HTTP {res.status_code}")}

    async def rt_delete(self, user_id: str, id: str, confirmed: bool, **kwargs):
        """Tool: delete a routine, only after the user has confirmed."""
        res = await self._call(user_id, "GET", f"/api/routines/{id}")
        if res.status_code != 200:
            return {"status": "error", "message": f"No routine with id {id}; use rt_list."}
        name = res.json()["name"]
        if not confirmed:
            return {"status": "needs_confirmation",
                    "message": f"Ask the user to confirm deleting '{name}'. Only call rt_delete with confirmed=true after they say yes."}
        res = await self._call(user_id, "DELETE", f"/api/routines/{id}")
        if res.status_code != 204:
            return {"status": "error", "message": f"Couldn't delete '{name}' (HTTP {res.status_code})"}
        return {"status": "success", "message": f"Deleted '{name}'."}
