import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { DeviceConfigDrawer } from './DeviceConfigDrawer';

// Add this Tooltip helper
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

interface BaseDeviceCardProps {
  name: string;
  state: DeviceState;
  icon: React.ReactNode;
  iconColorClass?: string;
  subtitle?: React.ReactNode;
  onToggle?: () => void;
  children?: React.ReactNode; 
  advancedConfig?: React.ReactNode;
  renameDevice: (oldName: string, newName: string) => void;
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
}: BaseDeviceCardProps) {
  
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isOn = state.state === 'ON';

  return (
    <>
      <div className={`relative flex flex-col justify-between p-4 min-h-[150px] w-full rounded-3xl border transition-all duration-300 ${
        isOn ? 'bg-neutral-800/80 border-neutral-700 shadow-lg shadow-black/20' : 'bg-neutral-900/40 border-neutral-800/50 hover:bg-neutral-800/40'
      }`}>
        
        {/* Top Row: Icon & Controls */}
        <div className="flex justify-between items-start">
          <div className={`p-2.5 rounded-full transition-colors flex-shrink-0 ${iconColorClass}`}>
            {icon}
          </div>
          
        <div className="flex items-center gap-1">
             {/* Main Action Button (If applicable) */}
             {onToggle && (
               <Tooltip text={isOn ? "Turn Off" : "Turn On"}>
                 <button 
                   onClick={onToggle}
                   className={`p-2 rounded-full transition-all active:scale-95 ${isOn ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'hover:bg-neutral-800 text-neutral-400'}`}
                 >
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                 </button>
               </Tooltip>
             )}
             {/* Open Drawer Button */}
             <Tooltip text="Device Settings">
               <button 
                 onClick={() => setIsDrawerOpen(true)}
                 className="p-2 rounded-full text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
               >
                 <MoreHorizontal size={18} />
               </button>
             </Tooltip>
          </div>
        </div>

        {/* Middle Row: Primary Controls (Sliders, etc.) */}
        {children && (
          <div className="flex-grow flex items-center justify-center pt-2">
            {children}
          </div>
        )}

        {/* Bottom Row: Name & Subtitle */}
        <div className={`mt-auto pt-3 ${children ? 'pt-4' : ''}`}>
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

      {/* The Hidden Drawer */}
      <DeviceConfigDrawer
        name={name}
        state={state}
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        advancedConfig={advancedConfig}
        renameDevice={renameDevice}
      />
    </>
  );
}