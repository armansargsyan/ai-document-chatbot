import type OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
/** Inputs per embeddings request. */
const BATCH_SIZE = 100;

/**
 * Turns texts into embedding vectors (same order as the input).
 * Abstract class so it can be a DI token and replaced with a fake in tests.
 */
export abstract class Embedder {
  abstract readonly dimensions: number;
  abstract embed(texts: string[]): Promise<number[][]>;
}

/** OpenAI `text-embedding-3-small`. */
export class OpenAiEmbedder extends Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(private readonly client: Pick<OpenAI, 'embeddings'>) {
    super();
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input: batch,
      });
      // The API returns one item per input, tagged with its index.
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      if (ordered.length !== batch.length) {
        throw Object.assign(new Error('Embedding count mismatch'), {
          status: 502,
        });
      }
      if (ordered.some((item) => item.embedding.length !== this.dimensions)) {
        throw Object.assign(new Error('Unexpected embedding size'), {
          status: 502,
        });
      }
      vectors.push(...ordered.map((item) => item.embedding));
    }
    return vectors;
  }
}
