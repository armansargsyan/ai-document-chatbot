import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  OpenAiEmbedder,
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
