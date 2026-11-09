import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Bot, KeyRound, Server } from 'lucide-react';
import { toast } from 'sonner';
import { request } from '../../lib/api';

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
  
  const [saving, setSaving] = useState(false);
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

    // Using your own key, but none typed and none saved yet
    if (!useSystemKey && !apiKey.trim() && !hasCustomKey) {
      toast.error('Enter your API key first.', { description: 'Or turn “Use the hub’s API key” back on.' });
      return;
    }

    // Whether a custom key will be on file after this save
    const willHaveCustomKey = apiKey.trim().length > 0 ? true : hasCustomKey;

    setSaving(true);
    try {
      // 1. A newly typed key goes to the encrypted vault first, so the
      //    preferences never point at a key that failed to save.
      if (apiKey.trim()) {
        const ok = await request('save your API key', () => authenticatedFetch('/api/platform/secrets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, credentials: apiKey.trim() }),
        }));
        if (!ok) return;
      }

      // 2. The agent preferences
      const ok = await request('save the assistant settings', () => authenticatedFetch('/api/platform/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_settings: {
            provider,
            model,
            use_system_api_key: useSystemKey,
            has_custom_api_key: willHaveCustomKey,
          }
        })
      }));
      if (!ok) return;

      toast.success('Assistant settings saved');
      setApiKey(''); // Clear the input field for security
      setHasCustomKey(willHaveCustomKey);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="animate-pulse h-32 bg-neutral-900/40 rounded-xl" />;

  return (
    <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-medium text-neutral-200 flex items-center gap-2">
          <Bot size={18} className="text-blue-400" />
          Assistant
        </h2>
        <p className="text-xs text-neutral-500 mt-1">The AI model behind the Agent tab and “Ask the agent” routines.</p>
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
              <option value="openai">OpenAI</option>
            </select>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Model</label>
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
              <h3 className="text-sm font-medium text-neutral-200">Use the hub’s API key</h3>
              <p className="text-xs text-neutral-500">The key set up on the hub. Turn off to use your own.</p>
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
          {!useSystemKey && (
            <div className="pt-4 border-t border-neutral-800/50 animate-in slide-in-from-top-2">
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <KeyRound size={12} /> Your API key
                {hasCustomKey && <span className="text-green-400 ml-auto flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-400 rounded-full"/> Key saved</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasCustomKey ? "Saved. Type a new key to replace it." : "sk-proj-..."}
                autoComplete="off"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 text-sm font-mono text-neutral-200 focus:outline-none focus:border-neutral-600 transition-colors"
              />
              <p className="text-[10px] text-neutral-500 mt-1.5">Stored encrypted on the hub and used only for your account.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium rounded-lg transition-colors active:scale-[0.99] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}