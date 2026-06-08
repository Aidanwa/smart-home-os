// services/gateway/frontend/src/components/layout/Sidebar.tsx
import { useState } from 'react';
import { 
  Home, Sparkles, Workflow, Settings, 
  PanelLeftClose, PanelLeft, Map,
} from 'lucide-react';
import { useSystemHealth } from '../../hooks/useSystemHealth';

interface SidebarProps {
  activeTab: 'home' | 'agent' | 'rooms' | 'routines' | 'settings';
  setActiveTab: (tab: 'home' | 'agent' | 'rooms' | 'routines' | 'settings') => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const healthStatus = useSystemHealth();

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'agent', icon: Sparkles, label: 'Agent' },
    { id: 'rooms', icon: Map, label: 'Rooms' },
    { id: 'routines', icon: Workflow, label: 'Routines' },
  ] as const;

  return (
    <nav className={`border-t md:border-t-0 md:border-r border-neutral-800 bg-neutral-950/80 backdrop-blur-md sticky bottom-0 md:top-0 z-40 md:h-screen flex md:flex-col p-2 md:p-4 justify-around md:justify-start gap-1 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'} w-full`}>
      
      {/* Brand Label & Control Header */}
      <div className={`hidden md:flex items-center mb-4 px-2 py-1 w-full ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!isSidebarCollapsed && (
          <h1 className="text-xl font-medium tracking-tight text-neutral-100 whitespace-nowrap overflow-hidden animate-in fade-in duration-300">
            Smart Home os
          </h1>
        )}
        <div className="flex items-center gap-3">
          {/* Luminous System Health Indicator */}
          <div className="relative group flex items-center justify-center cursor-help">
            <div className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                healthStatus === 'healthy' ? 'bg-green-400' : healthStatus === 'checking' ? 'bg-yellow-400' : 'bg-red-400'
              }`} />
              <div className={`relative inline-flex rounded-full h-2.5 w-2.5 transition-all duration-300 ${
                healthStatus === 'healthy' 
                  ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)]' 
                  : healthStatus === 'checking' 
                  ? 'bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.8)]' 
                  : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]'
              }`} />
            </div>

            {/* Custom Telemetry Hover Box */}
            <div className="absolute left-full ml-4 top-0 translate-y-0 hidden group-hover:block bg-neutral-900/95 border border-neutral-800 text-neutral-200 p-4 rounded-xl shadow-2xl z-50 w-80 backdrop-blur-md transition-all duration-200 text-left">
              <h3 className="text-sm font-medium border-b border-neutral-800 pb-1.5 mb-2 flex items-center justify-between">
                <span>Network Health State</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${
                  healthStatus === 'healthy' 
                    ? 'bg-green-500/10 text-green-400' 
                    : healthStatus === 'checking' 
                    ? 'bg-yellow-500/10 text-yellow-400' 
                    : 'bg-red-500/10 text-red-400'
                }`}>
                  {healthStatus}
                </span>
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed font-sans">
                {healthStatus === 'healthy' && "All systems running normally. Main gateway server, device message network, and digital twin memory sync are fully operational."}
                {healthStatus === 'checking' && "Synchronizing live system telemetry and reading component states..."}
                {healthStatus === 'mqtt is unhealthy' && "⚠️ Device network connection lost. Recommendation: Check Mosquitto broker service container or try restarting the Raspberry Pi host machine."}
                {healthStatus === 'smart home os is unhealthy' && "❌ Main gateway server returned an unexpected error state (502). Recommendation: Verify docker container stability and check compose stack logs."}
                {healthStatus === 'unhealthy' && "⚠️ Gateway mesh network completely unreachable. Recommendation: Verify local router wireless connectivity or Tailscale VPN service status."}
              </p>
            </div>
          </div>

          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
            className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900 rounded-lg hidden md:block focus:outline-none focus:ring-0 outline-none"
          >
            {isSidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex md:flex-col gap-1 w-full justify-around md:justify-start">
        {navItems.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`group relative flex items-center p-3 md:py-3 w-full rounded-xl active:scale-[0.98] border focus:outline-none focus:ring-0 focus-visible:outline-none outline-none select-none ${
                isSidebarCollapsed ? 'justify-center md:px-3' : 'justify-center md:justify-start md:px-4 gap-3'
              } ${isActive ? 'bg-neutral-900 text-neutral-100 border-neutral-800' : 'bg-transparent text-text-neutral-500 border-transparent text-neutral-500 hover:bg-neutral-900/40 hover:text-neutral-300'}`}
            >
              <Icon size={20} className={isActive ? 'text-blue-400' : ''} />
              <span className={`text-[10px] md:text-sm font-medium ${isSidebarCollapsed ? 'hidden md:hidden' : 'block'}`}>
                {label}
              </span>
              
              {isSidebarCollapsed && (
                <div className="hidden md:block absolute left-full ml-4 px-2.5 py-1.5 bg-neutral-900 text-neutral-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 border border-neutral-800 shadow-xl">
                  {label}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Settings Tab Anchored Natively at Bottom Layer */}
      <div className="md:mt-auto space-y-1 w-full flex md:flex-col justify-end">
        {(() => {
          const isActive = activeTab === 'settings';
          return (
            <button
              onClick={() => setActiveTab('settings')}
              className={`group relative flex items-center p-3 md:py-3 w-full rounded-xl active:scale-[0.98] border focus:outline-none focus:ring-0 focus-visible:outline-none outline-none select-none ${
                isSidebarCollapsed ? 'justify-center md:px-3' : 'justify-center md:justify-start md:px-4 gap-3'
              } ${isActive ? 'bg-neutral-900 text-neutral-100 border-neutral-800' : 'bg-transparent text-text-neutral-500 border-transparent text-neutral-500 hover:bg-neutral-900/40 hover:text-neutral-300'}`}
            >
              <Settings size={20} className={isActive ? 'text-blue-400' : ''} />
              <span className={`text-[10px] md:text-sm font-medium ${isSidebarCollapsed ? 'hidden md:hidden' : 'block'}`}>
                Settings
              </span>
              {isSidebarCollapsed && (
                <div className="hidden md:block absolute left-full ml-4 px-2.5 py-1.5 bg-neutral-900 text-neutral-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 border border-neutral-800 shadow-xl">
                  Settings
                </div>
              )}
            </button>
          );
        })()}
      </div>

    </nav>
  );
}