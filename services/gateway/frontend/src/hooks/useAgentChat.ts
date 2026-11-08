// services/gateway/frontend/src/hooks/useAgentChat.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { openReconnectingSocket } from '../lib/reconnectingSocket';
import type { ReconnectingSocket } from '../lib/reconnectingSocket';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system' | 'tool';
  isStreaming?: boolean;
  toolName?: string;
  toolArgs?: string;
  status?: 'pending' | 'completed';
}

// 1008: the agent refused the session (its auth error message was already shown);
// 1011: its configuration is broken (e.g. no API key). Retrying can't fix either; the user
// gets a fresh attempt by reopening the Agent tab.
const retryable = (code: number) => code !== 1008 && code !== 1011;

export function useAgentChat() {
  // Pruned userId argument: Account parameters are natively resolved via signed ambient tracking cookies
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
  const sockRef = useRef<ReconnectingSocket | null>(null);

  useEffect(() => {
    let sock: ReconnectingSocket | null = null;
    let isMounted = true;

    const initializeChat = async () => {
      // Fetch the conversation history directly from the Agent container
      try {
        const res = await authenticatedFetch(`/api/agent/chat/history`);
        if (res.ok) {
          const data = await res.json();
          const historicalMessages: ChatMessage[] = data.messages
            .map((m: any, index: number) => {
              // Gracefully handle alternate property strings from different API variations
              const isToolCall = m.type === 'function_call' || m.type === 'tool_call';
              return {
                id: `hist-${Date.now()}-${index}`,
                text: m.content || '',
                sender: isToolCall ? 'tool' : (m.role === 'user' ? 'user' : 'agent'),
                toolName: m.name || m.tool_name,
                toolArgs: m.arguments || m.tool_args,
                isStreaming: false,
                status: 'completed'
              };
            })
            .filter((m: ChatMessage) => m.sender === 'tool' || (m.text && m.text.trim() !== ''));

          if (isMounted) setMessages(historicalMessages);
        }
      } catch (err) {
        console.error("Failed to safely load chat history:", err);
      }

      // 2. Open the socket; it reconnects on its own (agent restarts, phone sleep).
      if (!isMounted) return;
      sock = openReconnectingSocket('/api/agent/chat/stream', {
        onOpen: () => {
          if (!isMounted) return;
          setIsConnected(true);
          setGaveUp(false);
        },
        onClose: (code) => {
          if (!isMounted) return;
          setIsConnected(false);
          setGaveUp(!retryable(code));
          // A reply in flight is lost with the socket; say so instead of leaving a spinner.
          if (streamingRef.current) {
            setIsStreaming(false);
            setMessages(prev => [
              ...prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m)),
              { id: Date.now().toString(), text: 'Lost the connection to the agent, so that reply may be cut off.', sender: 'system' },
            ]);
          }
        },
        shouldRetry: retryable,
        onMessage: handleMessage,
      });
      sockRef.current = sock;
    };

    const handleMessage = (data: string) => {
        if (!isMounted) return;

        if (data === '[DONE]') {
          setIsStreaming(false);
          setMessages(prev => {
             const last = prev[prev.length - 1];
             if (last && last.sender === 'agent') {
               return [...prev.slice(0, -1), { ...last, isStreaming: false }];
             }
             return prev;
          });
          return;
        }

        // The agent prefixes these with "\n", so trim before matching.
        const trimmed = data.trimStart();
        if (/^\[(System|Auth|Configuration) Error:/.test(trimmed)) {
           setMessages(prev => [...prev, { id: Date.now().toString(), text: trimmed, sender: 'system' }]);
           setIsStreaming(false);
           return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'tool_call') {
            setMessages(prev => {
              if (parsed.status === 'completed') {
                const newMessages = [...prev];
                for (let i = newMessages.length - 1; i >= 0; i--) {
                  if (
                    newMessages[i].sender === 'tool' && 
                    newMessages[i].toolName === parsed.name && 
                    newMessages[i].status === 'pending'
                  ) {
                    newMessages[i] = { ...newMessages[i], status: 'completed' };
                    break;
                  }
                }
                return newMessages;
              } else {
                return [
                  ...prev, 
                  { 
                    id: Date.now().toString(), 
                    text: '', 
                    sender: 'tool', 
                    toolName: parsed.name, 
                    toolArgs: parsed.arguments,
                    status: 'pending'
                  }
                ];
              }
            });
            return; 
          }
        } catch (e) {
            // Context payload is non-JSON stream chunking text. Fall through.
        }

        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.sender === 'agent' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + data }];
          } else {
            return [...prev, { id: Date.now().toString(), text: data, sender: 'agent', isStreaming: true }];
          }
        });
    };

    const initializeAgent = async () => {
      try {
        await authenticatedFetch('/api/agent/chat/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error("Failed to initialize agent session:", error);
      }
    };

    initializeChat();
    initializeAgent();

    return () => {
      isMounted = false;
      sock?.close();
      sockRef.current = null;
    };
  }, [authenticatedFetch]);

  const sendMessage = useCallback((text: string) => {
    if (sockRef.current?.send(text)) {
      setMessages(prev => [...prev, { id: Date.now().toString(), text, sender: 'user' }]);
      setIsStreaming(true);
    }
  }, []);

  const DeleteHistory = useCallback(async () => {
    if (!streamingRef.current) {  // plain REST call; doesn't need the socket
      try {
        const res = await authenticatedFetch(`/api/agent/chat/history`, { method: 'DELETE' });
        if (res.ok) {
          setMessages([]);
        } else {
          console.error("Failed to delete chat history:", res.statusText);
        }
      }
      catch (err) {
        console.error("Failed to safely delete chat history:", err);
      }
    }
  }, []);

  return { messages, isConnected, gaveUp, isStreaming, sendMessage, DeleteHistory };
}