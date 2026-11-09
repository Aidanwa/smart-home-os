// services/gateway/frontend/src/hooks/useAgentChat.ts
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { openReconnectingSocket } from '../lib/reconnectingSocket';
import type { ReconnectingSocket } from '../lib/reconnectingSocket';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system' | 'tool';
  isStreaming?: boolean;
  /** The reply was cut short with Stop. */
  stopped?: boolean;
  /** A stand-in while a reply from an earlier visit is still being worked on. */
  placeholder?: boolean;
  toolName?: string;
  toolArgs?: string;
  callId?: string;
  status?: 'pending' | 'completed';
  /** For completed tool calls: did it work, and if not, why. */
  ok?: boolean;
  error?: string | null;
}

// 1008: the agent refused the session (its auth error message was already shown);
// 1011: its configuration is broken (e.g. no API key). Retrying can't fix either; the user
// gets a fresh attempt by reopening the Agent tab.
const retryable = (code: number) => code !== 1008 && code !== 1011;

/** Sent to the agent to cancel the reply in progress (see services/agent/api/routes.py). */
const STOP_MESSAGE = '[STOP]';

let seq = 0;
const newId = () => `m${Date.now()}-${seq++}`;

interface HistoryItem {
  role?: string;
  type?: string;
  content?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  ok?: boolean;
  error?: string | null;
}

function fromHistory(items: HistoryItem[]): ChatMessage[] {
  return items
    .map((m): ChatMessage => {
      const isToolCall = m.type === 'function_call' || m.type === 'tool_call';
      return {
        id: newId(),
        text: m.content || '',
        sender: isToolCall ? 'tool' : (m.role === 'user' ? 'user' : 'agent'),
        toolName: m.name,
        toolArgs: m.arguments,
        callId: m.call_id,
        status: 'completed',
        ok: m.ok,
        error: m.error,
      };
    })
    .filter(m => m.sender === 'tool' || m.text.trim() !== '');
}

/**
 * The assistant chat. It lives above the tabs (see AgentChatProvider), so a reply keeps
 * arriving while you look at another tab. It connects the first time `enabled` is true and
 * stays connected after that. `visible` says whether the Agent tab is showing, for `unread`.
 */
