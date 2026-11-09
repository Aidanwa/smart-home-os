import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Radio, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DeviceState } from '../../hooks/useDevices';

const PAIR_SECONDS = 254;  // Z2M's maximum

interface Props {
  devices: Record<string, DeviceState>;
  permitJoin: (value: boolean, time?: number) => Promise<boolean>;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * "Add device": opens Zigbee pairing for 254 s with a countdown, and announces each device that
 * joins meanwhile. Pairing is the bridge's state, not this page's, so on load it picks up a
 * pairing window that is already open (from another tab or phone).
 */
export function PairingButton({ devices, permitJoin }: Props) {
  const [endsAt, setEndsAt] = useState<number | null>(null);  // ms epoch while pairing
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState<Set<string> | null>(null);  // devices present when pairing started
  const announced = useRef(new Set<string>());

  const remaining = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : 0;
  const pairing = remaining > 0;
  const joined = useMemo(
    () => (pairing && baseline ? Object.keys(devices).filter(k => !baseline.has(k)) : []),
    [pairing, baseline, devices],
  );

  const devicesRef = useRef(devices);
  useEffect(() => { devicesRef.current = devices; }, [devices]);

  // Pick up a pairing window that's already open.
  useEffect(() => {
    fetch('/api/bridge/info')
      .then(r => (r.ok ? r.json() : null))
      .then(info => {
        if (info?.permit_join && typeof info.permit_join_end === 'number' && info.permit_join_end > Date.now()) {
          setBaseline(new Set(Object.keys(devicesRef.current)));
          setNow(Date.now());
          setEndsAt(info.permit_join_end);
        }
      })
      .catch(() => {});
  }, []);

  // Tick once a second while pairing; the interval stops when the window closes.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  // Announce each device that joins while pairing.
  useEffect(() => {
    for (const key of joined) {
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      const state = devices[key];
      toast.success('New device joined', { description: `${state?.friendly_name ?? key} is now on your network. Open its ⋯ settings to rename it.` });
    }
  }, [joined, devices]);

  const start = async () => {
    setBusy(true);
    if (await permitJoin(true, PAIR_SECONDS)) {
      setBaseline(new Set(Object.keys(devices)));
      announced.current = new Set();
      setNow(Date.now());
      setEndsAt(Date.now() + PAIR_SECONDS * 1000);
    }
    setBusy(false);
  };

  const stop = async () => {
    setBusy(true);
    if (await permitJoin(false, 0)) {
      setEndsAt(null);
    }
    setBusy(false);
  };

  if (!pairing) {
    return (
      <button onClick={start} disabled={busy}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800 text-sm font-medium text-neutral-200 disabled:opacity-50 transition-colors">
        <Plus size={16} /> Add device
      </button>
    );
  }

  return (
    <div role="status" className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-xl border border-blue-500/60 bg-blue-900/30 text-blue-300">
      <Radio size={16} className="animate-pulse shrink-0" />
      <span className="text-sm font-medium tabular-nums">
        Pairing {mmss(remaining)}
        {joined.length > 0 && <span className="text-blue-200"> · {joined.length} joined</span>}
      </span>
      <button onClick={stop} disabled={busy} aria-label="Stop pairing"
        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-800/50 text-xs font-medium disabled:opacity-50">
        <X size={14} /> Stop
      </button>
    </div>
  );
}
