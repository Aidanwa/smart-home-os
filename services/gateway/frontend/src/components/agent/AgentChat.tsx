import React, { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, AlertCircle, Trash, Mic, Loader2, Square } from 'lucide-react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { ToolCallChip } from './ToolCallChip';
import { useVoiceInput } from '../../hooks/useVoiceInput';

// Replies are Markdown. Raw HTML in them is ignored (react-markdown's default).
const md: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 pl-5 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 pl-5 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-50">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline underline-offset-2">{children}</a>,
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-neutral-900 text-[0.85em] font-mono">{children}</code>,
  pre: ({ children }) => <pre className="my-2 p-2.5 rounded-lg bg-neutral-900 overflow-x-auto text-xs [&_code]:p-0 [&_code]:bg-transparent">{children}</pre>,
  h1: ({ children }) => <p className="mt-2 mb-1 font-semibold text-neutral-50">{children}</p>,
  h2: ({ children }) => <p className="mt-2 mb-1 font-semibold text-neutral-50">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold text-neutral-50">{children}</p>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="text-xs border-collapse">{children}</table></div>,
  th: ({ children }) => <th className="border border-neutral-700 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-neutral-700 px-2 py-1">{children}</td>,
  blockquote: ({ children }) => <blockquote className="my-1.5 pl-3 border-l-2 border-neutral-600 text-neutral-400">{children}</blockquote>,
};

export const AgentChat: React.FC = () => {
  const { messages, isConnected, gaveUp, isStreaming, sendMessage, stop, DeleteHistory } = useAgentChat();
  const [input, setInput] = useState('');
  const [stopping, setStopping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // A finished reply clears the "Stopping…" state.
  const [prevStreaming, setPrevStreaming] = useState(isStreaming);
  if (isStreaming !== prevStreaming) {
    setPrevStreaming(isStreaming);
    if (!isStreaming) setStopping(false);
  }

  const { isListening, isProcessing, startListening, stopRecording } = useVoiceInput({
    onTranscription: (transcribedText) => {
      // If a reply is still coming, keep the words in the box instead of losing them.
      if (!sendMessage(transcribedText)) setInput(prev => (prev ? `${prev} ${transcribedText}` : transcribedText));
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming || !isConnected) return;
    if (sendMessage(input)) setInput('');
  };

  const handleStop = () => {
    setStopping(true);
    stop();
  };

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming) return;
    DeleteHistory();
  };

  const toggleMic = () => {
    if (isListening) stopRecording();
    else startListening();
  };

  return (
    <div className="flex flex-col w-full h-full flex-1 bg-neutral-900 border-0 md:border border-neutral-800 rounded-none md:rounded-xl overflow-hidden shadow-lg">
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
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-green-500' : gaveUp ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`}></span>
          </span>
          <span className="text-neutral-400">{isConnected ? 'Online' : gaveUp ? 'Disconnected' : 'Reconnecting…'}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 bg-neutral-900 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 gap-3">
            <Bot size={48} className="opacity-20" />
            <p>What can I do for you?</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              if (msg.sender === 'tool') {
                return (
                  <ToolCallChip
                    key={msg.id}
                    name={msg.toolName || 'Unknown tool'}
                    args={msg.toolArgs}
                    status={msg.status}
                    ok={msg.ok}
                    error={msg.error}
                  />
                );
              }

              // A reply from an earlier visit, still being worked on.
              if (msg.placeholder) {
                return (
                  <div key={msg.id} className="flex items-center gap-2 text-sm text-neutral-400">
                    <Loader2 size={16} className="animate-spin" /> Still working on your last message…
                  </div>
                );
              }

              // Stopped before any text arrived.
              if (msg.sender === 'agent' && msg.stopped && !msg.text) {
                return <p key={msg.id} className="text-xs text-neutral-500 pl-11">Stopped.</p>;
              }

              return (
                <div key={msg.id} className={`flex gap-3 max-w-[85%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                  <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                      msg.sender === 'user' ? 'bg-blue-900/40 text-blue-400' :
                      msg.sender === 'system' ? 'bg-red-900/30 text-red-400' : 'bg-neutral-800 text-neutral-400'
                  }`}>
                      {msg.sender === 'user' ? <User size={16} /> : msg.sender === 'system' ? <AlertCircle size={16} /> : <Bot size={16} />}
                  </div>

                  <div className={`min-w-0 p-3 rounded-2xl text-sm leading-relaxed break-words ${
                      msg.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none whitespace-pre-wrap' :
                      msg.sender === 'system' ? 'bg-red-950/50 text-red-400 border border-red-900/50 rounded-tl-none whitespace-pre-wrap' :
                      'bg-neutral-800 text-neutral-200 rounded-tl-none'
                  }`}>
                      {msg.sender === 'agent'
                        ? <Markdown remarkPlugins={[remarkGfm]} components={md}>{msg.text}</Markdown>
                        : msg.text}
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-4 ml-1 bg-neutral-500 animate-pulse align-middle"></span>
                      )}
                      {msg.stopped && <p className="mt-1.5 text-xs text-neutral-500">Stopped</p>}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-800 bg-neutral-900/50 flex gap-2 items-center">
        <div className="relative flex-1 flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Message"
            placeholder={isListening ? 'Listening… (speak now)' : isProcessing ? 'Transcribing…' : isStreaming ? 'Type your next message…' : isConnected ? 'Message your home agent…' : gaveUp ? 'Disconnected: reopen the Agent tab to retry' : 'Reconnecting…'}
            // You can type while a reply arrives; sending waits for it (or for Stop).
            disabled={!isConnected || isListening || isProcessing}
            className={`w-full bg-neutral-800 border ${isListening ? 'border-red-500/50' : 'border-transparent'} focus:border-neutral-700 rounded-full pl-5 pr-24 py-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50 transition-all text-neutral-100 placeholder:text-neutral-500`}
          />

          <div className="absolute right-2 flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMic}
              aria-label={isListening ? 'Stop recording' : 'Speak a message'}
              disabled={!isConnected || isStreaming || isProcessing}
              className={`p-2 rounded-full transition-all ${
                isListening
                  ? 'bg-red-500/20 text-red-500 animate-pulse'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
              } disabled:opacity-50`}
            >
              {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping || !isConnected}
                aria-label={stopping ? 'Stopping' : 'Stop the reply'}
                className="p-2 rounded-full bg-neutral-200 text-neutral-900 hover:bg-white disabled:opacity-60 transition-colors"
              >
                {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} fill="currentColor" />}
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim() || !isConnected}
                className="p-2 rounded-full bg-blue-600 text-white disabled:opacity-50 disabled:bg-neutral-700 hover:bg-blue-500 transition-colors"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={handleDelete} disabled={isStreaming} aria-label="Clear the conversation"
          className="shrink-0 p-3 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-red-400 hover:bg-red-950/30 transition-colors disabled:opacity-50">
          <Trash size={18} />
        </button>
      </form>
    </div>
  );
}
