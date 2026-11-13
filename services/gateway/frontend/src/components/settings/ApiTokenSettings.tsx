import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../lib/api';
import { ConfirmDialog } from '../ui/dialog';

/** Personal API tokens (api/token_routes.py) for things that can't sign in with the browser, such
 *  as the "Ask the house" iPhone Shortcut (docs/iphone-shortcuts.md). A token acts as you, with
 *  full access except account changes and managing tokens; it's shown once, then only its prefix. */

interface Token { id: string; name: string; prefix: string; created_at: string | null; last_used_at: string | null }

function since(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ApiTokenSettings() {
  const { authenticatedFetch } = useAuth();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);

  const fetchTokens = useCallback(async (): Promise<Token[] | null> => {
    try {
      const res = await authenticatedFetch('/api/tokens');
      return res.ok ? await res.json() as Token[] : null;
    } catch {
      toast.error('Couldn’t load API tokens', { description: 'Can’t reach the hub. Check your connection.' });
      return null;
    }
  }, [authenticatedFetch]);
  const load = () => fetchTokens().then(t => { if (t) setTokens(t); });

  useEffect(() => {
    let cancelled = false;
    fetchTokens().then(t => { if (t && !cancelled) setTokens(t); });
    return () => { cancelled = true; };
  }, [fetchTokens]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    let res: Response | undefined;
    const ok = await request('create the token', async () => (res = await authenticatedFetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n }),
    })));
    if (ok && res) {
      const data = await res.json();
      setCreated({ name: data.name, token: data.token });
      setCopied(false);
      setName('');
    }
    setCreating(false);
    load();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      toast.error('Couldn’t copy', { description: 'Select the token and copy it by hand.' });
    }
  };

  // Throwing keeps the confirm dialog open after a failure (the toast says why).
  const revoke = async () => {
    if (!revoking) return;
    const ok = await request('revoke the token', () => authenticatedFetch(`/api/tokens/${revoking.id}`, { method: 'DELETE' }));
    if (!ok) throw new Error('not revoked');
    toast.success(`Revoked “${revoking.name}”`);
    load();
  };

  const btn = 'flex items-center justify-center gap-1.5 text-sm px-4 min-h-11 rounded-lg font-medium transition-colors shrink-0 disabled:opacity-50';

  return (
    <section className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-medium text-neutral-200">API tokens</h2>
        <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
          For iPhone Shortcuts (“Hey Siri, ask the house”) and other apps that can’t sign in. A token can do anything you can,
          except change your account or make more tokens. Revoke one you no longer use.
        </p>
      </div>

      <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); create(); }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Name, e.g. iPhone Shortcuts"
          aria-label="Token name"
          className="flex-1 min-w-0 min-h-11 bg-neutral-950 border border-neutral-800 rounded-lg px-3 text-base sm:text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500" />
        <button type="submit" disabled={creating || !name.trim()} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create token
        </button>
      </form>

      {created && (
        <div className="p-3 bg-blue-950/30 border border-blue-900/50 rounded-xl space-y-2">
          <p className="text-sm text-neutral-200">Copy “{created.name}” now. It won’t be shown again.</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 min-w-0 break-all select-all text-xs text-blue-200 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5">{created.token}</code>
            <button type="button" onClick={copy} aria-label="Copy token"
              className={`${btn} px-3 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200`}>
              {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
            </button>
          </div>
          <button type="button" onClick={() => setCreated(null)} className="text-xs text-neutral-400 hover:text-neutral-200 min-h-11">Done</button>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map(t => (
            <li key={t.id} className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800/80 rounded-xl">
              <KeyRound size={18} className="text-neutral-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-neutral-200 truncate">{t.name}</p>
                <p className="text-xs text-neutral-500 truncate">{t.prefix}… · added {since(t.created_at)} · last used {since(t.last_used_at)}</p>
              </div>
              <button type="button" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.name}`}
                className="size-11 flex items-center justify-center rounded-lg text-neutral-500 hover:text-red-400 hover:bg-neutral-800/60 shrink-0">
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={o => { if (!o) setRevoking(null); }}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        description="Anything using this token (a Shortcut, an automation) stops working at once."
        confirmLabel="Revoke"
        busyLabel="Revoking…"
        destructive
        onConfirm={revoke}
      />
    </section>
  );
}
