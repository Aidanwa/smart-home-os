// Non-component helpers for the trigger/condition editors (kept apart for React fast refresh).
import type { Action, AttributeInfo, AttributeMap, ConditionOp, LeafCondition, RoomOption, Scalar, Trigger, TriggerOp } from './types';
import { EVENT_ATTRIBUTES, NUMERIC_OPS, OP_TEXT } from './types';

export { attributeLabel } from './types';

/** A live reading (presence, temperature, a button), not a device setting or housekeeping value. */
export const isReading = (p: AttributeInfo) => !p.category;

/** The property a new trigger/condition starts on: the first real reading. */
const firstReading = (props: AttributeInfo[] | undefined, skipButtons = false) =>
  props?.find(p => isReading(p) && !(skipButtons && EVENT_ATTRIBUTES.includes(p.property))) ?? props?.[0];

/** A room with a presence or motion sensor first, else any room. */
const firstRoom = (rooms: RoomOption[]) => rooms.find(r => r.hasSensor) ?? rooms[0];

export function findInfo(attributes: AttributeMap, device: string, attribute: string): AttributeInfo | undefined {
  return attributes[device]?.properties.find(p => p.property === attribute);
}

/** Which comparisons make sense for an attribute. Buttons: a specific press, or any press. */
export function opsFor(info: AttributeInfo | undefined, attribute: string, forTrigger: boolean): TriggerOp[] {
  let ops: TriggerOp[];
  if (EVENT_ATTRIBUTES.includes(attribute)) ops = ['eq', 'changes'];
  else if (info?.type === 'numeric') ops = ['gt', 'gte', 'lt', 'lte', 'eq', 'changes'];
  else ops = ['eq', 'ne', 'changes'];
  return forTrigger ? ops : ops.filter(o => o !== 'changes');
}

export function opText(op: TriggerOp, attribute: string): string {
  if (EVENT_ATTRIBUTES.includes(attribute)) return op === 'changes' ? 'any press' : 'is pressed as';
  return OP_TEXT[op];
}

/** Sensible starting comparison when the user picks an attribute. */
export function defaultComparison(info: AttributeInfo | undefined, attribute: string, current: unknown): { op: TriggerOp; value: Scalar } {
  if (EVENT_ATTRIBUTES.includes(attribute)) return { op: 'eq', value: info?.values?.[0] ?? String(current ?? '') };
  if (info?.type === 'numeric' || typeof current === 'number') {
    return { op: 'gt', value: typeof current === 'number' ? Math.round(current * 10) / 10 : 0 };
  }
  if (info?.type === 'binary') return { op: 'eq', value: info.value_on ?? true };
  if (info?.type === 'enum' && info.values?.length) return { op: 'eq', value: info.values[0] };
  return { op: 'eq', value: typeof current === 'string' || typeof current === 'boolean' ? current : '' };
}

export const isNumericOp = (op: TriggerOp) => NUMERIC_OPS.includes(op);

export function newTrigger(type: Trigger['type'], id: string, attributes: AttributeMap, rooms: RoomOption[] = []): Trigger {
  if (type === 'time') return { id, type, at: '07:00', days: null };
  if (type === 'sun') return { id, type, event: 'sunset', offset_min: 0, days: null };
  if (type === 'room') return { id, type, room: firstRoom(rooms)?.id ?? '', state: 'occupied', for_s: null, cooldown_s: 0, fire_on_start: false };
  if (type === 'presence') return { id, type, who: 'anyone', state: 'home', for_s: null, cooldown_s: 0, fire_on_start: false };
  const [device, info] = Object.entries(attributes).sort((a, b) => a[1].friendly_name.localeCompare(b[1].friendly_name))[0] ?? ['', undefined];
  const prop = firstReading(info?.properties);
  const attribute = prop?.property ?? '';
  const { op, value } = defaultComparison(prop, attribute, info?.current?.[attribute]);
  return { id, type: 'device', device, attribute, op, value, rearm: null, for_s: null, cooldown_s: 0, fire_on_start: false };
}

export function newCondition(type: LeafCondition['type'], attributes: AttributeMap, rooms: RoomOption[] = []): LeafCondition {
  if (type === 'time_window') return { type, after: '22:00', before: '06:00' };
  if (type === 'days') return { type, days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
  if (type === 'sun') return { type, state: 'down' };
  if (type === 'room') return { type, room: firstRoom(rooms)?.id ?? '', state: 'occupied', for_s: null };
  if (type === 'presence') return { type, who: 'anyone', state: 'away', for_s: null };
  const [device, info] = Object.entries(attributes).sort((a, b) => a[1].friendly_name.localeCompare(b[1].friendly_name))[0] ?? ['', undefined];
  const attribute = firstReading(info?.properties, true)?.property ?? '';
  const d = defaultComparison(findInfo(attributes, device, attribute), attribute, info?.current?.[attribute]);
  return { type: 'device', device, attribute, op: (d.op === 'changes' ? 'eq' : d.op) as ConditionOp, value: d.value };
}

export const DEFAULT_SPEAKER = 'Bedroom Speakers';

export function newAction(type: Action['type'], id: string, firstDevice: string, firstLight: string | null, firstGroup: number | null): Action {
  switch (type) {
    case 'device': return { id, type, device: firstDevice, set: { state: 'ON' }, stop_on_error: false };
    case 'group': return { id, type, group: firstGroup ?? 0, set: { state: 'ON' }, stop_on_error: false };
    case 'delay': return { id, type, seconds: 60, stop_on_error: false };
    case 'fade': return {
      id, type, device: firstLight ?? (firstGroup === null ? firstDevice : null), group: firstLight === null && firstGroup !== null ? firstGroup : null,
      to_brightness: 254, from_brightness: null, to_color_temp: null, from_color_temp: null,
      duration_s: 600, method: 'native', wait: false, stop_on_error: false,
    };
    case 'spotify_play': return {
      id, type, speaker: DEFAULT_SPEAKER, uri: '', title: null, volume: null, ramp_to: null, ramp_s: null, shuffle: null, stop_on_error: false,
    };
    case 'spotify_ctrl': return { id, type, cmd: 'pause', speaker: null, volume: null, stop_on_error: false };
    case 'agent': return { id, type, prompt: '', notify: null, stop_on_error: false };
    case 'notify': return { id, type, title: null, message: '', to: 'owner', stop_on_error: false };
    case 'routine': return { id, type, routine: '', wait: false, check_conditions: false, stop_on_error: false };
  }
}
