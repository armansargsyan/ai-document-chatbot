import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { LlmProviderId } from '@ai-document-chatbot/shared';
import type { ChatStreamRequest, LlmProvider } from './llm-provider';
import { LlmRequestAbortedError } from './llm-errors';
import { FIRST_TOKEN_TIMEOUT_MS, LlmService } from './llm.service';

class FakeProvider implements LlmProvider {
  readonly requests: ChatStreamRequest[] = [];
  constructor(
    readonly id: LlmProviderId,
    private readonly behaviour: (
      req: ChatStreamRequest,
    ) => AsyncIterable<string>,
  ) {}
  streamChat(request: ChatStreamRequest): AsyncIterable<string> {
    this.requests.push(request);
    return this.behaviour(request);
  }
}

async function* chunks(...parts: string[]) {
  for (const part of parts) yield part;
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

async function failure(stream: AsyncIterable<string>): Promise<unknown> {
  return collect(stream).then(
    () => {
      throw new Error('expected the stream to fail');
    },
    (error: unknown) => error,
  );
}

const messages = [{ role: 'user' as const, content: 'Hi' }];

describe('LlmService', () => {
  it('routes the model to its provider and streams the deltas', async () => {
    const anthropic = new FakeProvider('anthropic', () => chunks('Hel', 'lo'));
    const openai = new FakeProvider('openai', () => chunks('wrong'));
    const service = new LlmService([anthropic, openai]);
    const caller = new AbortController();
    const signal = caller.signal;

    const out = await collect(
      service.streamChat({
        modelId: 'claude-haiku-5-5',
        system: 'Be brief',
        messages,
        maxOutputTokens: 50,
        signal,
      }),
    );

    expect(out).toEqual(['Hel', 'lo']);
    expect(openai.requests).toHaveLength(0);
    expect(anthropic.requests).toEqual([
      {
        model: 'claude-haiku-5-5',
        system: 'Be brief',
        messages,
        maxOutputTokens: 50,
        signal: expect.any(AbortSignal),
        onActivity: expect.any(Function),
      },
    ]);
    // The provider gets a combined signal that still follows the caller's.
    const forwarded = anthropic.requests[0].signal as AbortSignal;
    expect(forwarded.aborted).toBe(false);
    caller.abort();
    expect(forwarded.aborted).toBe(true);
  });

  it('applies a default output-token limit', async () => {
    const gemini = new FakeProvider('gemini', () => chunks('ok'));
    await collect(
      new LlmService([gemini]).streamChat({
        modelId: 'gemini-3.8-flash',
        messages,
      }),
    );
    expect(gemini.requests[0].maxOutputTokens).toBe(1024);
  });

  it('rejects models outside the allow-list with 400, before calling any provider', async () => {
    const openai = new FakeProvider('openai', () => chunks('x'));
    const error = await failure(
      new LlmService([openai]).streamChat({ modelId: 'gpt-made-up', messages }),
    );
    expect((error as HttpException).getStatus()).toBe(400);
    expect(openai.requests).toHaveLength(0);
  });

  it('returns 503 when the model provider has no API key configured', async () => {
    const error = await failure(
      new LlmService([]).streamChat({ modelId: 'gpt-6-luna', messages }),
    );
    expect((error as HttpException).getStatus()).toBe(503);
  });

  it.each([
    [400, 400],
    [413, 400],
    [401, 503],
    [403, 503],
    [404, 503],
    [429, 429],
    [500, 502],
    [529, 502],
    [undefined, 502],
  ])(
    'maps provider status %s to HTTP %s with a generic message',
    async (status, expected) => {
      const providerError = Object.assign(
        new Error('sk-live-secret leaked in provider message'),
        {
          status,
        },
      );
      const provider = new FakeProvider('openai', () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(providerError),
        }),
      }));
      const error = await failure(
        new LlmService([provider]).streamChat({
          modelId: 'gpt-6-luna',
          messages,
        }),
      );
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(expected);
      expect(
        JSON.stringify((error as HttpException).getResponse()),
      ).not.toContain('sk-live');
    },
  );

  it('maps an error after partial output too', async () => {
    const provider = new FakeProvider('anthropic', async function* () {
      yield 'partial';
      throw Object.assign(new Error('overloaded'), { status: 529 });
    });
    const out: string[] = [];
    const error = await (async () => {
      try {
        for await (const part of new LlmService([provider]).streamChat({
          modelId: 'claude-sonnet-5-5',
          messages,
        })) {
          out.push(part);
        }
      } catch (e) {
        return e;
      }
    })();
    expect(out).toEqual(['partial']);
    expect((error as HttpException).getStatus()).toBe(502);
  });

  it('reports a caller abort as LlmRequestAbortedError without logging', async () => {
    const caller = new AbortController();
    const provider = new FakeProvider('openai', async function* () {
      yield* [];
      caller.abort();
      throw Object.assign(new Error('aborted'), { name: 'APIUserAbortError' });
    });
    const service = new LlmService([provider]);
    const warn = vi.spyOn(service['logger'], 'warn');
    const error = await failure(
      service.streamChat({
        modelId: 'gpt-6-luna',
        messages,
        signal: caller.signal,
      }),
    );
    expect(error).toBeInstanceOf(LlmRequestAbortedError);
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats an SDK-internal AbortError (e.g. a timeout) as 504, not a caller abort', async () => {
    const caller = new AbortController();
    const provider = new FakeProvider('gemini', async function* () {
      yield* [];
      throw Object.assign(new Error('This operation was aborted'), {
        name: 'AbortError',
      });
    });
    const service = new LlmService([provider]);
    const warn = vi.spyOn(service['logger'], 'warn');
    const error = await failure(
      service.streamChat({
        modelId: 'gemini-3.8-flash',
        messages,
        signal: caller.signal,
      }),
    );
    expect(error).not.toBeInstanceOf(LlmRequestAbortedError);
    expect((error as HttpException).getStatus()).toBe(504);
    expect(warn).toHaveBeenCalledOnce();
  });

  describe('time to first token', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Never yields; rejects like the SDKs do once the signal aborts. */
    const hangingProvider = () =>
      new FakeProvider('anthropic', (request) => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<string>>((_resolve, reject) =>
              request.signal?.addEventListener('abort', () =>
                reject(
                  Object.assign(new Error('aborted'), { name: 'AbortError' }),
                ),
              ),
            ),
        }),
      }));

    it('fails with 504 when no delta arrives in time', async () => {
      const result = failure(
        new LlmService([hangingProvider()]).streamChat({
          modelId: 'claude-haiku-5-5',
          messages,
          signal: new AbortController().signal,
        }),
      );
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS);
      expect(((await result) as HttpException).getStatus()).toBe(504);
    });

    /** Resolves after `ms`, but rejects like the SDKs if the request signal aborts first. */
    const waitUnlessAborted = (request: ChatStreamRequest, ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });

    it('does not limit a stream once it has started', async () => {
      const provider = new FakeProvider('anthropic', async function* (request) {
        request.onActivity?.();
        yield 'first';
        await waitUnlessAborted(request, FIRST_TOKEN_TIMEOUT_MS * 3);
        request.onActivity?.();
        yield 'late';
      });
      const result = collect(
        new LlmService([provider]).streamChat({
          modelId: 'claude-haiku-5-5',
          messages,
        }),
      );
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS * 3);
      expect(await result).toEqual(['first', 'late']);
    });

    it('treats non-text activity (reasoning/thinking) as the response having started', async () => {
      const provider = new FakeProvider('openai', async function* (request) {
        request.onActivity?.(); // e.g. response.created / reasoning deltas, no text yet
        await waitUnlessAborted(request, FIRST_TOKEN_TIMEOUT_MS * 2);
        request.onActivity?.();
        yield 'answer';
      });
      const result = collect(
        new LlmService([provider]).streamChat({
          modelId: 'gpt-6.2-astra',
          messages,
        }),
      );
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS * 2);
      expect(await result).toEqual(['answer']);
    });
  });

  it('lists every allow-listed model with availability', () => {
    const result = new LlmService([
      new FakeProvider('gemini', () => chunks()),
    ]).listModels();
    expect(result.defaultModelId).toBe('claude-haiku-5-5');
    expect(
      result.models.find((m) => m.id === 'gemini-4-argon')?.available,
    ).toBe(true);
    expect(result.models.find((m) => m.id === 'gpt-6.2-astra')?.available).toBe(
      false,
    );
    expect(result.models.every((m) => m.label.length > 0)).toBe(true);
  });
});
