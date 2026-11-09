import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../lib/api';

/** Past this many, the facts start to weigh on every message's cost and the assistant's focus. */
const MANY_FACTS = 30;
const MAX_FACT_LENGTH = 300;

/** The assistant's saved facts (agent_settings.user_memory), shown and edited by hand. */
export function MemorySettings() {
  const { authenticatedFetch } = useAuth();
  const [facts, setFacts] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // What the server had when we last read or wrote it. If the assistant changes the list in
  // the meantime, saving would overwrite its change, so we reload instead.
  const baseline = useRef<string[]>([]);

  const fetchFacts = useCallback(async (): Promise<string[] | null> => {
    try {
      const res = await authenticatedFetch('/api/platform/preferences');
      if (!res.ok) return null;
      const data = await res.json();
      const raw = data?.agent_settings?.user_memory;
      if (Array.isArray(raw)) return raw.filter((f: unknown): f is string => typeof f === 'string');
      return typeof raw === 'string' && raw ? [raw] : [];
    } catch {
      return null;
    }
  }, [authenticatedFetch]);

  useEffect(() => {
    let cancelled = false;
    fetchFacts().then(list => {
      if (cancelled) return;
      if (list === null) { setLoadFailed(true); return; }
      baseline.current = list;
      setFacts(list);
    });
    return () => { cancelled = true; };
  }, [fetchFacts]);

  /** Save the whole list. Returns false (and shows the latest) if it changed on the server. */
  const save = async (next: string[], success?: string, undo?: () => void): Promise<boolean> => {
    setSaving(true);
    try {
      const current = await fetchFacts();
      if (current === null) {
        toast.error('Couldn’t save the change', { description: 'Can’t reach the hub. Check your connection.' });
        return false;
      }
      if (JSON.stringify(current) !== JSON.stringify(baseline.current)) {
        baseline.current = current;
        setFacts(current);
        setEditing(null);
        toast.info('The assistant changed its memory while you were editing', { description: 'Here’s the latest list. Make your change again.' });
        return false;
      }
      const ok = await request('save the change', () => authenticatedFetch('/api/platform/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_settings: { user_memory: next } }),
      }));
      if (!ok) return false;
      baseline.current = next;
      setFacts(next);
      if (success) toast.success(success, undo ? { action: { label: 'Undo', onClick: undo } } : undefined);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const remove = (index: number) => {
    if (!facts) return;
    const removed = facts[index];
    const next = facts.filter((_, i) => i !== index);
    // Undo puts it back where it was, against whatever the list is by then.
    save(next, 'Forgotten', () => {
      const now = baseline.current;
      save([...now.slice(0, index), removed, ...now.slice(index)], 'Restored');
    });
  };

  const commitEdit = async () => {
    if (!facts || !editing) return;
    const text = editing.text.trim();
    if (!text) return;
    if (text === facts[editing.index]) { setEditing(null); return; }
    if (await save(facts.map((f, i) => (i === editing.index ? text : f)), 'Updated')) setEditing(null);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!facts || !text) return;
    if (await save([...facts, text], 'Added')) setDraft('');
  };

  return (
    <div className="bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-5">
      <div>
        <h2 className="text-base font-medium text-neutral-200 flex items-center gap-2">
          <Brain size={18} className="text-blue-400" />
          What the assistant remembers
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          Facts it saved about you and your home. All of them are sent with every message, so a short list works best.
        </p>
      </div>

      {loadFailed ? (
        <p className="text-sm text-red-400">Couldn’t load the saved facts. Check your connection and reopen this page.</p>
      ) : facts === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-neutral-800/50 animate-pulse" />)}
        </div>
      ) : (
        <>
          <p className={`text-xs ${facts.length > MANY_FACTS ? 'text-amber-400' : 'text-neutral-500'}`}>
            {facts.length === 0 ? 'Nothing saved yet. It saves things when you ask it to remember them, or you can add one below.'
              : `${facts.length} fact${facts.length === 1 ? '' : 's'}`}
            {facts.length > MANY_FACTS && ' · That’s a lot. Removing ones you don’t need keeps replies quick and cheap.'}
          </p>

          {facts.length > 0 && (
            <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-lg">
              {facts.map((fact, i) => (
                <li key={`${i}-${fact}`} className="flex items-start gap-2 p-2.5">
                  {editing?.index === i ? (
                    <form className="flex-1 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); commitEdit(); }}>
                      <input
                        autoFocus
                        value={editing.text}
                        maxLength={MAX_FACT_LENGTH}
                        onChange={(e) => setEditing({ index: i, text: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
                        aria-label="Edit fact"
                        className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded-md px-2.5 py-1.5 text-base sm:text-sm text-neutral-100 focus:outline-none focus:border-blue-500"
                      />
                      <button type="submit" disabled={saving || !editing.text.trim()} aria-label="Save"
                        className="p-2 rounded-md bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50"><Check size={16} /></button>
                      <button type="button" onClick={() => setEditing(null)} aria-label="Cancel"
                        className="p-2 rounded-md bg-neutral-800 text-neutral-400 hover:bg-neutral-700"><X size={16} /></button>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 text-sm text-neutral-200 py-1.5 break-words">{fact}</span>
                      <button type="button" onClick={() => setEditing({ index: i, text: fact })} disabled={saving} aria-label={`Edit “${fact}”`}
                        className="p-2 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"><Pencil size={15} /></button>
                      <button type="button" onClick={() => remove(i)} disabled={saving} aria-label={`Forget “${fact}”`}
                        className="p-2 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50"><Trash2 size={15} /></button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} className="flex items-center gap-2">
            <input
              value={draft}
              maxLength={MAX_FACT_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. I go to bed around 11pm on weeknights"
              aria-label="New fact"
              className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-base sm:text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
            />
            <button type="submit" disabled={saving || !draft.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium disabled:opacity-50">
              <Plus size={15} /> Add
            </button>
          </form>
        </>
      )}
    </div>
  );
}
