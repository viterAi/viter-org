/**
 * Pure formatters for chat messages — safe to import from client components.
 *
 * Split out from queries.ts because queries.ts imports server-only Supabase
 * helpers; importing it from a client component would either fail the build
 * or accidentally pull server modules into the browser bundle.
 */

import type { MessageEvent } from './types';

export interface MessageBlock {
  dayKey: string;     // 'YYYY-MM-DD' in tz, used for sort
  dayLabel: string;   // 'Today' / 'Yesterday' / 'Mon, May 5'
  messages: MessageEvent[];
}

export function groupByDay(messages: MessageEvent[], tz = 'Asia/Jerusalem'): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const today = formatDayKey(new Date(), tz);
  const yesterday = formatDayKey(new Date(Date.now() - 86_400_000), tz);

  for (const m of messages) {
    const d = new Date(m.event_at);
    const dayKey = formatDayKey(d, tz);
    let block = blocks.find((b) => b.dayKey === dayKey);
    if (!block) {
      const dayLabel =
        dayKey === today ? 'Today' :
        dayKey === yesterday ? 'Yesterday' :
        d.toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
          year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
          timeZone: tz,
        });
      block = { dayKey, dayLabel, messages: [] };
      blocks.push(block);
    }
    block.messages.push(m);
  }
  return blocks;
}

function formatDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Group consecutive messages from the same sender into runs so the UI can
 * show the sender label only on the first bubble of each run.
 */
export function groupConsecutive(messages: MessageEvent[]): MessageEvent[][] {
  const groups: MessageEvent[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && bubbleSiblings(last[last.length - 1]!, m)) {
      last.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

function bubbleSiblings(a: MessageEvent, b: MessageEvent): boolean {
  if (a.from_me !== b.from_me) return false;
  if ((a.push_name ?? '') !== (b.push_name ?? '')) return false;
  return new Date(b.event_at).getTime() - new Date(a.event_at).getTime() < 120_000;
}
