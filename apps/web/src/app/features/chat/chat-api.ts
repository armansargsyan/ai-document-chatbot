import { Injectable, InjectionToken, inject } from '@angular/core';
import type { ChatRequest, ChatStreamEvent } from '@ai-document-chatbot/shared';
import { AuthService } from '../../core/auth/auth.service';
import {
  CHAT_INTERRUPTED_MESSAGE,
  CHAT_NETWORK_MESSAGE,
  ChatError,
  chatErrorMessage,
  serverCode,
  serverMessage,
} from './chat-errors';
import { SseParser, toChatStreamEvent } from './sse-parser';

export const CHAT_STREAM_URL = '/api/chat/stream';

/**
 * `fetch`, injectable so tests never touch the network. The chat stream is
 * SSE over a POST, which `EventSource` can't send and the XHR-backed
 * HttpClient can't stream, so it uses `fetch` with a stream reader.
 */
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  factory: () => (input, init) => fetch(input, init),
});

function retryAfterSeconds(response: Response): number | null {
  const value = Number(response.headers.get('Retry-After'));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** Streams answers from `POST /api/chat/stream`. */
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly fetch = inject(FETCH);
  private readonly auth = inject(AuthService);

  /**
   * Yields `delta` events, then exactly one `done`. Throws a {@link ChatError}
   * (user-facing message) for a failure before streaming, an `error` event,
   * or a stream that ends without a result; rethrows the `AbortError` when
   * `signal` aborts.
   */
  async *stream(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent & { type: 'start' | 'delta' | 'done' }> {
    // The HttpClient interceptor doesn't see raw fetch: attach the token here.
    // A failed token refresh (e.g. offline) reads as a network problem.
    const token = await this.auth.idToken().catch(() => {
      throw new ChatError(0, CHAT_NETWORK_MESSAGE);
    });
    let response: Response;
    try {
      response = await this.fetch(CHAT_STREAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ChatError(0, chatErrorMessage(0, null));
    }

    if (!response.ok || !response.body) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Not JSON (a proxy page, say): fall back to generic copy.
      }
      const status = response.ok ? 500 : response.status;
      const code = serverCode(body);
      throw new ChatError(
        status,
        chatErrorMessage(
          status,
          serverMessage(body),
          retryAfterSeconds(response),
          code,
        ),
        undefined,
        code,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    // fetch errors the body on abort; cancelling too ends a pending read either way.
    const onAbort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (signal.aborted) throw error;
          throw new ChatError(0, CHAT_INTERRUPTED_MESSAGE);
        }
        // `stream: true` keeps a multi-byte character split across chunks intact.
        const text = chunk.done
          ? decoder.decode()
          : decoder.decode(chunk.value, { stream: true });
        const messages = chunk.done
          ? [...parser.push(text), ...parser.flush()]
          : parser.push(text);
        for (const message of messages) {
          const event = toChatStreamEvent(message);
          if (!event) continue; // malformed: skip it
          if (event.type === 'error') {
            throw new ChatError(
              event.status,
              chatErrorMessage(
                event.status,
                event.message || null,
                null,
                event.code,
              ),
              event.conversationId,
              event.code,
            );
          }
          yield event;
          if (event.type === 'done') return;
        }
        if (chunk.done) break;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      // Stops the download if the consumer leaves early (abort, done, error).
      reader.cancel().catch(() => undefined);
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new ChatError(0, CHAT_INTERRUPTED_MESSAGE);
  }
}
