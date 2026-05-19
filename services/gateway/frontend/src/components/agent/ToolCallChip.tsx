// src/components/agent/ToolCallChip.tsx
import React, { useState } from 'react';
import { Wrench, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react';

interface ToolCallChipProps {
  name: string;
  args?: string;
  status?: 'pending' | 'completed'; // NEW: Add status prop
}

export const ToolCallChip: React.FC<ToolCallChipProps> = ({ name, args, status = 'completed' }) => {
  const [expanded, setExpanded] = useState(false);

  // Clean up the tool name (e.g., "get_device_state" -> "Get Device State")
  const formattedName = name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <div className="w-full max-w-[85%] my-2">
      <div 
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors text-xs select-none ${
          status === 'pending' 
            ? 'bg-amber-950/30 border-amber-900/50 hover:bg-amber-950/50 text-amber-200/70' 
            : 'bg-neutral-800/50 border-neutral-700/50 hover:bg-neutral-800 text-neutral-400'
        }`}
      >
        <Wrench size={14} className={status === 'pending' ? 'text-amber-500' : 'text-blue-400'} />
        <span className="font-mono">{formattedName}</span>
        
        {/* NEW: Conditional Icon based on status */}
        {status === 'pending' ? (
          <Loader2 size={14} className="text-amber-500 animate-spin ml-1" />
        ) : (
          <Check size={14} className="text-green-500 ml-1" />
        )}
        
        {expanded ? <ChevronUp size={14} className="ml-1" /> : <ChevronDown size={14} className="ml-1" />}
      </div>
      
      {/* Expandable Args View */}
      {expanded && args && (
        <div className="mt-2 p-3 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-[11px] text-neutral-400 overflow-x-auto">
          <pre>{JSON.stringify(JSON.parse(args), null, 2)}</pre>
        </div>
      )}
    </div>
  );
};