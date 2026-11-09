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

// This is to add tooltips to buttons
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

interface DeviceConfigDrawerProps {
  name: string;
  state: DeviceState;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  advancedConfig?: React.ReactNode;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (deviceId: string, label?: string) => void;
}

export function DeviceConfigDrawer({ 
  name, 
  state, 
  isOpen, 
  onOpenChange, 
  advancedConfig,
  renameDevice,
  deleteDevice,
}: DeviceConfigDrawerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Firmware install: a second tap confirms; `starting` covers the request itself.
  const [confirmFirmware, setConfirmFirmware] = useState(false);
  const [startingFirmware, setStartingFirmware] = useState(false);

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
    setShowDeleteConfirm(false);
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
                className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-xl font-medium tracking-tight focus:outline-none focus:border-blue-500 text-white w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
              <Tooltip text="Save">
                <button onClick={handleRenameSubmit} className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                  <Check size={18} />
                </button>
              </Tooltip>
              <Tooltip text="Cancel">
                <button onClick={() => setIsEditing(false)} className="p-2 rounded-lg bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors">
                  <X size={18} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-start justify-between group">
              <div className="flex flex-col">
                <SheetTitle className="text-2xl font-semibold tracking-tight text-white pr-4">
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
                  className="p-2 rounded-full text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors mt-1"
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

        {/* Advanced Config Injection Point */}
        {advancedConfig && (
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-neutral-400">Advanced Settings</h4>
            {advancedConfig}
          </div>
        )}

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

        {/* Delete Confirmation Panel */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-red-400">
                <AlertTriangle size={24} />
                <h3 className="font-medium text-lg">Remove Device?</h3>
              </div>
              <p className="text-neutral-400 text-sm">
                Remove <strong className="text-white">"{name}"</strong> from the Zigbee network? You’ll have to pair it again to use it.
              </p>
              <div className="flex justify-end gap-3 pt-4">
                <Tooltip text="Cancel removal">
                  <button 
                    onClick={() => setShowDeleteConfirm(false)} 
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-white transition-colors"
                  >
                    Cancel
                  </button>
                </Tooltip>
                <Tooltip text="Permanently remove device">
                  <button 
                    onClick={confirmDelete} 
                    className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                  >
                    Remove
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        )}

      </SheetContent>
    </Sheet>
  );
}