// services/gateway/frontend/src/components/rooms/sidebar/DevicePanel.tsx
import { useMemo, useState } from 'react';
import { Lightbulb, Plug, Radio, Thermometer, ChevronRight, ChevronDown, PanelRightClose, PanelRightOpen, MapPin } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DevicePlacement, LogicalZone } from '../types';

const getDeviceIcon = (device: any) => {
  const name = device.friendly_name?.toLowerCase() || '';
  if (name.includes('light') || device.brightness !== undefined) return <Lightbulb className="w-4 h-4 text-amber-400" />;
  if (device.power !== undefined || device.voltage !== undefined) return <Plug className="w-4 h-4 text-emerald-400" />;
  if (device.temperature !== undefined) return <Thermometer className="w-4 h-4 text-blue-400" />;
  return <Radio className="w-4 h-4 text-neutral-400" />;
};

interface ListProps {
  devices: Record<string, any>;
  placements: DevicePlacement[];
  zones: LogicalZone[];
  /** The room a tapped device goes into; null until one is selected on the plan. */
  selectedZone: LogicalZone | null;
  onPlace: (ieee_address: string) => void;
}

/** Unplaced devices (tap to put one in the selected room), then what's in each room. */
function DeviceList({ devices, placements, zones, selectedZone, onPlace }: ListProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ unplaced: true });
  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const { unplaced, mappedByZone } = useMemo(() => {
    const allDevices = Object.values(devices);
    const placedAddresses = new Set(placements.filter(p => p.zone_id !== null).map(p => p.ieee_address));
    const unplaced = allDevices
      .filter(d => !placedAddresses.has(d.ieee_address))
      .sort((a, b) => String(a.friendly_name).localeCompare(String(b.friendly_name)));
    const mappedByZone: Record<string, any[]> = {};
    zones.forEach(z => { mappedByZone[z.id] = []; });
    placements.forEach(p => {
      if (p.zone_id && mappedByZone[p.zone_id] && devices[p.ieee_address]) {
        mappedByZone[p.zone_id].push(devices[p.ieee_address]);
      }
    });
    return { unplaced, mappedByZone };
  }, [devices, placements, zones]);

  return (
    <div className="space-y-4">
      <p className={`text-xs px-1 ${selectedZone ? 'text-neutral-400' : 'text-amber-400/90'}`}>
        {selectedZone
          ? <>Tap a device to put it in <strong className="text-neutral-200">{selectedZone.name}</strong>.</>
          : 'Tap a room on the plan first, then a device to put in it.'}
      </p>

      <div>
        <button onClick={() => toggleSection('unplaced')} className="flex items-center w-full p-1 text-xs font-semibold text-neutral-400 hover:text-neutral-200 uppercase tracking-wider">
          {openSections['unplaced'] ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
          Not in a room ({unplaced.length})
        </button>
        {openSections['unplaced'] && (
          <div className="mt-1.5 space-y-1">
            {unplaced.map((device) => (
              <button key={device.ieee_address} onClick={() => onPlace(device.ieee_address)} disabled={!selectedZone}
                className="w-full text-left flex items-center p-2 rounded-md bg-neutral-900/50 enabled:hover:bg-neutral-800 border border-neutral-800 transition-colors disabled:opacity-50">
                <div className="p-1.5 rounded-md bg-neutral-950 mr-2 border border-neutral-800">{getDeviceIcon(device)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-200 truncate">{device.friendly_name}</div>
                </div>
              </button>
            ))}
            {unplaced.length === 0 && <p className="text-xs text-neutral-600 px-1">Every device is in a room.</p>}
          </div>
        )}
      </div>

      {zones.map(zone => {
        const zoneDevices = mappedByZone[zone.id] || [];
        if (zoneDevices.length === 0) return null;
        return (
          <div key={zone.id}>
            <button onClick={() => toggleSection(zone.id)} className="flex items-center w-full p-1 text-xs font-semibold text-neutral-500 hover:text-neutral-300 uppercase tracking-wider">
              {openSections[zone.id] ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
              {zone.name} ({zoneDevices.length})
            </button>
            {openSections[zone.id] && (
              <div className="mt-1.5 space-y-1">
                {zoneDevices.map((device) => (
                  <div key={device.ieee_address} className="w-full flex items-center p-2 rounded-md opacity-60">
                    <div className="p-1 mr-2"><MapPin className="w-3 h-3 text-neutral-600" /></div>
                    <div className="text-xs font-medium text-neutral-400 truncate">{device.friendly_name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Desktop: a collapsible sidebar beside the plan. Hidden on phones (see DeviceSheet). */
export function DevicePanel(props: ListProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <div className="hidden md:flex w-12 bg-neutral-950 border-l border-neutral-800 flex-col items-center py-4 shrink-0">
        <button onClick={() => setIsCollapsed(false)} aria-label="Show devices" className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors">
          <PanelRightOpen size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="hidden md:flex w-64 h-full bg-neutral-950 border-l border-neutral-800 flex-col shrink-0">
      <div className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/20">
        <h2 className="text-sm font-semibold text-neutral-200">Devices</h2>
        <button onClick={() => setIsCollapsed(true)} aria-label="Hide devices" className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors">
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <DeviceList {...props} />
      </div>
    </div>
  );
}

/** Phones: the same list in a bottom sheet, so the plan keeps the whole screen. */
export function DeviceSheet({ open, onOpenChange, ...props }: ListProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-neutral-950 border-t border-neutral-800 text-neutral-200 max-h-[70dvh] rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="text-left pb-0">
          <SheetTitle className="text-neutral-100">Place devices</SheetTitle>
          <SheetDescription className="sr-only">Put devices into rooms on the floor plan.</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-2">
          <DeviceList {...props} onPlace={(ieee) => { props.onPlace(ieee); onOpenChange(false); }} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
