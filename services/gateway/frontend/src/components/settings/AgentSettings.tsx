import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Bot, KeyRound, Server } from 'lucide-react';

// Pre-configured models mapping for future expansion
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-5-mini', 'gpt-5.4-mini', 'gpt-5.4-nano'], // Update to your preferred default
  ollama: ['placeholder'], 
  anthropic: ['placeholder'],
  gemini: ['placeholder']
};

export function AgentSettings() {
  const { authenticatedFetch } = useAuth();
  
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-5-mini');
  const [useSystemKey, setUseSystemKey] = useState(true);
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial preferences on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await authenticatedFetch('/api/platform/preferences');
        if (res.ok) {
          const data = await res.json();
          const agentPrefs = data.agent_settings || {};
          
          if (agentPrefs.provider) setProvider(agentPrefs.provider);
          if (agentPrefs.model) setModel(agentPrefs.model);
          if (agentPrefs.use_system_api_key !== undefined) setUseSystemKey(agentPrefs.use_system_api_key);
          
          // Read explicitly from the JSONB data
          if (agentPrefs.has_custom_api_key !== undefined) setHasCustomKey(agentPrefs.has_custom_api_key);
        }
      } catch (err) {
        console.error("Failed to load agent settings:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [authenticatedFetch]);

  // Adjust model automatically if provider changes
  useEffect(() => {
    if (!PROVIDER_MODELS[provider]?.includes(model)) {
      setModel(PROVIDER_MODELS[provider]?.[0] || '');
    }
  }, [provider, model]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    // If using custom key but they didn't type one and don't already have one saved
    if (!useSystemKey && !apiKey && !hasCustomKey) {
      setStatus({ type: 'error', message: 'You must provide a custom API key.' });
      return;
    }

    // Determine if we will have a custom key on file after this save
    const willHaveCustomKey = apiKey.trim().length > 0 ? true : hasCustomKey;

    try {
      // 1. Update unstructured agent preferences
      const prefRes = await authenticatedFetch('/api/platform/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_settings: {
            provider,
            model,
            use_system_api_key: useSystemKey,
            has_custom_api_key: willHaveCustomKey // Explicitly save to database JSONB
          }
        })
      });

      if (!prefRes.ok) {
        const errData = await prefRes.json();
        throw new Error(errData.detail || 'Failed to save agent preferences.');
      }

      // 2. If a new API key was typed, save it to the secure vault
      if (apiKey) {
        const secretRes = await authenticatedFetch('/api/platform/secrets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider,
            credentials: apiKey
          })
        });

        if (!secretRes.ok) {
           const errData = await secretRes.json();
           throw new Error(errData.detail || 'Failed to securely vault API key.');
        }
      }

      // Success State
      setStatus({ type: 'success', message: 'Agent configuration successfully synced.' });
      setApiKey(''); // Clear the input field for security
      setHasCustomKey(willHaveCustomKey); // Update local state indicator
      setTimeout(() => setStatus(null), 3000);

    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Network error while saving configurations.' });
    }
  };

  if (isLoading) return <div className="animate-pulse h-32 bg-neutral-900/40 rounded-xl" />;

  return (
    <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-medium text-neutral-200 flex items-center gap-2">
          <Bot size={18} className="text-blue-400" />
          LLM Orchestrator Config
        </h2>
        <p className="text-xs text-neutral-500 mt-1">Configure the "brain" of your Smart Home OS.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider">AI Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600 transition-colors"
            >
              <option value="openai">OpenAI (Cloud)</option>
              <option value="anthropic" disabled>Anthropic (Coming Soon)</option>
              <option value="ollama" disabled>Ollama (Local - Coming Soon)</option>
            </select>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Target Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600 transition-colors"
            >
              {PROVIDER_MODELS[provider]?.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Authentication Context Section */}
        <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center">
              <Server size={14} className="text-neutral-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-neutral-200">System API Key</h3>
              <p className="text-xs text-neutral-500">Use the ambient `.env` key configured by the server administrator.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer" 
                checked={useSystemKey}
                onChange={() => setUseSystemKey(!useSystemKey)}
              />
              <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>
            <div className="pt-4 border-t border-neutral-800/50 animate-in slide-in-from-top-2">
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <KeyRound size={12} /> Personal Secret Key
                {hasCustomKey && !useSystemKey && <span className="text-green-400 ml-auto flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-400 rounded-full"/> Key Saved</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasCustomKey && !useSystemKey ? "••••••••••••••••••••••••" : "sk-proj-..."}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-neutral-200 focus:outline-none focus:border-neutral-600 transition-colors disabled:opacity-50"
                disabled={useSystemKey}
              />
              <p className="text-[10px] text-neutral-500 mt-1.5">This secret is stored securely in your individual PostgreSQL vault space.</p>
            </div>
        </div>

        {status && (
          <div className={`p-3 rounded-lg text-xs ${status.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {status.message}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99]">
            Save Orchestrator Context
          </button>
        </div>
      </form>
    </div>
  );
}