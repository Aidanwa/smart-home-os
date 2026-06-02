import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system' | 'tool';
  isStreaming?: boolean;
  toolName?: string;
  toolArgs?: string;
  status?: 'pending' | 'completed';
}

export function useAgentChat(userId: string = 'admin') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true; // Prevents state updates if component unmounts quickly

    const initializeChat = async () => {
      // 1. Get current protocol and hostname, ignoring whatever port the UI is on
      const httpProtocol = window.location.protocol; // 'http:' or 'https:'
      const hostname = window.location.hostname;

      // 2. Fetch the conversation history directly from the Agent container
      try {
        const res = await fetch(`${httpProtocol}//${hostname}:8001/api/agent/chat/history/${userId}`);
        if (res.ok) {
          const data = await res.json();
          const historicalMessages: ChatMessage[] = data.messages
            .map((m: any, index: number) => {
              const isToolCall = m.type === 'function_call';
              return {
                id: `hist-${Date.now()}-${index}`,
                text: m.content || '',
                sender: isToolCall ? 'tool' : (m.role === 'user' ? 'user' : 'agent'),
                toolName: m.name,
                toolArgs: m.arguments,
                isStreaming: false,
                status: 'completed'
              };
            })
            .filter((m: ChatMessage) => m.sender === 'tool' || m.text.trim() !== '');

          if (isMounted) setMessages(historicalMessages);
        }
      } catch (err) {
        console.error("Failed to load chat history:", err);
      }

      // 3. Open the WebSocket connection AFTER history is loaded
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/agent/chat/stream`;
      
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => setIsConnected(false);
      
      ws.onmessage = (event) => {
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

        if (data.startsWith('[System Error:')) {
           setMessages(prev => [...prev, { id: Date.now().toString(), text: data, sender: 'system' }]);
           setIsStreaming(false);
           return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'tool_call') {
            setMessages(prev => {
              // If it's completed, find the existing pending chip and update it
              if (parsed.status === 'completed') {
                const newMessages = [...prev];
                // Search backwards to find the most recent matching pending tool
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
              } 
              // Otherwise, it's a new pending tool call, append it!
              else {
                return [
                  ...prev, 
                  { 
                    id: Date.now().toString(), 
                    text: '', 
                    sender: 'tool', 
                    toolName: parsed.name, 
                    toolArgs: parsed.arguments,
                    status: 'pending' // <-- Attach the status
                  }
                ];
              }
            });
            return; 
          }
        } catch (e) {
           // Not JSON, continue to normal text streaming...
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

    // Fire the initialization sequence
    initializeChat();

    // Cleanup function when the component unmounts
    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, [userId]);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Instantly add the user's message to the UI
      setMessages(prev => [...prev, { id: Date.now().toString(), text, sender: 'user' }]);
      setIsStreaming(true);
      
      // Send raw text to the backend orchestrator
      wsRef.current.send(text);
    }
  }, []);

  return { messages, isConnected, isStreaming, sendMessage };
}