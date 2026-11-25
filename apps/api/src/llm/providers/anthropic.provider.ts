import type Anthropic from '@anthropic-ai/sdk';
import type { ChatStreamRequest, LlmProvider } from '../llm-provider';

/** Anthropic Claude via the Messages API. */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';

  constructor(private readonly client: Pick<Anthropic, 'messages'>) {}

  async *streamChat(request: ChatStreamRequest): AsyncIterable<string> {
    const stream = await this.client.messages.create(
      {
        model: request.model,
        system: request.system,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: request.maxOutputTokens,
        stream: true,
      },
      { signal: request.signal },
    );
    for await (const event of stream) {
      request.onActivity?.();
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
