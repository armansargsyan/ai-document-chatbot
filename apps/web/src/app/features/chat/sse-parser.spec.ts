import { SseParser, toChatStreamEvent } from './sse-parser';

const DELTA = 'event: delta\ndata: {"type":"delta","text":"Hel"}\n\n';
const DELTA2 = 'event: delta\ndata: {"type":"delta","text":"lo"}\n\n';

describe('SseParser', () => {
  it('parses one complete event', () => {
    expect(new SseParser().push(DELTA)).toEqual([
      { event: 'delta', data: '{"type":"delta","text":"Hel"}' },
    ]);
  });

  it('waits for the rest of an event split across chunks', () => {
    const parser = new SseParser();
    const cut = 20;
    expect(parser.push(DELTA.slice(0, cut))).toEqual([]);
    expect(parser.push(DELTA.slice(cut, -1))).toEqual([]); // one "\n" short
    expect(parser.push('\n')).toEqual([
      { event: 'delta', data: '{"type":"delta","text":"Hel"}' },
    ]);
  });

  it('splits at every possible boundary without losing or duplicating events', () => {
    const stream = DELTA + DELTA2;
    for (let i = 0; i <= stream.length; i++) {
      const parser = new SseParser();
      const events = [
        ...parser.push(stream.slice(0, i)),
        ...parser.push(stream.slice(i)),
      ];
      expect(events.map((e) => e.data)).toEqual([
        '{"type":"delta","text":"Hel"}',
        '{"type":"delta","text":"lo"}',
      ]);
    }
  });

  it('returns several events from one chunk', () => {
    const events = new SseParser().push(DELTA + DELTA2 + DELTA);
    expect(events).toHaveLength(3);
  });

  it('handles CRLF line endings, including a CR/LF pair split across chunks', () => {
    const parser = new SseParser();
    const crlf = DELTA.replace(/\n/g, '\r\n');
    const at = crlf.indexOf('\r\n\r\n') + 1; // between "\r" and "\n"
    expect(parser.push(crlf.slice(0, at))).toEqual([]);
    expect(parser.push(crlf.slice(at))).toHaveLength(1);
  });

  it('joins multi-line data and ignores comments and unknown fields', () => {
    const events = new SseParser().push(
      ': keep-alive\nid: 7\nevent: x\ndata: a\ndata:b\n\n',
    );
    expect(events).toEqual([{ event: 'x', data: 'a\nb' }]);
  });

  it('skips blocks without data', () => {
    expect(new SseParser().push(': ping\n\nevent: delta\n\n')).toEqual([]);
  });

  it('flushes a final event that lacks its blank line', () => {
    const parser = new SseParser();
    expect(parser.push(DELTA.trimEnd())).toEqual([]);
    expect(parser.flush()).toHaveLength(1);
    expect(parser.flush()).toEqual([]);
  });
});

describe('toChatStreamEvent', () => {
  it('reads the start event and rejects one without a conversation id', () => {
    expect(
      toChatStreamEvent({
        event: 'start',
        data: '{"type":"start","conversationId":"c1"}',
      }),
    ).toEqual({ type: 'start', conversationId: 'c1' });
    expect(
      toChatStreamEvent({ event: 'start', data: '{"type":"start"}' }),
    ).toBeNull();
  });

  it('reads delta, done and error events', () => {
    expect(
      toChatStreamEvent({
        event: 'delta',
        data: '{"type":"delta","text":"x"}',
      }),
    ).toEqual({ type: 'delta', text: 'x' });

    const done = toChatStreamEvent({
      event: 'done',
      data: JSON.stringify({
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: 'c1',
        citations: [
          {
            number: 1,
            documentId: 'd',
            documentName: 'a.pdf',
            page: 2,
            snippet: 's',
          },
          { number: 'bad' },
        ],
      }),
    });
    expect(done).toEqual({
      type: 'done',
      modelId: 'claude-haiku-5-5',
      conversationId: 'c1',
      citations: [
        {
          number: 1,
          documentId: 'd',
          documentName: 'a.pdf',
          page: 2,
          snippet: 's',
        },
      ],
    });

    expect(
      toChatStreamEvent({
        event: 'error',
        data: '{"type":"error","status":502,"message":"Failed","conversationId":"c9"}',
      }),
    ).toEqual({
      type: 'error',
      status: 502,
      message: 'Failed',
      conversationId: 'c9',
    });
  });

  it.each([
    ['not JSON', '{"type":"delta",'],
    ['not an object', '"hello"'],
    ['an array', '[1]'],
    ['an unknown type', '{"type":"other"}'],
    ['a delta without text', '{"type":"delta","text":5}'],
    ['a done without a conversation', '{"type":"done","modelId":"m"}'],
  ])('returns null for %s', (_, data) => {
    expect(toChatStreamEvent({ event: 'message', data })).toBeNull();
  });
});
