import type OpenAI from 'openai';
import type { ChatStreamRequest, LlmProvider } from '../llm-provider';

/** OpenAI via the Responses API. */
export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai';

  constructor(private readonly client: Pick<OpenAI, 'responses'>) {}

  async *streamChat(request: ChatStreamRequest): AsyncIterable<string> {
    const stream = await this.client.responses.create(
      {
        model: request.model,
        instructions: request.system,
        input: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_output_tokens: request.maxOutputTokens,
        store: false,
        stream: true,
      },
      { signal: request.signal },
    );
    for await (const event of stream) {
      request.onActivity?.();
      if (event.type === 'response.output_text.delta') {
        yield event.delta;
      } else if (event.type === 'error' || event.type === 'response.failed') {
        throw Object.assign(new Error('OpenAI stream failed'), { status: 502 });
      }
    }
  }
}
