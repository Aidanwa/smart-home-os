import { useState, useEffect } from 'react';
import { Lightbulb } from 'lucide-react';
import { BaseDeviceCard } from './BaseDeviceCard';

// This is to add tooltips to buttons
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="relative flex items-center justify-center group/tooltip w-full">
    {children}
    <div className="absolute bottom-full mb-2 px-2 py-1 bg-neutral-800 text-neutral-200 text-xs rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[100] border border-neutral-700 shadow-xl">
      {text}
    </div>
  </div>
);

export function ColorLightCard({ name, state, sendCommand, toggleDevice, renameDevice, deleteDevice }: any) {
  const isOn = state.state === 'ON';
  
  // Brightness Logic
  const serverBrightness = state.brightness ? Math.round((state.brightness / 254) * 100) : 0;
  const [localBrightness, setLocalBrightness] = useState(serverBrightness);

  // Color Temp Logic (Mired values usually range from 153 to 455)
  const serverColorTemp = state.color_temp || 300; 
  const [localColorTemp, setLocalColorTemp] = useState(serverColorTemp);

  useEffect(() => setLocalBrightness(serverBrightness), [serverBrightness]);
  useEffect(() => setLocalColorTemp(serverColorTemp), [serverColorTemp]);

  const handleBrightnessCommit = () => {
    const zigbeeBrightness = Math.round((localBrightness / 100) * 254);
    sendCommand(name, { brightness: zigbeeBrightness }); 
  };

  const handleColorTempCommit = () => {
    sendCommand(name, { color_temp: localColorTemp }); 
  };

  const subtitle = isOn ? `On • ${serverBrightness}%` : 'Off';

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Lightbulb size={22} strokeWidth={2.5} />}
      iconColorClass={isOn ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'}
      subtitle={subtitle}
      onToggle={() => toggleDevice(name, state.state)}
      advancedConfig={
        <div className="p-4 bg-neutral-900/50 border border-neutral-800/50 rounded-xl space-y-2">
          <p className="text-sm text-neutral-400">Power On Behavior:</p>
          <div className="flex gap-2">
             <span className="px-3 py-1 bg-neutral-800 text-xs rounded-md text-white font-medium">Previous</span>
             <span className="px-3 py-1 bg-neutral-900 text-xs rounded-md text-neutral-500 border border-neutral-800">On</span>
             <span className="px-3 py-1 bg-neutral-900 text-xs rounded-md text-neutral-500 border border-neutral-800">Off</span>
          </div>
        </div>
      }
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
    >
{/* Primary UI: Sliders stack vertically */}
      {isOn && (
        <div className="w-full flex flex-col gap-4">
          
          {/* Brightness Slider */}
          {state.brightness !== undefined && (
            <Tooltip text={`Brightness: ${localBrightness}%`}>
              <div className="relative w-full h-1 rounded-full bg-gradient-to-r from-black to-white border border-neutral-700/50 shadow-inner">
                <input 
                  type="range" min="1" max="100" 
                  value={localBrightness}
                  onChange={(e) => setLocalBrightness(parseInt(e.target.value, 10))}
                  onMouseUp={handleBrightnessCommit}
                  onTouchEnd={handleBrightnessCommit}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-neutral-800 rounded-full shadow-md pointer-events-none transition-all duration-75"
                  style={{ left: `calc(${localBrightness}% - 10px)` }}
                />
              </div>
            </Tooltip>
          )}

          {/* Color Temp Slider */}
          {state.color_temp !== undefined && (
             <Tooltip text={`Warmth: ${Math.round(((localColorTemp - 153) / (455 - 153)) * 100)}%`}>
               <div className="relative w-full h-1 rounded-full bg-gradient-to-r from-[#8cb8ff] via-white to-[#ffb347] border border-neutral-700/50 shadow-inner">
                 <input 
                   type="range" min="153" max="455" 
                   value={localColorTemp}
                   onChange={(e) => setLocalColorTemp(parseInt(e.target.value, 10))}
                   onMouseUp={handleColorTempCommit}
                   onTouchEnd={handleColorTempCommit}
                   className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                 />
                 <div 
                   className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-neutral-800 rounded-full shadow-md pointer-events-none transition-all duration-75"
                   style={{ left: `calc(${((localColorTemp - 153) / (455 - 153)) * 100}% - 10px)` }}
                 />
               </div>
             </Tooltip>
          )}
        </div>
      )}
    </BaseDeviceCard>
  );
}