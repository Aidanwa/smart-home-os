export const input = 'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200';
export const label = 'block text-xs font-medium text-neutral-400 mb-1';
export const card = 'bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-3';
export const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-neutral-950 border-neutral-800 text-neutral-500'}`;
export const iconBtn = 'p-1.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-30';
