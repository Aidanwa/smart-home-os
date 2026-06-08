// services/gateway/frontend/src/components/settings/SettingsView.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { HomeSettingsCard } from './HomeSettings';
import { AgentSettings } from './AgentSettings';
import { AccountSettings } from './AccountSettings'; // <-- Import new component

const SpotifyLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-[#1DB954]" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.894-.982-.336.074-.67-.142-.744-.48-.074-.336.143-.67.48-.743 3.856-.88 7.15-.503 9.81 1.128.296.18.387.563.208.86zm1.224-2.724c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.08-1.182-.413.125-.85-.107-.975-.522-.125-.413.107-.85.522-.975 3.678-1.117 8.246-.575 11.346 1.332.366.227.486.707.26 1.075zm.11-2.845C14.452 8.71 8.77 8.52 5.477 9.52c-.53.16-1.09-.14-1.25-.67-.16-.53.14-1.09.67-1.25 3.77-1.14 10.03-.92 14.04 1.46.48.28.64.9.36 1.38-.28.48-.9.64-1.38.36z"/>
  </svg>
);

export function SettingsView() {
  const { authenticatedFetch } = useAuth();
  const [settingsTab, setSettingsTab] = useState<'account' | 'home' | 'agent' | 'connections' | 'admin'>('account'); 

  // Integration states
  const [vaultStatus, setVaultStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [connectedServices, setConnectedServices] = useState<{spotify: boolean, openai: boolean}>({ spotify: false, openai: false });

  // Fetch integration status when opening the connections tab
  useEffect(() => {
    if (settingsTab === 'connections') {
      fetchIntegrationStatus();
    }
  }, [settingsTab]);

  const fetchIntegrationStatus = async () => {
    try {
      const res = await authenticatedFetch('/api/integrations/status');
      const data = await res.json();
      if (data) setConnectedServices(data);
    } catch (err) {
      console.error("Failed to fetch integration status", err);
    }
  };

  // Check for Spotify OAuth callback on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (code) {
      setSettingsTab('connections');
      handleSpotifyCallback(code, state);
    }
  }, []); 

  const handleSpotifyCallback = async (code: string, state: string | null) => {
    setVaultStatus({ type: 'success', message: 'Connecting to Spotify...' });
    try {
      const res = await authenticatedFetch('/api/integrations/spotify/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      });

      if (res.ok) {
        setVaultStatus({ type: 'success', message: 'Spotify linked successfully! Agent is ready to DJ.' });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const data = await res.json();
        setVaultStatus({ type: 'error', message: data.detail || 'Spotify linking failed.' });
      }
    } catch (err) {
      setVaultStatus({ type: 'error', message: 'Network error during Spotify link.' });
    }
  };

  const handleSpotifyLogin = async () => {
    setVaultStatus({ type: 'success', message: 'Requesting secure link from Gateway...' });
    try {
      const res = await authenticatedFetch('/api/integrations/spotify/auth-url');
      const data = await res.json(); 
      if (data && data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        setVaultStatus({ type: 'error', message: 'Gateway did not return a valid auth_url.' });
      }
    } catch (err) {
      setVaultStatus({ type: 'error', message: 'Network error communicating with gateway.' });
    }
  };

  const handleDisconnect = async (provider: string) => {
    setVaultStatus({ type: 'success', message: `Disconnecting ${provider}...` });
    try {
      const res = await authenticatedFetch(`/api/integrations/${provider}`, { method: 'DELETE' });
      if (res.ok || res.status === 200) {
        setVaultStatus({ type: 'success', message: `${provider} successfully disconnected.` });
        fetchIntegrationStatus();
      }
    } catch (err) {
      setVaultStatus({ type: 'error', message: `Failed to disconnect ${provider}.` });
    }
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-4xl w-full">
      <header className="mb-8">
        <h1 className="text-2xl font-medium tracking-tight">System Settings</h1>
        <p className="text-sm text-neutral-500 mt-1">Manage user identity credentials, coordinate external integrations, and access admin consoles.</p>
      </header>

      {/* Sub-tab Navigation Switcher */}
      <div className="flex border-b border-neutral-800 mb-6 gap-6 text-sm font-medium">
        {['account', 'home', 'agent', 'connections', 'admin'].map((tab) => (
          <button 
            key={tab}
            onClick={() => setSettingsTab(tab as any)} 
            className={`pb-3 transition-colors relative capitalize ${settingsTab === tab ? 'text-blue-400 border-b-2 border-blue-400 font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            {tab === 'connections' ? 'External Connections' : `${tab} Setup`}
          </button>
        ))}
      </div>

      {/* Isolated Settings Modules */}
      {settingsTab === 'account' && <AccountSettings />}
      {settingsTab === 'home' && <HomeSettingsCard />}
      {settingsTab === 'agent' && <AgentSettings />}

      {/* Section: Premium External Vault Binding */}
      {settingsTab === 'connections' && (
        <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
          <h2 className="text-base font-medium text-neutral-200">External Cloud Integration Secrets</h2>
          <p className="text-xs text-neutral-500 leading-relaxed">Securely establish identity links with external resource providers to empower your local agentic reasoning capabilities.</p>
          
          {vaultStatus && (
            <div className={`p-3 rounded-lg text-xs ${vaultStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {vaultStatus.message}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-neutral-900 flex items-center justify-center rounded-lg border border-neutral-800">
                  <SpotifyLogo />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-neutral-200">Spotify Music Link</h3>
                    {connectedServices.spotify && (
                      <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-md border border-green-400/20">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Linked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">Allows your home helper agent to automatically command network media playback items.</p>
                </div>
              </div>
              
              {connectedServices.spotify ? (
                <button 
                  onClick={() => handleDisconnect('spotify')}
                  className="text-xs px-3 py-1.5 bg-red-950/40 border border-red-900/50 hover:bg-red-900/40 text-red-400 rounded-lg font-medium transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button 
                  onClick={handleSpotifyLogin}
                  className="text-xs px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded-lg font-medium transition-colors"
                >
                  Link Account
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section: Static Isolation Admin Console */}
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

    </div>
  );
}