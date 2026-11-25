import type { ConversationSummary } from '@ai-document-chatbot/shared';
import {
  groupByRecency,
  relativeTime,
  titleError,
  titleFromMessage,
} from './conversation-format';

/** Local noon, so day boundaries don't depend on the runner's time zone. */
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime();
const at = (days: number, hours = 0, minutes = 0) =>
  new Date(NOW - ((days * 24 + hours) * 60 + minutes) * 60_000).toISOString();

const summary = (id: string, updatedAt: string): ConversationSummary => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  messageCount: 2,
});

describe('conversation-format', () => {
  it('derives a title from the first message like the api', () => {
    expect(titleFromMessage('  When is\n rent   due?  ')).toBe(
      'When is rent due?',
    );
    const long = 'a'.repeat(59) + ' bcdef';
    expect(titleFromMessage(long)).toBe('a'.repeat(59) + '…');
    expect(titleFromMessage('   ')).toBe('New conversation');
  });

  it('validates titles: trimmed, 1–100 characters', () => {
    expect(titleError('  ')).toBe('Enter a title.');
    expect(titleError('x'.repeat(101))).toContain('100');
    expect(titleError(`  ${'x'.repeat(100)}  `)).toBeNull();
    expect(titleError('Lease')).toBeNull();
  });

  it('groups newest first into Today, Previous 7 days and Older', () => {
    const groups = groupByRecency(
      [
        summary('older', at(30)),
        summary('today-early', at(0, 11)),
        summary('week', at(3)),
        summary('today-late', at(0, 0, 5)),
      ],
      NOW,
    );
    expect(
      groups.map((g) => [g.label, g.conversations.map((c) => c.id)]),
    ).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['Previous 7 days', ['week']],
      ['Older', ['older']],
    ]);
  });

  it('formats compact relative times', () => {
    expect(relativeTime(at(0, 0, 0), NOW)).toBe('Just now');
    expect(relativeTime(at(0, 0, 5), NOW)).toBe('5m ago');
    expect(relativeTime(at(0, 3), NOW)).toMatch(/9:00/);
    expect(relativeTime(at(1), NOW)).toBe('Yesterday');
    expect(relativeTime(at(3), NOW)).toMatch(/^\w{3}/);
    expect(relativeTime(at(30), NOW)).toMatch(/Oct/);
    expect(relativeTime(at(400), NOW)).toMatch(/2025/);
    expect(relativeTime('nope', NOW)).toBe('');
  });
});
