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

// Heavy functional hooks are isolated into this sub-component to ensure they remain safely suspended from execution until authentication settles
function AuthenticatedDashboard() {
  const { devices, toggleDevice, sendCommand, permitJoin, renameDevice, deleteDevice } = useDevices();
  const { logout, user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'home' | 'agent' | 'routines' | 'settings'>('home');
  const [settingsTab, setSettingsTab] = useState<'account' | 'connections' | 'admin'>('account');
  const [dashboardView, setDashboardView] = useState<'devices' | 'groups'>('devices');
  const [isPairing, setIsPairing] = useState(false);
  const [sortMode, setSortMode] = useState<'type' | 'alphabetical'>('type');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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
        {activeTab === 'settings' && (
          <div className="animate-in fade-in duration-500 max-w-4xl w-full">
            <header className="mb-8">
              <h1 className="text-2xl font-medium tracking-tight">System Settings</h1>
              <p className="text-sm text-neutral-500 mt-1">Manage user identity credentials, coordinate external integrations, and access admin consoles.</p>
            </header>

            {/* Sub-tab navigation menu items */}
            <div className="flex border-b border-neutral-800 mb-6 gap-6 text-sm font-medium">
              <button 
                onClick={() => setSettingsTab('account')} 
                className={`pb-3 transition-colors relative ${settingsTab === 'account' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Account Setup
              </button>
              <button 
                onClick={() => setSettingsTab('connections')} 
                className={`pb-3 transition-colors relative ${settingsTab === 'connections' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                External Connections
              </button>
              <button 
                onClick={() => setSettingsTab('admin')} 
                className={`pb-3 transition-colors relative ${settingsTab === 'admin' ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Admin Console
              </button>
            </div>

            {/* Sub-view Content Branches */}
            {settingsTab === 'account' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4">
                  <h2 className="text-base font-medium text-neutral-200">Update Profile Fields</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Username</label>
                      <input type="text" defaultValue={user?.username} className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">New Password</label>
                      <input type="password" placeholder="••••••••" className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors" />
                    </div>
                  </div>
                  <button className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]">
                    Save Profile Changes
                  </button>
                </div>

                <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="text-base font-medium text-neutral-200">Log Out of System</h2>
                    <p className="text-xs text-neutral-500 mt-0.5">Safely terminate your active web session context on this local device display panel.</p>
                  </div>
                  <button 
                    onClick={() => setShowLogoutConfirm(true)} 
                    className="px-4 py-2 bg-red-950/40 hover:bg-red-900/30 text-red-400 border border-red-900/50 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]"
                  >
                    Disconnect Session
                  </button>
                </div>
              </div>
            )}

            {settingsTab === 'connections' && (
              <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
                <h2 className="text-base font-medium text-neutral-200">External Cloud Integration Secrets</h2>
                <p className="text-xs text-neutral-500 leading-relaxed">Securely establish identity links with external resource providers to empower your local agentic reasoning capabilities.</p>
                
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-green-500/10 text-green-400 flex items-center justify-center rounded-lg font-bold text-xs tracking-wider">SPOT</div>
                      <div>
                        <h3 className="text-sm font-medium text-neutral-200">Spotify Music Link</h3>
                        <p className="text-xs text-neutral-500">Allows your home helper agent to automatically command network media playback items.</p>
                      </div>
                    </div>
                    <button className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg font-medium transition-colors">Configure Tokens</button>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-500/10 text-purple-400 flex items-center justify-center rounded-lg font-bold text-xs tracking-wider">OPEN</div>
                      <div>
                        <h3 className="text-sm font-medium text-neutral-200">OpenAI Credentials Vault</h3>
                        <p className="text-xs text-neutral-500">Links secure developer platform API tokens into your local chat orchestrator loop.</p>
                      </div>
                    </div>
                    <button className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg font-medium transition-colors">Configure Keys</button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab === 'admin' && (
              <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
                <div className="flex items-center gap-2 border-b border-neutral-800 pb-3 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-md">Root Operator</span>
                  <h2 className="text-base font-medium text-neutral-200">Administrative Configuration</h2>
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">Advanced controls and system configurations reserved for internal system deployment oversight.</p>
                <p className="text-xs text-neutral-500 leading-relaxed">This section is intentionally left minimal as the current system iteration does not expose any adjustable parameters to end users.</p>
              </div>
            )}

            {/* Safety Logout Overlay Modal Confirmation Sheet */}
            {showLogoutConfirm && (
              <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
                  <h3 className="text-lg font-medium text-neutral-100">Confirm Disconnection</h3>
                  <p className="text-sm text-neutral-400 leading-relaxed">Are you completely sure you want to log out of your Smart Home OS cluster? You will be required to input credentials again to re-authenticate.</p>
                  <div className="flex gap-3 justify-end pt-2">
                    <button onClick={() => setShowLogoutConfirm(false)} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-xl transition-colors">
                      Cancel
                    </button>
                    <button onClick={logout} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-xl transition-colors active:scale-[0.99]">
                      Confirm Log Out
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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