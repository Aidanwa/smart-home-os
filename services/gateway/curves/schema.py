"""Day curve JSON (the light_curves.points column and the /api/curves bodies).

A curve is a list of points. Each point sits at a clock time or a sun event (sunrise, solar noon,
sunset, plus an offset) and sets warmth and/or brightness, as percentages. Warmth is a percentage
of each bulb's own range (0 = its coolest, 100 = its warmest, as the rest of the app shows it);
the controller converts per bulb, since one curve can drive bulbs with different ranges. Between
points the values change linearly, and the curve wraps around midnight. The frontend mirrors this
in components/routines/curves/types.ts.
"""
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
ShortId = Annotated[str, Field(pattern=r"^[a-z0-9_-]{1,16}$")]
MAX_POINTS = 24


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClockTime(_Strict):
    type: Literal["time"]
    at: HHMM


class SunTime(_Strict):
    type: Literal["sun"]
    event: Literal["sunrise", "noon", "sunset"]
    offset_min: int = Field(0, ge=-360, le=360)


When = Annotated[Union[ClockTime, SunTime], Field(discriminator="type")]


class CurvePoint(_Strict):
    id: ShortId
    when: When
    warmth: int | None = Field(None, ge=0, le=100)
    brightness: int | None = Field(None, ge=1, le=100)

    @model_validator(mode="after")
    def _sets_something(self):
        if self.warmth is None and self.brightness is None:
            raise ValueError("a point sets warmth, brightness or both")
        return self


class CurveSpec(_Strict):
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    points: list[CurvePoint] = Field(min_length=1, max_length=MAX_POINTS)
    members: list[str] = Field(default_factory=list, max_length=100)  # IEEE addresses

    @model_validator(mode="after")
    def _unique(self):
        ids = [p.id for p in self.points]
        if len(ids) != len(set(ids)):
            raise ValueError("point ids must be unique")
        self.members = list(dict.fromkeys(self.members))
        return self


class PreviewRequest(_Strict):
    points: list[CurvePoint] = Field(min_length=1, max_length=MAX_POINTS)


class MemberRequest(_Strict):
    curve_id: str | None  # None = stop following any curve


def uses_sun(points: list[CurvePoint]) -> bool:
    return any(p.when.type == "sun" for p in points)
