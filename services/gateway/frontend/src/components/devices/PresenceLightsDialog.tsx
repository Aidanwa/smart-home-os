import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { dialogButton } from '../ui/dialog-styles';
import { NumberField } from '../routines/NumberField';
import type { DeviceState } from '../../hooks/useDevices';
import { useRoomIndex } from '../../hooks/useRoomIndex';
import { getDeviceKind } from '../../lib/deviceUtils';
import { request } from '../../lib/api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sensorName: string;
  state: DeviceState;
}

interface Target { ieee: string; name: string; kind: 'light' | 'plug'; inRoom: boolean }

const box = 'bg-neutral-950 border border-neutral-800 rounded-lg px-3 min-h-10 text-sm text-neutral-200 w-20';

/** "Lights follow presence": makes two ordinary routines (on when occupied and dark, off once empty
 *  for N min), which can be edited afterwards in Routines. Uses a room trigger when the sensor is
 *  placed in a room on the floor plan, else the sensor's own presence reading. */
export function PresenceLightsDialog({ open, onOpenChange, sensorName, state }: Props) {
  const ieee = state.ieee_address as string | undefined;
  const roomIndex = useRoomIndex(open);
  const [devices, setDevices] = useState<Record<string, DeviceState> | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);  // null until defaults are chosen
  const hasLux = typeof state.illuminance === 'number';
  const [onlyDark, setOnlyDark] = useState(hasLux);
  const [lux, setLux] = useState(50);
  const [offMin, setOffMin] = useState(10);
  const [saving, setSaving] = useState(false);

  // Fresh device list each time it opens (cards only know their own device).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/devices').then(r => (r.ok ? r.json() : null)).then(d => { if (!cancelled && d) setDevices(d.devices ?? {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  const roomId = ieee && roomIndex ? roomIndex.roomOf[ieee] : undefined;
  const room = roomIndex?.rooms.find(r => r.id === roomId);
  const place = room?.name ?? sensorName;

  const targets = useMemo((): Target[] => {
    if (!devices) return [];
    return Object.entries(devices)
      .map(([id, st]) => ({ ieee: id, name: (st.friendly_name as string) ?? id, kind: getDeviceKind(st), inRoom: !!roomId && roomIndex?.roomOf[id] === roomId }))
      .filter((t): t is Target => t.kind === 'light' || t.kind === 'plug')
      .sort((a, b) => Number(b.inRoom) - Number(a.inRoom) || a.name.localeCompare(b.name));
  }, [devices, roomId, roomIndex]);

  // Default: the lights in the sensor's room (plugs often run other things: heaters, radios).
  const selected = picked ?? new Set(targets.filter(t => t.inRoom && t.kind === 'light').map(t => t.ieee));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const create = async () => {
    if (!ieee || selected.size === 0) return;
    setSaving(true);
    const attribute = state.presence !== undefined ? 'presence' : 'occupancy';
    const trigger = (occupied: boolean, for_s: number | null) => roomId
      ? { id: 't1', type: 'room', room: roomId, state: occupied ? 'occupied' : 'empty', for_s, cooldown_s: 0, fire_on_start: false }
      : { id: 't1', type: 'device', device: ieee, attribute, op: 'eq', value: occupied, rearm: null, for_s, cooldown_s: 0, fire_on_start: false };
    const actions = (on: boolean) => [...selected].map((d, i) => ({ id: `a${i + 1}`, type: 'device', device: d, set: { state: on ? 'ON' : 'OFF' }, stop_on_error: false }));
    const base = { description: null, enabled: true, mode: 'single', grace_minutes: 5, delete_when_done: false };
    const routines = [
      { ...base, name: `${place}: lights on when occupied`, triggers: [trigger(true, null)], actions: actions(true),
        conditions: onlyDark && hasLux ? [{ type: 'device', device: ieee, attribute: 'illuminance', op: 'lt', value: lux }] : [] },
      { ...base, name: `${place}: lights off when empty`, triggers: [trigger(false, Math.round(offMin * 60))], actions: actions(false), conditions: [] },
    ];
    let made = 0;
    for (const r of routines) {
      const ok = await request(`create “${r.name}”`, () => fetch('/api/routines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r),
      }));
      if (!ok) break;
      made++;
    }
    setSaving(false);
    if (made === routines.length) {
      toast.success(`Lights now follow presence in ${place}`, {
        description: 'Two routines were added. Change them any time in Routines.',
        action: { label: 'Open', onClick: () => { window.location.hash = 'routines'; } },
      });
      onOpenChange(false);
    } else if (made > 0) {
      toast.warning('Only the “lights on” routine was created', { description: 'Fix the problem above, then add the other one in Routines.' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogTitle>Lights follow presence</DialogTitle>
        <DialogDescription>
          Turns lights on when someone comes {room ? `into ${room.name}` : `near ${sensorName}`} and off once it’s been empty for a while.
          This adds two routines you can change later.
        </DialogDescription>

        <div className="mt-5 space-y-5 text-sm">
          <section className="space-y-2">
            <h3 className="font-medium text-neutral-200">Lights to switch</h3>
            {devices === null ? <p className="text-neutral-500">Loading…</p>
              : targets.length === 0 ? <p className="text-neutral-500">No lights or plugs found.</p>
              : (
                <ul className="max-h-56 overflow-y-auto rounded-xl border border-neutral-800 divide-y divide-neutral-800/70">
                  {targets.map(t => (
                    <li key={t.ieee}>
                      <label className="flex items-center gap-3 px-3 min-h-11 cursor-pointer hover:bg-neutral-800/40">
                        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={selected.has(t.ieee)} onChange={() => toggle(t.ieee)} />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        <span className="text-xs text-neutral-500 shrink-0">{t.kind === 'plug' ? 'Plug' : 'Light'}{t.inRoom ? ` · ${place}` : ''}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            {!room && roomIndex && (
              <p className="text-xs text-neutral-500">Tip: place this sensor in a room on the Rooms plan and the routines will follow the room instead.</p>
            )}
          </section>

          {hasLux && (
            <section className="space-y-2">
              <label className="flex items-center gap-3 min-h-10 cursor-pointer">
                <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={onlyDark} onChange={e => setOnlyDark(e.target.checked)} />
                <span>Only when it’s dark</span>
              </label>
              {onlyDark && (
                <div className="flex flex-wrap items-center gap-2 pl-8 text-neutral-400">
                  darker than
                  <NumberField integer min={1} max={2000} className={box} value={lux} onChange={setLux} ariaLabel="Light level threshold" />
                  lx
                  <span className="text-xs text-neutral-500 basis-full">Right now it reads {Math.round(state.illuminance)} lx.</span>
                </div>
              )}
            </section>
          )}

          <section className="flex flex-wrap items-center gap-2 text-neutral-300">
            Turn them off after it’s been empty for
            <NumberField integer min={1} max={240} className={box} value={offMin} onChange={setOffMin} ariaLabel="Minutes empty before turning off" />
            min
          </section>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" className={dialogButton.cancel} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
          <button type="button" className={dialogButton.primary} onClick={create} disabled={saving || selected.size === 0 || !ieee}>
            {saving ? 'Adding…' : 'Add routines'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
