import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import type { RealtimeStatus } from '../../hooks/useDevices';

const GRACE_MS = 3000;  // don't flash for a reconnect that's over in a moment

/** Tells the user the live device feed is down, so states on screen may be out of date. */
export function ConnectionBanner({ status }: { status: RealtimeStatus }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === 'open') return;
    const t = setTimeout(() => setShow(true), GRACE_MS);
    return () => {  // status changed (usually back to open): hide and restart the grace period
      clearTimeout(t);
      setShow(false);
    };
  }, [status]);

  if (!show) return null;
  return (
    <div role="status" className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-amber-950/60 border-b border-amber-900/60 text-amber-300">
      <WifiOff size={14} className="shrink-0" />
      <span>Lost the live connection to the hub. Reconnecting… device states may be out of date.</span>
    </div>
  );
}
