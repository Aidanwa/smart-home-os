// Non-component helpers for the trigger/condition editors (kept apart for React fast refresh).
import type { AttributeInfo, AttributeMap, ConditionOp, LeafCondition, Scalar, Trigger, TriggerOp } from './types';
import { EVENT_ATTRIBUTES, NUMERIC_OPS, OP_TEXT } from './types';

const NICE_NAMES: Record<string, string> = { action: 'button press', state: 'on/off state', color_temp: 'colour temperature' };
export const attributeLabel = (p: string) => NICE_NAMES[p] ?? p.replace(/_/g, ' ');

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

export function newTrigger(type: Trigger['type'], id: string, attributes: AttributeMap): Trigger {
  if (type === 'time') return { id, type, at: '07:00', days: null };
  if (type === 'sun') return { id, type, event: 'sunset', offset_min: 0, days: null };
  const [device, info] = Object.entries(attributes).sort((a, b) => a[1].friendly_name.localeCompare(b[1].friendly_name))[0] ?? ['', undefined];
  const attribute = info?.properties[0]?.property ?? '';
  const { op, value } = defaultComparison(info?.properties[0], attribute, info?.current?.[attribute]);
  return { id, type: 'device', device, attribute, op, value, rearm: null, for_s: null, cooldown_s: 0 };
}

export function newCondition(type: LeafCondition['type'], attributes: AttributeMap): LeafCondition {
  if (type === 'time_window') return { type, after: '22:00', before: '06:00' };
  if (type === 'days') return { type, days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
  if (type === 'sun') return { type, state: 'down' };
  const [device, info] = Object.entries(attributes).sort((a, b) => a[1].friendly_name.localeCompare(b[1].friendly_name))[0] ?? ['', undefined];
  const attribute = info?.properties.find(p => p.property !== 'action')?.property ?? '';
  const d = defaultComparison(findInfo(attributes, device, attribute), attribute, info?.current?.[attribute]);
  return { type: 'device', device, attribute, op: (d.op === 'changes' ? 'eq' : d.op) as ConditionOp, value: d.value };
}
