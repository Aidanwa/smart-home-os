// services/gateway/frontend/src/App.tsx
import { useState, useMemo, useRef } from 'react';
import { useDevices } from './hooks/useDevices';
import { AuthProvider, useAuth } from './context/AuthContext';
import { 
  Radio, Workflow,
  Lightbulb, Zap, Thermometer, ToggleRight, Box
} from 'lucide-react';
import { getDeviceCategory } from './lib/deviceUtils';
import { DeviceCategorySection } from './components/devices/DeviceCategorySection';
import type { DeviceSection } from './components/devices/DeviceCategorySection';
import { GroupsView } from './components/groups/GroupsView';
import { AgentChat } from './components/agent/AgentChat';
import { LoginCard } from './components/auth/LoginCard';
import { Sidebar } from './components/layout/Sidebar';
import { SettingsView } from './components/settings/SettingsView';
import { RoomsView } from './components/rooms/RoomsView';

// Heavy functional hooks are isolated into this sub-component to ensure they remain safely suspended from execution until authentication settles
function AuthenticatedDashboard() {
  const { devices, toggleDevice, sendCommand, permitJoin, renameDevice, deleteDevice } = useDevices();
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'home' | 'agent' | 'rooms' | 'routines' | 'settings'>('home');
  const [dashboardView, setDashboardView] = useState<'devices' | 'groups'>('devices');
  const [isPairing, setIsPairing] = useState(false);
  const [sortMode, setSortMode] = useState<'type' | 'alphabetical'>('type');

  // DRAG ENGINE STATE: Tracks absolute pixel coordinates from bottom-right boundary lines
  const [fabPos, setFabPos] = useState({ right: 24, bottom: 24 });
  const [isDragging, setIsDragging] = useState(false);
  
  // High-precision tracking references to monitor real displacement paths
  const dragStartRef = useRef({ clientX: 0, clientY: 0 });
  const posStartRef = useRef({ right: 24, bottom: 24 });
  const totalMovementRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    setIsDragging(true);
    totalMovementRef.current = 0;
    dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
    posStartRef.current = { ...fabPos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    
    // Compute total coordinate delta trajectories
    const deltaX = e.clientX - dragStartRef.current.clientX;
    const deltaY = e.clientY - dragStartRef.current.clientY;
    
    // Accumulate total dragging displacement to separate a drag move from a normal touch tap
    totalMovementRef.current += Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Invert changes because position anchors to absolute right and bottom bounds
    setFabPos({
      right: Math.max(16, posStartRef.current.right - deltaX),
      bottom: Math.max(16, posStartRef.current.bottom - deltaY)
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    // UX GUARD: Trigger pairing loops only if the movement radius was lower than a 5px vibration margin
    if (totalMovementRef.current < 5) {
      handleTogglePairing();
    }
  };

  const handleTogglePairing = () => {
    if (isPairing) {
      permitJoin(false, 0);
      setIsPairing(false);
    } else {
      permitJoin(true, 254);
      setIsPairing(true);
      setTimeout(() => setIsPairing(false), 254000); 
    }
  };

  const displaySections = useMemo(() => {
    const activeDevices = Object.entries(devices)
      .filter(([name]) => name !== 'bridge')
      .map(([name, state]) => ({ name, state }));

    if (sortMode === 'alphabetical') {
      return [{ id: 'all', title: null, devices: activeDevices.sort((a, b) => a.name.localeCompare(b.name)) }] as DeviceSection[];
    }

    const groups: Record<string, DeviceSection> = {
      'Lights': { id: 'lights', title: 'Lights', icon: <Lightbulb size={18} />, devices: [] },
      'Smart Plugs': { id: 'plugs', title: 'Smart Plugs', icon: <Zap size={18} />, devices: [] },
      'Sensors': { id: 'sensors', title: 'Environment', icon: <Thermometer size={18} />, devices: [] },
      'Switches': { id: 'switches', title: 'Switches', icon: <ToggleRight size={18} />, devices: [] },
      'Other': { id: 'other', title: 'Other Devices', icon: <Box size={18} />, devices: [] }
    };

    activeDevices.forEach(device => {
      const category = getDeviceCategory(device.state);
      groups[category].devices.push(device);
    });

    return Object.values(groups).filter(section => section.devices.length > 0);
  }, [devices, sortMode]);

  return (
    <div className="flex flex-col-reverse md:flex-row min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      
      {/* Decoupled High-Speed Modular Navigation System */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 p-6 md:p-10 overflow-y-auto w-full">
        {activeTab === 'home' && (
          <div className="animate-in fade-in duration-500">
            <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
              <h1 className="text-2xl font-medium tracking-tight">Welcome back, {user?.username}</h1>
              <div className="flex items-center gap-2">
                <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800">
                  <button onClick={() => setSortMode('type')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sortMode === 'type' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}>By Type</button>
                  <button onClick={() => setSortMode('alphabetical')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sortMode === 'alphabetical' ? 'bg-neutral-800 text-white' : 'text-neutral-500'}`}>A-Z</button>
                </div>
                <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800">
                  <button onClick={() => setDashboardView('devices')} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${dashboardView === 'devices' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>Devices</button>
                  <button onClick={() => setDashboardView('groups')} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${dashboardView === 'groups' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>Groups</button>
                </div>
              </div>
            </header>

            {dashboardView === 'devices' ? (
              <>
                <div className="w-full">
                  {displaySections.map(section => (
                    <DeviceCategorySection key={section.id} {...section} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
                  ))}
                </div>
                {/* DRAGGABLE FAB CONTROL OVERLAY PANEL */}
                <div 
                  className="fixed z-50 select-none touch-none"
                  style={{
                    right: `${fabPos.right}px`,
                    bottom: `${fabPos.bottom}px`,
                    transition: isDragging ? 'none' : 'right 0.15s ease, bottom 0.15s ease'
                  }}
                >
                  <button 
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className={`flex items-center gap-3 px-5 py-3.5 rounded-full border shadow-2xl cursor-grab active:cursor-grabbing select-none focus:outline-none focus:ring-0 ${
                      isDragging ? 'scale-105 border-neutral-500' : ''
                    } ${isPairing ? 'bg-blue-900/40 border-blue-500 text-blue-400 backdrop-blur-md' : 'bg-neutral-900 border-neutral-700 text-neutral-300'}`}
                  >
                    <Radio size={20} className={isPairing ? 'animate-pulse' : ''} />
                    <span className="text-sm font-medium">{isPairing ? 'Pairing Active...' : 'Add Device'}</span>
                  </button>
                </div>
              </>
            ) : (
              <GroupsView devices={devices} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
            )}
          </div>
        )}

        {activeTab === 'agent' && <AgentChat />}

        {activeTab === 'rooms' && (
          <div className="animate-in fade-in duration-500 h-full flex flex-col">
            <header className="mb-6">
              <h1 className="text-2xl font-medium tracking-tight">Spatial Layout</h1>
              <p className="text-neutral-500 text-sm mt-1">Design your floorplan and assign devices to rooms.</p>
            </header>
            <div className="flex-1 bg-neutral-900/30 rounded-2xl border border-neutral-800 overflow-hidden relative">
               <RoomsView devices={devices} />
            </div>
          </div>
        )}

        {activeTab === 'routines' && (
          <div className="h-[80vh] flex items-center justify-center text-neutral-500">
            <div className="text-center">
              <Workflow className="mx-auto mb-4 opacity-50" size={48} />
              <h2 className="text-xl font-medium text-neutral-300">Routine Orchestrator</h2>
              <p className="text-xs text-neutral-500 mt-1 max-w-xs leading-relaxed">Create and plan automatic behaviors to synchronize your household schedules.</p>
            </div>
          </div>
        )}

        {/* Overhauled Tabbed Control Panel Settings View */}
        {activeTab === 'settings' && <SettingsView />}
        
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-400 font-mono">Initializing System context...</div>;
  return isAuthenticated ? <AuthenticatedDashboard /> : <LoginCard />;
}