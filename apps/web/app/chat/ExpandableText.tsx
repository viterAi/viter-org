'use client';

import { useState } from 'react';

interface ExpandableTextProps {
  text: string;
  /** Show "Show more" only if text is longer than this. */
  maxChars?: number;
  className?: string;
}

/** Long-text preview with a Show more / Show less toggle. */
export function ExpandableText({ text, maxChars = 240, className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const isLong = trimmed.length > maxChars;
  const display = !isLong || expanded ? trimmed : trimmed.slice(0, maxChars).trimEnd() + '…';

  return (
    <div className={className}>
      <p className="whitespace-pre-wrap break-words">{display}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