function useAgentChatState(enabled: boolean, visible: boolean) {
  const { authenticatedFetch } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreamingState] = useState(false);
  const streamingRef = useRef(false);  // readable from socket callbacks without a stale closure
  const setIsStreaming = (v: boolean) => {
    streamingRef.current = v;
    setIsStreamingState(v);
  };
  const [gaveUp, setGaveUp] = useState(false);  // stopped retrying (see retryable)
  const [unread, setUnread] = useState(false);
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  const sockRef = useRef<ReconnectingSocket | null>(null);

  // Opening the tab counts as reading it.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setUnread(false);
  }

  useEffect(() => {
    if (!enabled) return;
    let sock: ReconnectingSocket | null = null;
    let isMounted = true;

    const replyFinished = () => {
      if (!visibleRef.current) setUnread(true);
    };

    const loadHistory = async () => {
      try {
        const res = await authenticatedFetch(`/api/agent/chat/history`);
        if (res.ok && isMounted) {
          const data = await res.json();
          setMessages(fromHistory(data.messages ?? []));
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    };

    const handleMessage = (data: string) => {
      if (!isMounted) return;

      if (data === '[DONE]') {
        setIsStreaming(false);
        setMessages(prev => prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m)));
        replyFinished();
        return;
      }

      // The agent prefixes these with "\n", so trim before matching.
      const trimmed = data.trimStart();
      if (/^\[(System|Auth|Configuration) Error:/.test(trimmed)) {
        setMessages(prev => [...prev, { id: newId(), text: trimmed, sender: 'system' }]);
        setIsStreaming(false);
        return;
      }

      if (trimmed.startsWith('{')) {
        let parsed: { type?: string; [k: string]: unknown } | null = null;
        try { parsed = JSON.parse(data); } catch { /* plain text that starts with { */ }
        if (parsed && typeof parsed.type === 'string') {
          const p = parsed as Record<string, unknown>;
          switch (parsed.type) {
            case 'tool_call': {
              if (p.status === 'completed') {
                setMessages(prev => {
                  const next = [...prev];
                  for (let i = next.length - 1; i >= 0; i--) {
                    const m = next[i];
                    const same = p.call_id ? m.callId === p.call_id : m.toolName === p.name;
                    if (m.sender === 'tool' && m.status === 'pending' && same) {
                      next[i] = { ...m, status: 'completed', ok: p.ok as boolean | undefined, error: p.error as string | null | undefined };
                      break;
                    }
                  }
                  return next;
                });
              } else {
                setMessages(prev => [
                  // Text before a tool call is finished; the next text starts a new bubble.
                  ...prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m)),
                  { id: newId(), text: '', sender: 'tool', toolName: p.name as string, toolArgs: p.arguments as string, callId: p.call_id as string | undefined, status: 'pending' },
                ]);
              }
              return;
            }
            case 'stopped':
              setMessages(prev => {
                const next = prev.map(m => (m.sender === 'tool' && m.status === 'pending'
                  ? { ...m, status: 'completed' as const, ok: false, error: 'Stopped before it finished' } : m));
                const last = next[next.length - 1];
                if (last?.sender === 'agent' && last.isStreaming) {
                  next[next.length - 1] = { ...last, isStreaming: false, stopped: true };
                  return next;
                }
                return [...next, { id: newId(), text: '', sender: 'agent', stopped: true }];
              });
              return;
            case 'run_active':
              // A reply from an earlier visit is still being worked on; it lands in the history.
              setIsStreaming(true);
              setMessages(prev => [...prev, { id: newId(), text: '', sender: 'agent', isStreaming: true, placeholder: true }]);
              return;
            case 'run_done':
              setIsStreaming(false);
              loadHistory();
              replyFinished();
              return;
            case 'busy':
              setMessages(prev => [...prev, { id: newId(), text: 'Still working on the last message. Wait for it, or press Stop.', sender: 'system' }]);
              return;
          }
        }
      }

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.sender === 'agent' && last.isStreaming && !last.placeholder) {
          return [...prev.slice(0, -1), { ...last, text: last.text + data }];
        }
        return [...prev, { id: newId(), text: data, sender: 'agent', isStreaming: true }];
      });
    };

    (async () => {
      await loadHistory();
      if (!isMounted) return;
      // The socket reconnects on its own (agent restarts, phone sleep).
      sock = openReconnectingSocket('/api/agent/chat/stream', {
        onOpen: (reconnected) => {
          if (!isMounted) return;
          setIsConnected(true);
          setGaveUp(false);
          // The agent finishes replies even with nobody connected, so catch up on what we missed.
          if (reconnected) loadHistory();
        },
        onClose: (code) => {
          if (!isMounted) return;
          setIsConnected(false);
          setGaveUp(!retryable(code));
          if (streamingRef.current) {
            setIsStreaming(false);
            setMessages(prev => [
              ...prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m)),
              { id: newId(), text: 'Lost the connection. The assistant keeps working, and its reply will appear here once you’re reconnected.', sender: 'system' },
            ]);
          }
        },
        shouldRetry: retryable,
        onMessage: handleMessage,
      });
      sockRef.current = sock;
    })();

    // Warms the agent's caches so the first reply is quick.
    authenticatedFetch('/api/agent/chat/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .catch((error) => console.error('Failed to initialize agent session:', error));

    return () => {
      isMounted = false;
      sock?.close();
      sockRef.current = null;
    };
  }, [enabled, authenticatedFetch]);

  const sendMessage = useCallback((text: string) => {
    if (streamingRef.current) return false;
    if (sockRef.current?.send(text)) {
      setMessages(prev => [...prev, { id: newId(), text, sender: 'user' }]);
      setIsStreaming(true);
      return true;
    }
    return false;
  }, []);

  const stop = useCallback(() => {
    if (streamingRef.current) sockRef.current?.send(STOP_MESSAGE);
  }, []);

  const DeleteHistory = useCallback(async () => {
    if (streamingRef.current) return;  // plain REST call; doesn't need the socket
    try {
      const res = await authenticatedFetch(`/api/agent/chat/history`, { method: 'DELETE' });
      if (res.ok) setMessages([]);
      else console.error('Failed to delete chat history:', res.statusText);
    } catch (err) {
      console.error('Failed to delete chat history:', err);
    }
  }, [authenticatedFetch]);

  return { messages, isConnected, gaveUp, isStreaming, unread, sendMessage, stop, DeleteHistory };
}

type AgentChatState = ReturnType<typeof useAgentChatState>;
const AgentChatContext = createContext<AgentChatState | null>(null);

/** Holds the chat for the whole dashboard. Connects once the Agent tab has been opened. */
export function AgentChatProvider({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [enabled, setEnabled] = useState(visible);
  if (visible && !enabled) setEnabled(true);
  const state = useAgentChatState(enabled, visible);
  return createElement(AgentChatContext.Provider, { value: state }, children);
}

export function useAgentChat(): AgentChatState {
  const ctx = useContext(AgentChatContext);
  if (!ctx) throw new Error('useAgentChat must be used inside AgentChatProvider');
  return ctx;
}
