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
        // Keep the vendor `code` (e.g. `insufficient_quota`) so quota exhaustion is recognized.
        const code =
          event.type === 'error' ? event.code : event.response?.error?.code;
        throw Object.assign(new Error('OpenAI stream failed'), {
          status: streamFailureStatus(code),
          code: code ?? undefined,
        });
      }
    }
  }
}

/**
 * The request was already accepted (and may be billed) when a stream event
 * fails. Only a server error (502) or a rate limit (429) counts as unbilled;
 * anything else, e.g. `invalid_prompt`, is a 400 so the question isn't refunded.
 * Quota exhaustion is recognized by `code`, independent of this status.
 */
function streamFailureStatus(code: string | null | undefined): number {
  if (code === 'server_error') return 502;
  if (code === 'rate_limit_exceeded') return 429;
  return 400;
}
