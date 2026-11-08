import { useState } from 'react';

interface Props {
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  allowNegative?: boolean;  // phone decimal keypads have no minus key, so use the full keyboard
  className?: string;
  ariaLabel?: string;
}

/** A number box that leaves your typing alone. While focused it shows exactly what you typed
 *  ("", "-", "68.") and only reports values that are valid and in range; on blur it clamps an
 *  out-of-range number or restores the last good value if the box is empty or invalid. */
export function NumberField({ value, onChange, min = -Infinity, max = Infinity, integer = false, allowNegative = false, className, ariaLabel }: Props) {
  const [draft, setDraft] = useState<string | null>(null);  // null = not editing

  const parse = (text: string) => {
    const t = text.trim();
    if (!(integer ? /^-?\d+$/ : /^-?(\d+\.?\d*|\.\d+)$/).test(t)) return null;  // "", "-", "." and "1e5" aren't numbers yet
    return Number(t);
  };

  return (
    <input
      type="text"
      inputMode={allowNegative ? 'text' : integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      className={className}
      value={draft ?? (value === null ? '' : String(value))}
      onFocus={e => setDraft(e.target.value)}
      onChange={e => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n !== null && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        const n = draft === null ? null : parse(draft);
        if (n !== null) {
          const clamped = Math.min(max, Math.max(min, n));
          if (clamped !== value) onChange(clamped);
        }
        setDraft(null);
      }}
    />
  );
}
