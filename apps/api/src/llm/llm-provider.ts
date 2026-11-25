import type { ChatMessage, LlmProviderId } from '@ai-document-chatbot/shared';

export interface ChatStreamRequest {
  /** Provider-specific model id, already checked against the allow-list. */
  model: string;
  /** System prompt / instructions. */
  system?: string;
  /** Conversation so far, oldest first; the last message is the user's turn. */
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** Aborts the upstream request (e.g. when the client disconnects). */
  signal?: AbortSignal;
  /**
   * Called on every upstream event or chunk, including non-text ones (e.g.
   * reasoning/thinking progress), so callers know the response has started.
   */
  onActivity?: () => void;
}

/**
 * One LLM vendor behind a common streaming interface. Adapters yield text
 * deltas as they arrive and throw the vendor's own errors; `LlmService`
 * maps those to HTTP errors.
 */
export interface LlmProvider {
  readonly id: LlmProviderId;
  streamChat(request: ChatStreamRequest): AsyncIterable<string>;
}

/** DI token for the providers that have an API key configured. */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
