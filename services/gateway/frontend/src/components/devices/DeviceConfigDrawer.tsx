import { useState, useEffect } from 'react';
import { Pencil, Check, X, Signal, Battery, Clock, Download, Trash2, AlertTriangle } from 'lucide-react';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle,
  SheetDescription 
} from '../ui/sheet';
import type { DeviceState } from '../../hooks/useDevices';
import { request } from '../../lib/api';
import { toast } from 'sonner';
import { ConfirmDialog } from '../ui/dialog';
import { AllSettings } from './AllSettings';

// This is to add tooltips to buttons
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

/** GET /api/devices/{id}/info: identity, firmware and pairing health from Z2M's bridge/devices. */
interface DeviceInfo {
  vendor?: string | null;
  model?: string | null;
  description?: string | null;
  supports_ota?: boolean | null;
  manufacturer?: string | null;
  model_id?: string | null;
  type?: string | null;            // Router | EndDevice
  power_source?: string | null;    // e.g. "Mains (single phase)", "Battery"
  software_build_id?: string | null;
  date_code?: string | null;       // usually starts YYYYMMDD
  interview_state?: string | null; // PENDING | IN_PROGRESS | SUCCESSFUL | FAILED
  supported?: boolean | null;
  disabled?: boolean | null;
}

/** OTA image versions are 32-bit numbers that read best in hex (0x01001D00). */
const otaHex = (v: unknown) =>
  typeof v === 'number' ? `0x${v.toString(16).toUpperCase().padStart(8, '0')}` : null;

/** "20260817" or "20251126 1702-3R" → a local date string; anything else as is. */
function formatDateCode(code: string) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(code);
  if (!m) return code;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? code : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function healthWarnings(info: DeviceInfo | null): { title: string; detail: string }[] {
  if (!info) return [];
  const out: { title: string; detail: string }[] = [];
  if (info.disabled) {
    out.push({ title: 'Disabled in Zigbee2MQTT', detail: 'The hub ignores this device until it is enabled again.' });
  }
  if (info.interview_state === 'FAILED') {
    out.push({ title: 'Pairing didn’t finish', detail: 'Some controls or readings may be missing. Remove the device and pair it again.' });
  } else if (info.interview_state === 'PENDING' || info.interview_state === 'IN_PROGRESS') {
    out.push({ title: 'Still pairing', detail: 'The hub is still reading this device’s capabilities. Keep it powered and nearby.' });
  }
  if (info.supported === false) {
    out.push({ title: 'Not supported by Zigbee2MQTT', detail: 'Basic on/off may work, but most features won’t show up.' });
  }
  return out;
}

const AboutRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 px-3 py-2.5">
    <span className="text-xs text-neutral-500 shrink-0 pt-0.5">{label}</span>
    <div className="text-sm text-right min-w-0 break-words">{children}</div>
  </div>
);

interface DeviceConfigDrawerProps {
  name: string;
  state: DeviceState;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  advancedConfig?: React.ReactNode;
  /** Settings the card's own controls already show (AllSettings leaves them out). */
  handledSettings?: string[];
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (deviceId: string, label?: string) => void;
}

