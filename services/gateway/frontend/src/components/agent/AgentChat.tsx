import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, AlertCircle, Trash } from 'lucide-react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { ToolCallChip } from './ToolCallChip';

export const AgentChat: React.FC = () => {
  const { messages, isConnected, isStreaming, sendMessage, DeleteHistory } = useAgentChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming || !isConnected) return;
    
    sendMessage(input);
    setInput('');
  };

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming || !isConnected) return; 
    DeleteHistory();
  };

  return (
    <div className="flex flex-col w-full h-[calc(100dvh-6rem)] md:h-[calc(100vh-8rem)] min-h-[400px] bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden shadow-lg animate-in fade-in text-neutral-200">      
      {/* Header */}
      <div className="p-4 border-b border-neutral-800 flex justify-between items-center bg-neutral-950 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="text-blue-400" size={20} />
          <h2 className="font-medium text-neutral-100">Smart Home Agent</h2>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="relative flex h-2.5 w-2.5">
            {isConnected && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          </span>
          <span className="text-neutral-400">{isConnected ? 'Online' : 'Disconnected'}</span>
        </div>
      </div>

      {/* Messages Viewport */}
      <div className="flex-1 overflow-y-auto p-4 bg-neutral-900 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 gap-3">
            <Bot size={48} className="opacity-20" />
            <p>How can I orchestrate your home today?</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              if (msg.sender === 'tool') {
                return (
                  <ToolCallChip 
                    key={msg.id} 
                    name={msg.toolName || 'Unknown Tool'} 
                    args={msg.toolArgs} 
                    status={msg.status}
                  />
                );
              }

              return (
                <div key={msg.id} className={`flex gap-3 max-w-[85%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                      msg.sender === 'user' ? 'bg-blue-900/40 text-blue-400' : 
                      msg.sender === 'system' ? 'bg-red-900/30 text-red-400' : 'bg-neutral-800 text-neutral-400'
                  }`}>
                      {msg.sender === 'user' ? <User size={16} /> : msg.sender === 'system' ? <AlertCircle size={16} /> : <Bot size={16} />}
                  </div>

                  {/* Message Bubble */}
                  <div className={`p-3 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed ${
                      msg.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 
                      msg.sender === 'system' ? 'bg-red-950/50 text-red-400 border border-red-900/50 rounded-tl-none' : 
                      'bg-neutral-800 text-neutral-200 rounded-tl-none'
                  }`}>
                      {msg.text}
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-4 ml-1 bg-neutral-500 animate-pulse align-middle"></span>
                      )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-neutral-950 border-t border-neutral-800 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          
          {/* Input & Inner Send Button Wrapper */}
          <div className="relative flex-1 flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isConnected ? "Message your home agent..." : "Reconnecting..."}
              disabled={!isConnected || isStreaming}
              className="w-full bg-neutral-800 border border-transparent focus:border-neutral-700 rounded-full pl-5 pr-12 py-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50 transition-all text-neutral-100 placeholder:text-neutral-500"
            />
            <button 
              type="submit" 
              disabled={!input.trim() || !isConnected || isStreaming}
              className="absolute right-2 p-2 rounded-full bg-blue-600 text-white disabled:opacity-50 disabled:bg-neutral-700 hover:bg-blue-500 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>

          {/* Outer Delete Button */}
          <button 
            type="button" 
            onClick={handleDelete}
            disabled={!isConnected || isStreaming}
            className="shrink-0 p-3 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-red-400 hover:bg-red-950/30 hover:border-red-900/50 disabled:opacity-50 transition-colors"
            title="Clear Chat"
          >
            <Trash size={18} />
          </button>
          
        </form>
      </div>
      
    </div>
  );
};