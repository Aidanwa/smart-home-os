import { useState } from 'react';
import { BatteryLow, Download, Loader2, MoreHorizontal } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { isBatteryLow } from '../../lib/deviceUtils';
import { usePending } from '../../lib/api';
import { DeviceConfigDrawer } from './DeviceConfigDrawer';

interface BaseDeviceCardProps {
  name: string;
  state: DeviceState;
  icon: React.ReactNode;
  iconColorClass?: string;
  subtitle?: React.ReactNode;
  /** When set, tapping anywhere on the card (outside its own controls) calls it. */
  onToggle?: () => void;
  children?: React.ReactNode;
  advancedConfig?: React.ReactNode;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (deviceId: string, label?: string) => void;
}

export function BaseDeviceCard({
  name,
  state,
  icon,
  iconColorClass = 'text-neutral-500 bg-neutral-800',
  subtitle,
  onToggle,
  children,
  advancedConfig,
  renameDevice,
  deleteDevice,
}: BaseDeviceCardProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isOn = state.state === 'ON';
  const lowBattery = isBatteryLow(state);
  // Z2M's OTA status: update.state is idle | available | scheduled | updating
  const ota = state.update?.state;
  const otaProgress = typeof state.update?.progress === 'number' ? Math.round(state.update.progress) : null;
  // A command is on its way; ignore further taps until the device answers (or fails),
  // otherwise a second tap would flip it back based on the not-yet-updated state.
  const busy = usePending(name);

  return (
    <>
      {/* The toggle is a full-size button behind the content; the content ignores pointer
          events except for the real controls (⋯ and sliders), which sit above it. */}
      <div aria-busy={busy} className={`relative flex flex-col justify-between p-4 min-h-[150px] w-full rounded-3xl border transition-all duration-300 ${
        isOn ? 'bg-neutral-800/80 border-neutral-700 shadow-lg shadow-black/20' : 'bg-neutral-900/40 border-neutral-800/50'
      } ${onToggle ? 'hover:border-neutral-600 active:scale-[0.99]' : ''}`}>
        {onToggle && (
          <button
            type="button"
            onClick={() => { if (!busy) onToggle(); }}
            aria-pressed={isOn}
            aria-label={`${name}: ${isOn ? 'on' : 'off'}. Turn ${isOn ? 'off' : 'on'}`}
            className="absolute inset-0 rounded-3xl cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          />
        )}

        {/* Top row: icon, battery warning, settings */}
        <div className="relative flex justify-between items-start pointer-events-none">
          <div className={`p-2.5 rounded-full transition-colors flex-shrink-0 ${iconColorClass}`}>
            {icon}
          </div>
          <div className="flex items-center gap-1">
            {busy && (
              <Loader2 size={16} className="animate-spin text-neutral-400" aria-label="Sending" />
            )}
            {lowBattery && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[11px] font-medium">
                <BatteryLow size={12} /> Low battery
              </span>
            )}
            {(ota === 'available' || ota === 'scheduled' || ota === 'updating') && (
              // Opens the drawer, which has the Install button and the progress bar.
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                aria-label={ota === 'updating'
                  ? `${name}: updating firmware${otaProgress !== null ? `, ${otaProgress}%` : ''}`
                  : `${name}: firmware update ${ota === 'scheduled' ? 'scheduled' : 'available'}. Open settings`}
                className="pointer-events-auto flex items-center gap-1 px-2 min-h-7 rounded-full bg-sky-500/10 text-sky-400 text-[11px] font-medium hover:bg-sky-500/20 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {ota === 'updating'
                  ? <><Loader2 size={12} className="animate-spin" /> {otaProgress !== null ? `${otaProgress}%` : 'Updating'}</>
                  : <><Download size={12} /> {ota === 'scheduled' ? 'Scheduled' : 'Update'}</>}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              aria-label={`Settings for ${name}`}
              title="Device settings"
              className="pointer-events-auto p-2 rounded-full text-neutral-500 hover:text-white hover:bg-neutral-700/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>

        {/* Middle row: the card's own controls or reading */}
        {children && (
          <div className="relative flex-grow flex items-center justify-center pt-2 pointer-events-none [&_[data-control]]:pointer-events-auto">
            {children}
          </div>
        )}

        {/* Bottom row: name and status */}
        <div className={`relative mt-auto pointer-events-none ${children ? 'pt-4' : 'pt-3'}`}>
          <h3 className="font-semibold text-base leading-tight text-neutral-200 line-clamp-2 pr-2">
            {name}
          </h3>
          {subtitle && (
            <p className="text-xs font-medium text-neutral-500 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <DeviceConfigDrawer
        name={name}
        state={state}
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        advancedConfig={advancedConfig}
        renameDevice={renameDevice}
        deleteDevice={deleteDevice}
      />
    </>
  );
}
