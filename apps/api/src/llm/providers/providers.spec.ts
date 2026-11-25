import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';
import type OpenAI from 'openai';
import type { ChatStreamRequest } from '../llm-provider';
import { AnthropicProvider } from './anthropic.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';

/** Fake SDK clients: each returns an async iterable of vendor events. No network. */
async function* events<T>(...items: T[]) {
  for (const item of items) yield item;
}

async function collect(stream: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

const signal = new AbortController().signal;
const request: ChatStreamRequest = {
  model: 'some-model',
  system: 'You answer from documents.',
  messages: [
    { role: 'user', content: 'Question 1' },
    { role: 'assistant', content: 'Answer 1' },
    { role: 'user', content: 'Question 2' },
  ],
  maxOutputTokens: 256,
  signal,
};

describe('OpenAiProvider', () => {
  it('calls the Responses API and yields only output-text deltas', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        events(
          { type: 'response.created' },
          { type: 'response.output_text.delta', delta: 'Hel' },
          { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
          { type: 'response.output_text.delta', delta: 'lo' },
          { type: 'response.completed' },
        ),
      );
    const onActivity = vi.fn();
    const provider = new OpenAiProvider({
      responses: { create },
    } as unknown as OpenAI);

    expect(
      await collect(provider.streamChat({ ...request, onActivity })),
    ).toEqual(['Hel', 'lo']);
    // Every upstream event counts as activity, including the reasoning delta.
    expect(onActivity).toHaveBeenCalledTimes(5);
    expect(create).toHaveBeenCalledWith(
      {
        model: 'some-model',
        instructions: 'You answer from documents.',
        input: request.messages,
        max_output_tokens: 256,
        store: false,
        stream: true,
      },
      { signal },
    );
  });

  it('throws on an in-stream failure event', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        events(
          { type: 'response.output_text.delta', delta: 'a' },
          { type: 'response.failed' },
        ),
      );
    const provider = new OpenAiProvider({
      responses: { create },
    } as unknown as OpenAI);
    await expect(collect(provider.streamChat(request))).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('AnthropicProvider', () => {
  it('calls the Messages API and yields only text deltas', async () => {
    const create = vi.fn().mockResolvedValue(
      events(
        { type: 'message_start' },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hel' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'hmm' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'lo' },
        },
        { type: 'message_stop' },
      ),
    );
    const provider = new AnthropicProvider({
      messages: { create },
    } as unknown as Anthropic);

    expect(await collect(provider.streamChat(request))).toEqual(['Hel', 'lo']);
    expect(create).toHaveBeenCalledWith(
      {
        model: 'some-model',
        system: 'You answer from documents.',
        messages: request.messages,
        max_tokens: 256,
        stream: true,
      },
      { signal },
    );
  });
});

describe('GeminiProvider', () => {
  it('maps roles to Gemini contents and skips empty chunks', async () => {
    const generateContentStream = vi
      .fn()
      .mockResolvedValue(
        events(
          { text: 'Hel' },
          { text: undefined },
          { text: '' },
          { text: 'lo' },
        ),
      );
    const provider = new GeminiProvider({
      models: { generateContentStream },
    } as unknown as GoogleGenAI);

    expect(await collect(provider.streamChat(request))).toEqual(['Hel', 'lo']);
    expect(generateContentStream).toHaveBeenCalledWith({
      model: 'some-model',
      contents: [
        { role: 'user', parts: [{ text: 'Question 1' }] },
        { role: 'model', parts: [{ text: 'Answer 1' }] },
        { role: 'user', parts: [{ text: 'Question 2' }] },
      ],
      config: {
        systemInstruction: 'You answer from documents.',
        maxOutputTokens: 256,
        abortSignal: signal,
      },
    });
  });

  it('re-tags an invalid API key (HTTP 400) as an auth failure', async () => {
    const generateContentStream = vi.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'API key not valid. Please pass a valid API key. [API_KEY_INVALID]',
        ),
        {
          status: 400,
        },
      ),
    );
    const provider = new GeminiProvider({
      models: { generateContentStream },
    } as unknown as GoogleGenAI);
    await expect(collect(provider.streamChat(request))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('passes other 400s through unchanged', async () => {
    const original = Object.assign(
      new Error('Request contains an invalid argument.'),
      { status: 400 },
    );
    const generateContentStream = vi.fn().mockRejectedValue(original);
    const provider = new GeminiProvider({
      models: { generateContentStream },
    } as unknown as GoogleGenAI);
    await expect(collect(provider.streamChat(request))).rejects.toBe(original);
  });

  it('fails instead of returning an empty reply when the prompt is blocked', async () => {
    const generateContentStream = vi
      .fn()
      .mockResolvedValue(
        events({ text: undefined, promptFeedback: { blockReason: 'SAFETY' } }),
      );
    const provider = new GeminiProvider({
      models: { generateContentStream },
    } as unknown as GoogleGenAI);
    await expect(collect(provider.streamChat(request))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('reports text-less (thinking) chunks as activity', async () => {
    const generateContentStream = vi
      .fn()
      .mockResolvedValue(events({ text: undefined }, { text: 'answer' }));
    const provider = new GeminiProvider({
      models: { generateContentStream },
    } as unknown as GoogleGenAI);
    const onActivity = vi.fn();
    expect(
      await collect(provider.streamChat({ ...request, onActivity })),
    ).toEqual(['answer']);
    expect(onActivity).toHaveBeenCalledTimes(2);
  });
});
