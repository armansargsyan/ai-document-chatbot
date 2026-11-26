import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import OpenAI, { APIError } from 'openai';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  Embedder,
  OpenAiEmbedder,
  QuotaTrackingEmbedder,
} from './embedder';

/** A full-size vector whose first two values identify the input. */
const vector = (a: number, b: number) => [
  a,
  b,
  ...new Array(EMBEDDING_DIMENSIONS - 2).fill(0),
];

/** Fake embeddings API: returns items in reverse order to check re-ordering by index. */
function fakeClient() {
  const create = vi.fn(async ({ input }: { input: string[] }) => ({
    data: input
      .map((text, index) => ({ index, embedding: vector(text.length, index) }))
      .reverse(),
  }));
  return { create, client: { embeddings: { create } } as unknown as OpenAI };
}

describe('OpenAiEmbedder', () => {
  it('embeds with text-embedding-3-small in input order', async () => {
    const { create, client } = fakeClient();
    const vectors = await new OpenAiEmbedder(client).embed(['a', 'bb', 'ccc']);
    expect(vectors.map((v) => v.slice(0, 2))).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
    expect(create).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input: ['a', 'bb', 'ccc'],
    });
  });

  it('batches large inputs (100 per request)', async () => {
    const { create, client } = fakeClient();
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const vectors = await new OpenAiEmbedder(client).embed(texts);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls.map(([body]) => body.input.length)).toEqual([
      100, 100, 50,
    ]);
    expect(vectors).toHaveLength(250);
    expect(vectors[249].slice(0, 2)).toEqual(['t249'.length, 49]);
  });

  it('fails if the API returns the wrong number of embeddings', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
    const embedder = new OpenAiEmbedder({
      embeddings: { create },
    } as unknown as OpenAI);
    await expect(embedder.embed(['a', 'b'])).rejects.toMatchObject({
      status: 502,
    });
  });

  it('fails if a vector has the wrong number of dimensions', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ index: 0, embedding: [1, 2, 3] }] });
    const embedder = new OpenAiEmbedder({
      embeddings: { create },
    } as unknown as OpenAI);
    await expect(embedder.embed(['a'])).rejects.toMatchObject({ status: 502 });
  });
});

describe('QuotaTrackingEmbedder', () => {
  class FakeEmbedder extends Embedder {
    readonly dimensions = 2;
    embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
  }

  const insufficientQuota = () =>
    APIError.generate(
      429,
      {
        error: {
          message: 'You exceeded your current quota, please check your plan.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      },
      undefined,
      new Headers(),
    );

  it('passes calls and other errors through', async () => {
    const inner = new FakeEmbedder();
    const embedder = new QuotaTrackingEmbedder(
      inner,
      new ProviderQuotaTracker(),
    );
    expect(embedder.dimensions).toBe(2);
    expect(await embedder.embed(['a'])).toEqual([[1, 0]]);
    const rateLimit = APIError.generate(
      429,
      { error: { message: 'slow down', code: 'rate_limit_exceeded' } },
      undefined,
      new Headers(),
    );
    inner.embed.mockRejectedValueOnce(rateLimit);
    await expect(embedder.embed(['a'])).rejects.toBe(rateLimit);
  });

  it('turns exhaustion into 503 search_quota_exhausted, remembers it and fails fast', async () => {
    const inner = new FakeEmbedder();
    const quota = new ProviderQuotaTracker();
    const embedder = new QuotaTrackingEmbedder(inner, quota);
    inner.embed.mockRejectedValueOnce(insufficientQuota());

    const error = await embedder.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        'Document search has reached its demo limit for this month, so uploads and questions are paused.',
      code: 'search_quota_exhausted',
    });
    expect(quota.searchExhausted).toBe(true);
    // Same key: the OpenAI chat model is out too.
    expect(quota.isExhausted('openai')).toBe(true);

    inner.embed.mockClear();
    await expect(embedder.embed(['b'])).rejects.toBeInstanceOf(HttpException);
    expect(inner.embed).not.toHaveBeenCalled();
  });

  it('recognizes exhaustion from a real OpenAI client response (no network)', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'You exceeded your current quota.',
              type: 'insufficient_quota',
              code: 'insufficient_quota',
              param: null,
            },
          }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'x-should-retry': 'false',
            },
          },
        ),
    );
    const client = new OpenAI({ apiKey: 'test-key', fetch, maxRetries: 0 });
    const quota = new ProviderQuotaTracker();
    const embedder = new QuotaTrackingEmbedder(
      new OpenAiEmbedder(client),
      quota,
    );
    const error = await embedder.embed(['a']).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(quota.searchExhausted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
