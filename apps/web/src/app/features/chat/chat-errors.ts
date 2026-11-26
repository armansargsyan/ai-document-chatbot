import type {
  ChatErrorCode,
  LimitErrorCode,
} from '@ai-document-chatbot/shared';
import { LIMIT_MESSAGES, limitErrorCode } from '../../core/usage/limit-errors';

/** A chat-specific or demo-limit reason from the api (JSON body or SSE `error`). */
export type ChatFailureCode = ChatErrorCode | LimitErrorCode;

export const CHAT_NETWORK_MESSAGE =
  'Couldn’t reach the server. Check your connection and try again.';
export const CHAT_SERVER_MESSAGE =
  'Something went wrong on our side. Try again in a moment.';
export const CHAT_UNAVAILABLE_MESSAGE =
  'The assistant is unavailable right now. Try again later, or pick another model.';
export const CHAT_INTERRUPTED_MESSAGE =
  'The answer was interrupted. Try again.';
export const CHAT_SESSION_MESSAGE = 'Your session has expired. Sign in again.';

/** A chat request that failed before or while streaming, with user-facing copy. */
export class ChatError extends Error {
  constructor(
    /** HTTP status; 0 for network failures. */
    readonly status: number,
    message: string,
    /** Set when the turn was saved to a conversation anyway (retry continues it). */
    readonly conversationId?: string,
    /** The api's machine-readable reason, when it sent one. */
    readonly code?: ChatFailureCode,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

const CHAT_ERROR_CODES: readonly ChatErrorCode[] = [
  'conversation_not_found',
  'document_not_found',
  'document_not_ready',
];

/**
 * The api's `{ code }` (a {@link ChatErrorCode} or a demo
 * {@link LimitErrorCode}), if it's a known one.
 */
export function serverCode(body: unknown): ChatFailureCode | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return undefined;
  }
  const { code } = body as { code: unknown };
  return CHAT_ERROR_CODES.find((c) => c === code) ?? limitErrorCode(body);
}

/** The api's `{ message }` (Nest error body), if it's a usable string. */
export function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }
  const { message } = body as { message: unknown };
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
    return message.join(' ') || null;
  }
  return null;
}

/**
 * Maps a failed chat request to inline copy. 4xx: the server's message (it is
 * written for users, e.g. the rate-limit wait). 5xx / network: generic copy;
 * never raw error details.
 */
export function chatErrorMessage(
  status: number,
  message: string | null,
  retryAfterSeconds: number | null = null,
  code?: ChatFailureCode,
): string {
  if (status === 0) return CHAT_NETWORK_MESSAGE;
  // Monthly provider budgets: fixed copy, whatever the status or message.
  if (code === 'model_quota_exhausted' || code === 'search_quota_exhausted') {
    return LIMIT_MESSAGES[code];
  }
  if (status === 401) return CHAT_SESSION_MESSAGE;
  if (status >= 400 && status < 500) {
    if (message) return message;
    if (code && code in LIMIT_MESSAGES) {
      return LIMIT_MESSAGES[code as LimitErrorCode];
    }
    switch (status) {
      case 404:
        return 'This conversation no longer exists. Start a new chat.';
      case 429:
        return retryAfterSeconds
          ? `You’re sending messages too quickly. Try again in ${retryAfterSeconds} seconds.`
          : 'You’re sending messages too quickly. Try again in a moment.';
      default:
        return 'This message couldn’t be sent.';
    }
  }
  if (status === 503) return CHAT_UNAVAILABLE_MESSAGE;
  return CHAT_SERVER_MESSAGE;
}
