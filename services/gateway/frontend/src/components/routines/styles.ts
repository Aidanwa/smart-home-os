export const input = 'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200';
export const label = 'block text-xs font-medium text-neutral-400 mb-1';
export const card = 'bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-3';
export const chip = (on: boolean) =>
  `min-h-11 px-3 rounded-lg text-sm font-medium border transition-colors ${on ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-neutral-950 border-neutral-800 text-neutral-500'}`;
// 44px touch target; the negative margin keeps the row as compact as the old 28px button.
export const iconBtn = 'inline-flex items-center justify-center size-11 -my-2 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800/60 disabled:opacity-30';
