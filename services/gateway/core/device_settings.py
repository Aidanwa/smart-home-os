"""Every device's own settings and read-only details, from Z2M's exposes (bridge/devices).

The device drawer's "All settings" section is built from this, so a new device's settings show up
without code. Z2M marks each property with access bits: 1 = it appears in the state, 2 = it can
be set, 4 = it can be read on demand (/get). A setting is a property that is both in the state and
settable, either at the top level (Z2M tags only some of these with category "config") or tagged
"config" inside a typed group. A light's or plug's own controls (state, brightness, colour) sit
inside that group untagged and stay out. Write-only properties (access 2 alone) are commands, like
"start spatial learning", not settings, so they're left out too, as are one-value enums ("Reset"). A detail is a read-only property
Z2M tags config or diagnostic (device temperature, power-on count); plain readings (temperature,
presence) stay on the card.
"""
import math
from typing import Any

_KEYS = ("property", "type", "label", "description", "unit", "values", "value_on", "value_off",
         "value_min", "value_max", "value_step", "access", "category")
# Shown elsewhere in the drawer or card, events, or commands that only look like settings
# (a Hue "effect" makes the bulb blink).
_SKIP = {"linkquality", "battery", "last_seen", "update", "state", "brightness", "color_temp", "color",
         "action", "effect", "effect_speed"}

SETTING_TIMEOUT_S = 12.0  # Z2M itself gives up on a sleeping device after 10 s


def _items(exposes, parent: str | None = None):
    for e in exposes or []:
        if not isinstance(e, dict) or e.get("type") in ("composite", "list"):
            continue
        if e.get("features"):
            yield from _items(e["features"], parent=e.get("type") or "group")
            continue
        prop = e.get("property")
        if not prop or prop in _SKIP:
            continue
        if e.get("type") == "enum" and len(e.get("values") or []) < 2:
            continue  # a one-value enum is a button ("Reset" total energy), not a setting
        access = e.get("access", 1)
        readable, settable = bool(access & 1), bool(access & 2)
        category = e.get("category")
        if readable and settable and (parent is None or category == "config"):
            kind = "setting"
        elif readable and not settable and category in ("config", "diagnostic"):
            kind = "detail"
        else:
            continue
        yield {**{k: e[k] for k in _KEYS if k in e}, "kind": kind}


def summarize_settings(devices: list) -> dict:
    """{ieee: [{property, type, label, ..., kind: "setting" | "detail"}]} for every device."""
    out = {}
    for d in devices:
        if isinstance(d, dict) and d.get("ieee_address") and d.get("type") != "Coordinator":
            items = list(_items((d.get("definition") or {}).get("exposes")))
            if items:
                out[d["ieee_address"]] = items
    return out


def check_value(item: dict, value: Any) -> Any:
    """The value to send for this setting, or ValueError with a plain reason."""
    kind = item.get("type")
    if kind == "binary":
        allowed = [item.get("value_on", True), item.get("value_off", False)]
        if value not in allowed:
            raise ValueError(f"must be one of {allowed}")
        return value
    if kind == "enum":
        if value not in (item.get("values") or []):
            raise ValueError(f"must be one of {item.get('values')}")
        return value
    if kind == "numeric":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("must be a number")
        lo, hi = item.get("value_min"), item.get("value_max")
        if lo is not None and value < lo or hi is not None and value > hi:
            raise ValueError(f"must be between {lo} and {hi}")
        return value
    if kind == "text":
        if not isinstance(value, str) or len(value) > 200:
            raise ValueError("must be text (at most 200 characters)")
        return value
    raise ValueError(f"settings of type '{kind}' can't be changed here")


def same_value(item: dict, a: Any, b: Any) -> bool:
    """Whether a reported value matches the one sent (numbers within half a step: devices round)."""
    if item.get("type") == "numeric" and isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= (item.get("value_step") or 0) / 2 + 1e-6
    return a == b
