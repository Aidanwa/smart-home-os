// services/gateway/frontend/src/App.tsx
import { useState, useMemo } from 'react';
import { useDevices } from './hooks/useDevices';
import { useSystemHealth } from './hooks/useSystemHealth';
import { AuthProvider, useAuth } from './context/AuthContext';
import { 
  Home, Sparkles, Settings, PanelLeftClose, PanelLeft, Radio, Workflow,
  Lightbulb, Zap, Thermometer, ToggleRight, Box, LogOut,
} from 'lucide-react';
import { getDeviceCategory } from './lib/deviceUtils';
import { DeviceCategorySection } from './components/devices/DeviceCategorySection';
import type { DeviceSection } from './components/devices/DeviceCategorySection';
import { GroupsView } from './components/groups/GroupsView';
import { AgentChat } from './components/agent/AgentChat';
import { LoginCard } from './components/auth/LoginCard';

// Heavy functional hooks are isolated into this sub-component to ensure they remain safely suspended from execution until authentication settles
function AuthenticatedDashboard() {
  const { devices, toggleDevice, sendCommand, permitJoin, renameDevice, deleteDevice } = useDevices();
  const healthStatus = useSystemHealth();
  const { logout, user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'home' | 'agent' | 'routines' | 'settings'>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dashboardView, setDashboardView] = useState<'devices' | 'groups'>('devices');
  const [isPairing, setIsPairing] = useState(false);
  const [sortMode, setSortMode] = useState<'type' | 'alphabetical'>('type');

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

  const NavItem = ({ id, icon: Icon, label }: { id: string, icon: any, label: string }) => {
    const isActive = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id as any)}
        className={`group relative flex items-center p-3 md:py-3 w-full rounded-xl transition-all duration-200 ${
          isSidebarCollapsed ? 'justify-center md:px-3' : 'justify-center md:justify-start md:px-4 gap-3'
        } ${isActive ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:bg-neutral-900/50 hover:text-neutral-300'}`}
      >
        <Icon size={20} className={isActive ? 'text-blue-400' : ''} />
        <span className={`text-[10px] md:text-sm font-medium ${isSidebarCollapsed ? 'hidden md:hidden' : 'block'}`}>{label}</span>
        {isSidebarCollapsed && (
          <div className="hidden md:block absolute left-full ml-4 px-2.5 py-1.5 bg-neutral-800 text-neutral-200 text-xs font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 border border-neutral-700 shadow-xl">{label}</div>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col-reverse md:flex-row min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      <nav className={`border-t md:border-t-0 md:border-r border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky bottom-0 md:top-0 z-40 md:h-screen flex md:flex-col p-2 md:p-4 justify-around md:justify-start gap-1 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'} w-full`}>
        <div className={`hidden md:flex items-center mb-8 px-2 py-2 ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isSidebarCollapsed && <h1 className="text-xl font-medium tracking-tight whitespace-nowrap overflow-hidden">Smart Home os</h1>}
          <div className="flex items-center gap-3">
            <div className="relative group flex items-center justify-center cursor-help">
              <div className={`w-2.5 h-2.5 rounded-full ${healthStatus === 'healthy' ? 'bg-green-500' : healthStatus === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
            </div>
            <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-lg transition-colors hidden md:block">
              {isSidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
        </div>

        <NavItem id="home" icon={Home} label="Home" />
        <NavItem id="agent" icon={Sparkles} label="Agent" />
        <NavItem id="routines" icon={Workflow} label="Routines" />
        
        <div className="md:mt-auto space-y-1 w-full">
          <NavItem id="settings" icon={Settings} label="Settings" />
          <button onClick={logout} className={`flex items-center p-3 w-full rounded-xl text-red-400 hover:bg-red-500/10 transition-all ${isSidebarCollapsed ? 'justify-center' : 'justify-start px-4 gap-3'}`}>
            <LogOut size={20} />
            {!isSidebarCollapsed && <span className="text-sm font-medium">Logout</span>}
          </button>
        </div>
      </nav>

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
                <div className="fixed bottom-6 right-6 z-50">
                  <button onClick={handleTogglePairing} className={`flex items-center gap-3 px-5 py-3.5 rounded-full border transition-all ${isPairing ? 'bg-blue-900/40 border-blue-500 text-blue-400 backdrop-blur-md' : 'bg-neutral-900 border-neutral-700 text-neutral-300'}`}>
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
            </div>
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