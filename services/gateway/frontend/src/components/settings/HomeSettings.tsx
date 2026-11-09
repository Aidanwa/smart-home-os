import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { request } from '../../lib/api';
import { ConfirmDialog } from '../ui/dialog';

// Every IANA zone the browser knows, falling back to a short US list on old browsers.
const FALLBACK_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC",
];
function allTimezones(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (zones?.length) return zones.includes('UTC') ? zones : [...zones, 'UTC'];
  } catch { /* not supported */ }
  return FALLBACK_TIMEZONES;
}
const browserTimezone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; }
})();
const tzLabel = (tz: string) => tz.replace(/_/g, ' ').replace(/\//g, ' / ');

interface HomeForm {
  nickname: string;
  address: string;
  timezone: string;
  bottom_floor: number;
  top_floor: number;
}
// What the hub worked out from the address on the last save.
interface Located {
  latitude: number | null;
  longitude: number | null;
  /** NWS answered: weather works, and the timezone came from it. US only. */
  weather: boolean;
}

const EMPTY: HomeForm = { nickname: 'My Smart Home', address: '', timezone: browserTimezone, bottom_floor: 1, top_floor: 1 };
const NOT_LOCATED: Located = { latitude: null, longitude: null, weather: false };

interface HomeResponse extends Partial<HomeForm> {
  id?: string;
  latitude?: number | null;
  longitude?: number | null;
  weather_grid?: { gridId?: string } | null;
}

function fromResponse(data: HomeResponse): { form: HomeForm; located: Located } {
  return {
    form: {
      nickname: data.nickname || '',
      address: data.address || '',
      timezone: data.timezone || 'UTC',
      bottom_floor: data.bottom_floor ?? 1,
      top_floor: data.top_floor ?? 1,
    },
    located: {
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      weather: !!data.weather_grid?.gridId,
    },
  };
}

const inputClass = "w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200";

export const HomeSettingsCard = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [originalData, setOriginalData] = useState<HomeForm>(EMPTY);
  const [located, setLocated] = useState<Located>(NOT_LOCATED);
  const [form, setForm] = useState<HomeForm>(EMPTY);

  const timezones = useMemo(() => {
    const zones = allTimezones();
    return zones.includes(form.timezone) ? zones : [form.timezone, ...zones];
  }, [form.timezone]);

  const hasBasement = form.bottom_floor === 0;
  const totalFloorsAboveGround = form.top_floor;
  const addressChanged = form.address.trim() !== originalData.address.trim();
  // The hub takes the timezone from the weather service when the address is in the US,
  // so while that holds the picker would be ignored; show it read-only instead.
  const timezoneFromAddress = exists && located.weather && !addressChanged;

  useEffect(() => {
    fetch('/api/home')
      .then(res => res.json())
      .then(data => {
        if (data && data.id) {
          const { form, located } = fromResponse(data);
          setExists(true);
          setOriginalData(form);
          setForm(form);
          setLocated(located);
          setIsEditing(false);
        } else {
          setIsEditing(true);
        }
      })
      .catch(() => setIsEditing(true))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let saved: HomeResponse | null = null;
    const ok = await request('save the home profile', async () => {
      const res = await fetch('/api/home', {
        method: exists ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, address: form.address.trim() || null }),
      });
      if (res.ok) saved = await res.json();
      return res;
    });
    setSaving(false);
    if (!ok || !saved) return;

    const next = fromResponse(saved);
    setExists(true);
    setOriginalData(next.form);
    setForm(next.form);
    setLocated(next.located);
    setIsEditing(false);

    if (next.form.address && next.located.latitude == null) {
      toast.warning('Saved, but the address wasn’t found', {
        description: 'Sunrise/sunset routines and weather need it. Try adding the city and state or ZIP code.',
        duration: 10000,
      });
    } else {
      toast.success('Home profile saved');
    }
  };

  const handleCancel = () => {
    setForm(originalData);
    setIsEditing(false);
  };

  // Throwing keeps the confirm dialog open after a failure (the toast says why).
  const handleDelete = async () => {
    const ok = await request('reset the home profile', () => fetch('/api/home', { method: 'DELETE' }));
    if (!ok) throw new Error('not reset');
    setExists(false);
    setForm(EMPTY);
    setOriginalData(EMPTY);
    setLocated(NOT_LOCATED);
    setIsEditing(true);
    toast.success('Home profile reset');
  };

  if (loading) return <div className="text-neutral-500 p-4">Loading…</div>;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-semibold text-neutral-100">Home Profile</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Your address sets local weather and sunrise/sunset times. Floors set up the Rooms tab.
          </p>
        </div>

        {exists && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-sm font-medium text-blue-500 hover:text-blue-400 transition-colors px-3 min-h-10 bg-blue-500/10 rounded-lg shrink-0 ml-4"
          >
            Edit
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
        {/* Nickname Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1" htmlFor="home-nickname">Home Nickname</label>
          {isEditing ? (
            <input id="home-nickname" type="text" value={form.nickname}
              onChange={e => setForm({ ...form, nickname: e.target.value })} className={inputClass} />
          ) : (
            <div className="text-sm font-medium text-neutral-200 py-1.5">{form.nickname || '—'}</div>
          )}
        </div>

        {/* Address Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1" htmlFor="home-address">Street Address & City</label>
          {isEditing ? (
            <input id="home-address" type="text"
              placeholder="e.g., 1600 Pennsylvania Avenue NW, Washington, DC"
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              className={inputClass}
            />
          ) : (
            <div className="text-sm text-neutral-200 py-1.5 break-words">{form.address || '—'}</div>
          )}
          <LocationStatus exists={exists} address={originalData.address} located={located} pending={isEditing && addressChanged} />
        </div>

        {/* Floors */}
        <div className="bg-neutral-950/50 border border-neutral-800/80 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5" htmlFor="home-floors">How many floors is your house? <span className="text-neutral-500">(Excluding basement)</span></label>
            {isEditing ? (
              <select id="home-floors" value={totalFloorsAboveGround}
                onChange={e => setForm({ ...form, top_floor: parseInt(e.target.value) || 1 })}
                className={inputClass}
              >
                {[1, 2, 3, 4, 5].map(num => (
                  <option key={num} value={num}>{num} {num === 1 ? 'Floor' : 'Floors'}</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-neutral-200 py-1">{totalFloorsAboveGround} {totalFloorsAboveGround === 1 ? 'Floor' : 'Floors'}</div>
            )}
          </div>

          <div className="flex items-center">
            {isEditing ? (
              <label className="flex items-center gap-3 cursor-pointer select-none min-h-10">
                <input type="checkbox" checked={hasBasement}
                  onChange={e => setForm({ ...form, bottom_floor: e.target.checked ? 0 : 1 })}
                  className="w-5 h-5 rounded border-neutral-800 bg-neutral-950 accent-blue-500"
                />
                <span className="text-sm text-neutral-300">Is there a basement?</span>
              </label>
            ) : (
              <div className="text-sm text-neutral-400">
                Basement: <span className="text-neutral-200 font-medium ml-1">{hasBasement ? 'Yes' : 'No'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timezone Field */}
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-1" htmlFor="home-tz">Timezone</label>
          {isEditing && !timezoneFromAddress ? (
            <>
              <select id="home-tz" value={form.timezone}
                onChange={e => setForm({ ...form, timezone: e.target.value })} className={inputClass}>
                {timezones.map(tz => <option key={tz} value={tz}>{tzLabel(tz)}</option>)}
              </select>
              <p className="text-xs text-neutral-500 mt-1.5">
                For a US address the hub sets this from the address when you save.
              </p>
            </>
          ) : (
            <>
              <div className="text-sm text-neutral-200 py-1.5">{tzLabel(form.timezone)}</div>
              {timezoneFromAddress && (
                <p className="text-xs text-neutral-500">Set from your address.</p>
              )}
            </>
          )}
        </div>

        {/* Submit / Cancel */}
        {isEditing && (
          <div className="pt-2 flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 min-h-10 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? (addressChanged ? 'Finding address…' : 'Saving…') : exists ? 'Save' : 'Save home profile'}
            </button>
            {exists && (
              <button type="button" onClick={handleCancel} disabled={saving}
                className="text-neutral-400 hover:text-neutral-200 px-4 min-h-10 rounded-lg text-sm font-medium transition-colors">
                Cancel
              </button>
            )}
          </div>
        )}

        {exists && !isEditing && (
          <div className="pt-4 border-t border-neutral-800 mt-6">
            <button type="button" onClick={() => setConfirmReset(true)}
              className="text-red-500 hover:text-red-400 text-sm font-medium transition-colors min-h-10">
              Reset home profile
            </button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset the home profile?"
        description={
          <>
            <p>This clears the address, timezone and floors. Until you set it up again:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>the <strong className="text-neutral-200">Rooms</strong> tab won’t open (your rooms are kept),</li>
              <li><strong className="text-neutral-200">sunrise/sunset</strong> routines stop running,</li>
              <li>time routines run on <strong className="text-neutral-200">UTC</strong> instead of your local time,</li>
              <li>the assistant loses the weather and your local time.</li>
            </ul>
          </>
        }
        confirmLabel="Reset"
        busyLabel="Resetting…"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
};

/** Whether the saved address was found, so sun routines and weather can be trusted. */
function LocationStatus({ exists, address, located, pending }: { exists: boolean; address: string; located: Located; pending: boolean }) {
  if (pending) {
    return <p className="flex items-center gap-1.5 text-xs text-neutral-500 mt-1.5"><MapPin size={12} /> The hub looks the address up when you save.</p>;
  }
  if (!exists) return null;
  if (!address) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-yellow-500 mt-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> No address, so sunrise/sunset routines and weather are off.
      </p>
    );
  }
  if (located.latitude == null) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-yellow-500 mt-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Address not found, so sunrise/sunset routines and weather are off. Edit it and add the city and state or ZIP code.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-green-500 mt-1.5">
      <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
      <span>
        Found ({Number(located.latitude).toFixed(3)}, {Number(located.longitude).toFixed(3)}).
        {' '}{located.weather ? 'Sunrise/sunset and weather work.' : 'Sunrise/sunset works; weather is US-only and isn’t available here.'}
      </span>
    </p>
  );
}
