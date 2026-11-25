import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@ai-document-chatbot/shared';
import { normalizeHistory } from './chat.service';

const u = (content: string): ChatMessage => ({ role: 'user', content });
const a = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('normalizeHistory', () => {
  it('keeps well-formed alternating history', () => {
    expect(normalizeHistory([u('q1'), a('a1'), u('q2'), a('a2')])).toEqual([
      u('q1'),
      a('a1'),
      u('q2'),
      a('a2'),
    ]);
  });

  it('merges consecutive turns of the same role (e.g. after a failed answer)', () => {
    expect(normalizeHistory([u('q1'), u('q1 again'), a('a1')])).toEqual([
      u('q1\n\nq1 again'),
      a('a1'),
    ]);
  });

  it('drops a leading assistant turn (history window cut mid-exchange)', () => {
    expect(normalizeHistory([a('a0'), u('q1'), a('a1')])).toEqual([
      u('q1'),
      a('a1'),
    ]);
  });

  it('drops a trailing user turn so the new question follows an answer', () => {
    expect(normalizeHistory([u('q1'), a('a1'), u('unanswered')])).toEqual([
      u('q1'),
      a('a1'),
    ]);
  });

  it('handles empty history and does not mutate the input', () => {
    expect(normalizeHistory([])).toEqual([]);
    const input = [u('x'), u('y'), a('z')];
    normalizeHistory(input);
    expect(input).toEqual([u('x'), u('y'), a('z')]);
  });

  it('drops empty turns, which providers reject', () => {
    expect(normalizeHistory([u('q1'), a('  '), u('q2'), a('a2')])).toEqual([
      u('q1\n\nq2'),
      a('a2'),
    ]);
  });

  it('strips old citation markers, which referred to earlier excerpts', () => {
    expect(
      normalizeHistory([u('q1'), a('Refunds take 14 days [1][2]. See [3].')]),
    ).toEqual([u('q1'), a('Refunds take 14 days. See.')]);
  });

  it('keeps bracketed text in user turns (e.g. code)', () => {
    expect(
      normalizeHistory([
        u('What does arr[0] return?'),
        a('The first item [1].'),
      ]),
    ).toEqual([u('What does arr[0] return?'), a('The first item.')]);
  });
});
