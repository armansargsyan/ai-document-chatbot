import { describe, expect, it } from 'vitest';
import {
  ProviderQuotaTracker,
  QUOTA_RECHECK_MS,
  startOfNextUtcMonth,
} from './provider-quota-tracker';

function trackerAt(iso: string) {
  let now = Date.parse(iso);
  const tracker = new ProviderQuotaTracker(() => now);
  return {
    tracker,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('startOfNextUtcMonth', () => {
  it.each([
    ['2026-11-26T12:00:00.000Z', '2026-12-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.000Z', '2027-01-01T00:00:00.000Z'],
    ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
  ])('%s -> %s', (from, expected) => {
    expect(new Date(startOfNextUtcMonth(Date.parse(from))).toISOString()).toBe(
      expected,
    );
  });
});

describe('ProviderQuotaTracker', () => {
  it('starts with nothing exhausted', () => {
    const { tracker } = trackerAt('2026-11-26T12:00:00.000Z');
    expect(tracker.isExhausted('openai')).toBe(false);
    expect(tracker.searchExhausted).toBe(false);
  });

  it('marks one provider only; OpenAI also pauses search', () => {
    const { tracker } = trackerAt('2026-11-26T12:00:00.000Z');
    tracker.markExhausted('openai');
    expect(tracker.isExhausted('openai')).toBe(true);
    expect(tracker.searchExhausted).toBe(true);
    expect(tracker.isExhausted('anthropic')).toBe(false);
    expect(tracker.isExhausted('gemini')).toBe(false);
  });

  it('lets a request probe again after the recheck interval', () => {
    const { tracker, advance } = trackerAt('2026-11-10T12:00:00.000Z');
    tracker.markExhausted('gemini');
    advance(QUOTA_RECHECK_MS - 1);
    expect(tracker.isExhausted('gemini')).toBe(true);
    advance(1);
    expect(tracker.isExhausted('gemini')).toBe(false);
  });

  it('clears at the start of the next UTC month if that comes first', () => {
    const { tracker, advance } = trackerAt('2026-11-30T23:50:00.000Z');
    tracker.markExhausted('anthropic');
    advance(10 * 60_000 - 1);
    expect(tracker.isExhausted('anthropic')).toBe(true);
    advance(1); // 2026-12-01T00:00:00Z
    expect(tracker.isExhausted('anthropic')).toBe(false);
  });

  it('re-marking extends the window', () => {
    const { tracker, advance } = trackerAt('2026-11-10T12:00:00.000Z');
    tracker.markExhausted('openai');
    advance(QUOTA_RECHECK_MS / 2);
    tracker.markExhausted('openai');
    advance(QUOTA_RECHECK_MS / 2 + 1);
    expect(tracker.isExhausted('openai')).toBe(true);
  });
});
