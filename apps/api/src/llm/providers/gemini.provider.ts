import type { GoogleGenAI } from '@google/genai';
import type { ChatStreamRequest, LlmProvider } from '../llm-provider';

/** Gemini reports an invalid API key as HTTP 400 (INVALID_ARGUMENT / API_KEY_INVALID). */
const INVALID_KEY = /API_KEY_INVALID|API key not valid/i;

/** Google Gemini via the Gen AI SDK. */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';

  constructor(private readonly client: Pick<GoogleGenAI, 'models'>) {}

  async *streamChat(request: ChatStreamRequest): AsyncIterable<string> {
    try {
      const stream = await this.client.models.generateContentStream({
        model: request.model,
        contents: request.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: request.signal,
        },
      });
      for await (const chunk of stream) {
        request.onActivity?.();
        if (chunk.promptFeedback?.blockReason) {
          // A blocked prompt otherwise ends as an empty reply.
          throw Object.assign(new Error('Gemini blocked the prompt'), {
            status: 400,
          });
        }
        const text = chunk.text;
        if (text) yield text;
      }
    } catch (error) {
      const { status, message } = error as {
        status?: unknown;
        message?: unknown;
      };
      if (
        status === 400 &&
        typeof message === 'string' &&
        INVALID_KEY.test(message)
      ) {
        // Re-tag as an auth failure: a server misconfiguration, not a bad client request.
        throw Object.assign(new Error('Gemini rejected the API key'), {
          status: 401,
        });
      }
      throw error;
    }
  }
}
