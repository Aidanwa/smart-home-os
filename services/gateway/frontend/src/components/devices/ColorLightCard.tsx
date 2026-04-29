import { useState, useEffect } from 'react';
import { Lightbulb, Power } from 'lucide-react';

export function ColorLightCard({ name, state, sendCommand, toggleDevice }: any) {
  const isOn = state.state === 'ON';
  
  // Server state mapping
  const serverBrightness = state.brightness ? Math.round((state.brightness / 254) * 100) : 0;
  const serverColorTemp = state.color_temp || 300; 

  // Local state for smooth dragging before dropping
  const [localBrightness, setLocalBrightness] = useState(serverBrightness);
  const [localColorTemp, setLocalColorTemp] = useState(serverColorTemp);

  // Sync with server if another user/device changes the state
  useEffect(() => {
    setLocalBrightness(serverBrightness);
  }, [serverBrightness]);

  useEffect(() => {
    setLocalColorTemp(serverColorTemp);
  }, [serverColorTemp]);

  // --- Brightness Handlers ---
  const handleBrightnessDrag = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalBrightness(parseInt(e.target.value, 10)); // Updates UI instantly
  };
  const handleBrightnessCommit = () => {
    const zigbeeBrightness = Math.round((localBrightness / 100) * 254);
    sendCommand(name, { brightness: zigbeeBrightness }); // Sends to MQTT on drop
  };

  // --- Color Temp Handlers ---
  const handleColorTempDrag = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalColorTemp(parseInt(e.target.value, 10)); // Updates UI instantly
  };
  const handleColorTempCommit = () => {
    sendCommand(name, { color_temp: localColorTemp }); // Sends to MQTT on drop
  };

  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[160px] ${
      isOn ? 'bg-neutral-800/80 border-neutral-700 shadow-lg shadow-black/20' : 'bg-neutral-900/30 border-neutral-800/50'
    }`}>
      <div className="flex justify-between items-start mb-2">
        <div className={`p-2.5 rounded-full transition-colors ${isOn ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'}`}>
          <Lightbulb size={22} strokeWidth={2.5} />
        </div>
        <button 
          onClick={() => toggleDevice(name, state.state)}
          className={`p-2.5 rounded-full transition-all active:scale-95 ${isOn ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400'}`}
        >
          <Power size={18} strokeWidth={2.5} />
        </button>
      </div>
      
      <div>
        <h3 className="font-medium text-lg tracking-tight truncate mb-4">{name}</h3>
        
        {/* Hide Sliders if Light is Off */}
        {!isOn ? (
          <p className="text-sm text-neutral-500 font-medium pb-2">Off</p>
        ) : (
          <div className="flex flex-col gap-5 pb-1">
            
            {/* Brightness Slider (Black to White) */}
            {state.brightness !== undefined && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1 h-2 rounded-full bg-gradient-to-r from-black to-white border border-neutral-700/50 shadow-inner">
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={localBrightness}
                    onChange={handleBrightnessDrag}
                    onMouseUp={handleBrightnessCommit}
                    onTouchEnd={handleBrightnessCommit}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {/* Custom Thumb */}
                  <div 
                    className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-neutral-800 rounded-full shadow-md pointer-events-none transition-all duration-75"
                    style={{ left: `calc(${localBrightness}% - 8px)` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-400 w-8 text-right uppercase tracking-wider font-medium">
                  {localBrightness}%
                </span>
              </div>
            )}

            {/* Color Temperature Slider (Cool to Warm) */}
            {state.color_temp !== undefined && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1 h-2 rounded-full bg-gradient-to-r from-[#8cb8ff] via-[#ffffff] to-[#ffb347] border border-neutral-700/50 shadow-inner">
                  <input 
                    type="range" 
                    min="153" 
                    max="454" 
                    value={localColorTemp}
                    onChange={handleColorTempDrag}
                    onMouseUp={handleColorTempCommit}
                    onTouchEnd={handleColorTempCommit}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {/* Custom Thumb */}
                  <div 
                    className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-neutral-800 rounded-full shadow-md pointer-events-none transition-all duration-75"
                    style={{ left: `calc(${((localColorTemp - 153) / (454 - 153)) * 100}% - 8px)` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-400 w-8 text-right uppercase tracking-wider font-medium">Temp</span>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}