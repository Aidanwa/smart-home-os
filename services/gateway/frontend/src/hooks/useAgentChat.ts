// services/gateway/frontend/src/hooks/useAgentChat.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system' | 'tool';
  isStreaming?: boolean;
  toolName?: string;
  toolArgs?: string;
  status?: 'pending' | 'completed';
}

export function useAgentChat() {
  // Pruned userId argument: Account parameters are natively resolved via signed ambient tracking cookies
  const { authenticatedFetch } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
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

      // 2. Open the WebSocket connection utilizing ambient cookie propagation
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/agent/chat/stream`;
      
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) setIsConnected(true);
      };
      
      ws.onclose = () => {
        if (isMounted) setIsConnected(false);
      };
      
      ws.onmessage = (event) => {
        if (!isMounted) return;
        const data = event.data;
        
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

        if (data.startsWith('[System Error:') || data.startsWith('[Auth Error:')) {
           setMessages(prev => [...prev, { id: Date.now().toString(), text: data, sender: 'system' }]);
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
    };

    initializeChat();

    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, [authenticatedFetch]); // Monitored stable dependencies safely tracking environment shifts

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setMessages(prev => [...prev, { id: Date.now().toString(), text, sender: 'user' }]);
      setIsStreaming(true);
      wsRef.current.send(text);
    }
  }, []);

  const DeleteHistory = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !isStreaming) {
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

  return { messages, isConnected, isStreaming, sendMessage, DeleteHistory };
}