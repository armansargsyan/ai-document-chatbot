import {
  MAX_CONVERSATION_TITLE_LENGTH,
  type ConversationSummary,
} from '@ai-document-chatbot/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_FROM_MESSAGE_LENGTH = 60;

/**
 * The title the api gives a conversation created by `message` (first message,
 * one line, 60 characters plus "…"). Shown until the list is next reloaded.
 */
export function titleFromMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  const title =
    chars.length > TITLE_FROM_MESSAGE_LENGTH
      ? `${chars.slice(0, TITLE_FROM_MESSAGE_LENGTH).join('').trimEnd()}…`
      : oneLine;
  return title || 'New conversation';
}

/** Client-side check matching the api: trimmed, 1–100 characters. */
export function titleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Enter a title.';
  if (Array.from(trimmed).length > MAX_CONVERSATION_TITLE_LENGTH) {
    return `Use at most ${MAX_CONVERSATION_TITLE_LENGTH} characters.`;
  }
  return null;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type RecencyGroup = 'today' | 'week' | 'older';

export const RECENCY_LABELS: Record<RecencyGroup, string> = {
  today: 'Today',
  week: 'Previous 7 days',
  older: 'Older',
};

export function recencyGroup(iso: string, now: number): RecencyGroup {
  const today = startOfDay(now);
  const at = Date.parse(iso);
  if (at >= today) return 'today';
  return at >= today - 7 * DAY_MS ? 'week' : 'older';
}

export interface ConversationGroup {
  readonly key: RecencyGroup;
  readonly label: string;
  readonly conversations: readonly ConversationSummary[];
}

/** Newest activity first, then split into Today / Previous 7 days / Older. */
export function groupByRecency(
  conversations: readonly ConversationSummary[],
  now: number,
): ConversationGroup[] {
  const sorted = [...conversations].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  const groups: ConversationGroup[] = [];
  for (const c of sorted) {
    const key = recencyGroup(c.updatedAt, now);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      (last.conversations as ConversationSummary[]).push(c);
    } else {
      groups.push({ key, label: RECENCY_LABELS[key], conversations: [c] });
    }
  }
  return groups;
}

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const FULL = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Compact "last activity" label: `Just now`, `5m`, `3:40 PM`, `Yesterday`, `Mon`, `Nov 3`. */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const today = startOfDay(now);
  if (at >= today) return TIME.format(at);
  if (at >= today - DAY_MS) return 'Yesterday';
  if (at >= today - 6 * DAY_MS) return WEEKDAY.format(at);
  return new Date(at).getFullYear() === new Date(now).getFullYear()
    ? DAY.format(at)
    : DAY_YEAR.format(at);
}

/** Full date and time, for a tooltip. */
export function fullTime(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? FULL.format(at) : '';
}
