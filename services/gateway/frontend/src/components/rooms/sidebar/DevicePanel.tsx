// services/gateway/frontend/src/components/rooms/sidebar/DevicePanel.tsx
import { useMemo, useState } from 'react';
import { Lightbulb, Plug, Radio, Thermometer, ChevronRight, ChevronDown, PanelRightClose, PanelRightOpen, MapPin } from 'lucide-react';
import type { DevicePlacement, LogicalZone } from '../types';

const getDeviceIcon = (device: any) => {
  const name = device.friendly_name?.toLowerCase() || '';
  if (name.includes('light') || device.brightness !== undefined) return <Lightbulb className="w-4 h-4 text-amber-400" />;
  if (device.power !== undefined || device.voltage !== undefined) return <Plug className="w-4 h-4 text-emerald-400" />;
  if (device.temperature !== undefined) return <Thermometer className="w-4 h-4 text-blue-400" />;
  return <Radio className="w-4 h-4 text-neutral-400" />;
};

interface DevicePanelProps {
  devices: Record<string, any>;
  placements: DevicePlacement[];
  zones: LogicalZone[];
  onDeviceClick: (ieee_address: string) => void;
}

export function DevicePanel({ devices, placements, zones, onDeviceClick }: DevicePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ unplaced: true });

  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Group devices logically
  const { unplaced, mappedByZone } = useMemo(() => {
    const allDevices = Object.values(devices);
    const placedAddresses = new Set(placements.filter(p => p.zone_id !== null).map(p => p.ieee_address));
    
    const unplaced = allDevices.filter(d => !placedAddresses.has(d.ieee_address));
    
    const mappedByZone: Record<string, any[]> = {};
    zones.forEach(z => { mappedByZone[z.id] = []; });
    
    placements.forEach(p => {
      if (p.zone_id && mappedByZone[p.zone_id] && devices[p.ieee_address]) {
        mappedByZone[p.zone_id].push(devices[p.ieee_address]);
      }
    });

    return { unplaced, mappedByZone };
  }, [devices, placements, zones]);

  if (isCollapsed) {
    return (
      <div className="w-12 bg-neutral-950 border-l border-neutral-800 flex flex-col items-center py-4 shrink-0 transition-all duration-300">
        <button onClick={() => setIsCollapsed(false)} className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors">
          <PanelRightOpen size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 bg-neutral-950 border-l border-neutral-800 flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="p-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/20">
        <h2 className="text-sm font-semibold text-neutral-200">Device Roster</h2>
        <button onClick={() => setIsCollapsed(true)} className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors">
          <PanelRightClose size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Unplaced Accordion */}
        <div>
          <button onClick={() => toggleSection('unplaced')} className="flex items-center w-full p-1 text-xs font-semibold text-neutral-400 hover:text-neutral-200 uppercase tracking-wider">
            {openSections['unplaced'] ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
            Unplaced ({unplaced.length})
          </button>
          
          {openSections['unplaced'] && (
            <div className="mt-1.5 space-y-1">
              {unplaced.map((device) => (
                <button key={device.ieee_address} onClick={() => onDeviceClick(device.ieee_address)} className="w-full text-left flex items-center p-2 rounded-md bg-neutral-900/50 hover:bg-neutral-800 border border-neutral-800 transition-colors">
                  <div className="p-1.5 rounded-md bg-neutral-950 mr-2 border border-neutral-800">{getDeviceIcon(device)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-200 truncate">{device.friendly_name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dynamic Zone Accordions */}
        {zones.map(zone => {
          const zoneDevices = mappedByZone[zone.id] || [];
          if (zoneDevices.length === 0) return null; // Hide empty rooms

          return (
            <div key={zone.id}>
              <button onClick={() => toggleSection(zone.id)} className="flex items-center w-full p-1 text-xs font-semibold text-neutral-500 hover:text-neutral-300 uppercase tracking-wider">
                {openSections[zone.id] ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                {zone.name} ({zoneDevices.length})
              </button>
              
              {openSections[zone.id] && (
                <div className="mt-1.5 space-y-1">
                  {zoneDevices.map((device) => (
                    <div key={device.ieee_address} className="w-full flex items-center p-2 rounded-md bg-transparent opacity-60 pointer-events-none">
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
    </div>
  );
}