export function DeviceConfigDrawer({ 
  name, 
  state, 
  isOpen, 
  onOpenChange, 
  advancedConfig,
  handledSettings,
  renameDevice,
  deleteDevice,
}: DeviceConfigDrawerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Firmware install: a second tap confirms; `starting` covers the request itself.
  const [confirmFirmware, setConfirmFirmware] = useState(false);
  const [startingFirmware, setStartingFirmware] = useState(false);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const deviceId = state.ieee_address || name;

  // Details are fetched each time the drawer opens (they change only on re-pair or a firmware update).
  // A failed load just leaves the About section out.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/info`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: DeviceInfo | null) => { if (!cancelled) setInfo(data); })
      .catch(err => console.error(err));
    return () => { cancelled = true; };
  }, [isOpen, deviceId]);

  const warnings = healthWarnings(info);
  const installedOta = otaHex(state.update?.installed_version);
  const latestOta = otaHex(state.update?.latest_version);
  const powerLabel = info?.power_source?.startsWith('Mains') ? 'Mains' : info?.power_source;
  const roleLabel = info?.type === 'Router' ? 'Router (relays for other devices)'
    : info?.type === 'EndDevice' ? 'End device' : info?.type;
  const firmwareStatus = info?.supports_ota === false ? 'No over-the-air updates'
    : state.update?.state === 'idle' ? 'Up to date'
    : state.update?.state === 'available' ? 'Update available' : null;
  const hasAbout = !!info && !!(info.vendor || info.model || info.software_build_id || info.type || info.model_id);

  const installFirmware = async () => {
    setStartingFirmware(true);
    const ok = await request(`start the firmware update for ${name}`, () =>
      fetch(`/api/devices/${encodeURIComponent(state.ieee_address || name)}/firmware/update`, { method: 'POST' }));
    setStartingFirmware(false);
    setConfirmFirmware(false);
    if (ok) toast.success(`Updating ${name}`, { description: 'This usually takes 10–30 minutes. Progress shows here.' });
  };

  // Reset draft if the device name actually changes via WebSocket
  useEffect(() => {
    setEditDraft(name);
  }, [name]);

  // Reset modal state if drawer closes
  useEffect(() => {
    if (!isOpen) {
      setShowDeleteConfirm(false);
      setIsEditing(false);
      setConfirmFirmware(false);
    }
  }, [isOpen]);

  const handleRenameSubmit = () => {
    if (editDraft.trim() && editDraft !== name) {
      renameDevice(name, editDraft.trim());
    }
    setIsEditing(false);
  };

  const confirmDelete = () => {
    // Use ieee_address if available, fallback to name
    deleteDevice(state.ieee_address || name, name);
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto overflow-x-hidden w-full sm:max-w-md flex flex-col gap-8 p-6 sm:p-4">        
        <SheetHeader className="text-left space-y-0">
          <SheetDescription className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
            Device Configuration
          </SheetDescription>
          
          {/* Rename Module */}
          {isEditing ? (
            <div className="flex items-center gap-2 pt-1">
              <input
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xl font-medium tracking-tight focus:outline-none focus:border-blue-500 text-white min-w-0 flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
              <Tooltip text="Save">
                <button onClick={handleRenameSubmit} aria-label="Save name" className="shrink-0 p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                  <Check size={18} />
                </button>
              </Tooltip>
              <Tooltip text="Cancel">
                <button onClick={() => setIsEditing(false)} aria-label="Cancel rename" className="shrink-0 p-2 rounded-lg bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors">
                  <X size={18} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2 group">
              {/* min-w-0 + overflow-wrap: a long name with no spaces (an IEEE address) wraps
                  instead of pushing the rename button off a phone screen. */}
              <div className="flex flex-col min-w-0 flex-1">
                <SheetTitle className="text-2xl font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
                  {name}
                </SheetTitle>
                {state.ieee_address && (
                  <span className="text-xs font-mono text-neutral-500 mt-0.5 select-all break-all">
                    {state.ieee_address}
                  </span>
                )}
              </div>
              <Tooltip text="Rename Device">
                <button
                  onClick={() => setIsEditing(true)}
                  aria-label="Rename device"
                  className="shrink-0 p-2 rounded-full text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors mt-1"
                >
                  <Pencil size={16} />
                </button>
              </Tooltip>
            </div>
          )}
        </SheetHeader>

        {/* Universal Telemetry Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-neutral-400">Status & Health</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {warnings.map(w => (
              <div key={w.title} role="alert" className="flex items-start gap-2 bg-red-500/10 p-3 rounded-xl border border-red-500/20 col-span-2">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium text-red-300">{w.title}</div>
                  <div className="text-xs text-red-200/70 mt-0.5">{w.detail}</div>
                </div>
              </div>
            ))}
            {state.linkquality !== undefined && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Signal size={14} className="text-blue-400" />
                  <span className="text-xs">Signal (LQI)</span>
                </div>
                <span className="font-medium">{state.linkquality} / 255</span>
              </div>
            )}
            {state.battery !== undefined && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Battery size={14} className={state.battery > 20 ? 'text-green-400' : 'text-red-400'} />
                  <span className="text-xs">Battery</span>
                </div>
                <span className="font-medium">{state.battery}%</span>
              </div>
            )}
            {state.last_seen && (
              <div className="flex flex-col gap-1 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800/50 col-span-2">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Clock size={14} />
                  <span className="text-xs">Last Seen</span>
                </div>
                <span className="font-medium truncate">{new Date(state.last_seen).toLocaleString()}</span>
              </div>
            )}
            {/* Z2M's OTA status: update.state is idle | available | scheduled | updating */}
            {(state.update?.state === 'available' || state.update?.state === 'updating' || state.update?.state === 'scheduled') && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20 col-span-2">
                <div className="flex items-center gap-2 text-yellow-500 min-w-0">
                  <Download size={16} className="shrink-0" />
                  <span className="font-medium text-sm">
                    {state.update.state === 'updating'
                      ? `Updating firmware${typeof state.update.progress === 'number' ? ` (${Math.round(state.update.progress)}%)` : '…'}`
                      : state.update.state === 'scheduled' ? 'Firmware update scheduled' : 'Firmware update available'}
                  </span>
                </div>
                {state.update.state === 'available' && (
                  <button
                    onClick={() => (confirmFirmware ? installFirmware() : setConfirmFirmware(true))}
                    disabled={startingFirmware}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-yellow-500 text-neutral-950 hover:bg-yellow-400 disabled:opacity-60 transition-colors"
                  >
                    {startingFirmware ? 'Starting…' : confirmFirmware ? 'Install now' : 'Install'}
                  </button>
                )}
                {installedOta && latestOta && installedOta !== latestOta && (
                  <p className="basis-full text-xs text-yellow-200/70 font-mono break-all">
                    {installedOta} → {latestOta}
                  </p>
                )}
                {state.update.state === 'available' && confirmFirmware && !startingFirmware && (
                  <p className="basis-full text-xs text-yellow-200/80">
                    Takes 10–30 minutes. The device may stop responding and restart while it updates.
                    Tap <strong>Install now</strong> to start, or{' '}
                    <button onClick={() => setConfirmFirmware(false)} className="underline">cancel</button>.
                  </p>
                )}
                {state.update.state === 'updating' && typeof state.update.progress === 'number' && (
                  <div className="basis-full h-1.5 rounded-full bg-yellow-500/20 overflow-hidden" role="progressbar"
                    aria-valuenow={Math.round(state.update.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Firmware update progress">
                    <div className="h-full bg-yellow-500 transition-[width]" style={{ width: `${state.update.progress}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* About: identity and firmware from Z2M's device list */}
        {hasAbout && info && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-neutral-400">About</h4>
            <div className="bg-neutral-900/50 rounded-xl border border-neutral-800/50 divide-y divide-neutral-800/50">
              {(info.vendor || info.model) && (
                <AboutRow label="Model">
                  <div className="font-medium">{[info.vendor, info.model].filter(Boolean).join(' ')}</div>
                  {info.description && <div className="text-xs text-neutral-500 mt-0.5">{info.description}</div>}
                </AboutRow>
              )}
              {(roleLabel || powerLabel) && (
                <AboutRow label="Network">
                  {[roleLabel, powerLabel].filter(Boolean).join(' · ')}
                </AboutRow>
              )}
              {(info.software_build_id || info.date_code || firmwareStatus) && (
                <AboutRow label="Firmware">
                  {(info.software_build_id || info.date_code) && (
                    <div className="font-medium">
                      {[info.software_build_id, info.date_code && formatDateCode(info.date_code)].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {firmwareStatus && <div className="text-xs text-neutral-500 mt-0.5">{firmwareStatus}</div>}
                  {installedOta && <div className="text-xs text-neutral-600 font-mono mt-0.5">image {installedOta}</div>}
                </AboutRow>
              )}
              {(info.manufacturer || info.model_id) && (
                <AboutRow label="Reports as">
                  <span className="text-neutral-400">{[info.manufacturer, info.model_id].filter(Boolean).join(' · ')}</span>
                </AboutRow>
              )}
            </div>
          </div>
        )}

        {/* Advanced Config Injection Point */}
        {advancedConfig && (
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-neutral-400">Advanced Settings</h4>
            {advancedConfig}
          </div>
        )}

        {/* Every other setting the device exposes, collapsed */}
        <AllSettings deviceId={deviceId} name={name} state={state} isOpen={isOpen} handled={handledSettings} />

        {/* Danger Zone: Trigger Modal */}
        <div className="space-y-3 mt-auto pt-8 pb-4">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/30 rounded-xl px-4 py-3 text-sm font-medium transition-colors"
          >
            <Trash2 size={18} />
            Remove Device
          </button>
        </div>

        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title="Remove device?"
          description={<>Remove <strong className="text-white">{name}</strong> from the Zigbee network? You’ll have to pair it again to use it.</>}
          confirmLabel="Remove"
          destructive
          onConfirm={confirmDelete}
        />

      </SheetContent>
    </Sheet>
  );
}