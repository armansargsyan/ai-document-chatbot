import type { LimitErrorCode } from './usage';
import type { LlmModelId } from './llm';

export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** Body of `POST /api/chat/stream`. */
export interface ChatRequest {
  message: string;
  modelId: LlmModelId;
  /** Existing conversation to continue (20-character id); omit to start a new one. */
  conversationId?: string;
  /**
   * Search only this document (20-character id, must be `ready`); omit to
   * search all of the user's documents. Unknown/other user's → 404, not ready → 409.
   */
  documentId?: string;
}

/** A retrieved excerpt the answer may cite as `[number]`. */
export interface Citation {
  number: number;
  documentId: string;
  documentName: string;
  /** 1-based page in the source PDF. */
  page: number;
  snippet: string;
}

/**
 * Server-sent events of `POST /api/chat/stream`. Each SSE message has
 * `event: <type>` and `data: <JSON of the event>`. A stream starts with one
 * `start` event and ends with exactly one `done` or `error` event.
 */
export type ChatStreamEvent =
  /**
   * First event: the conversation this turn is saved to (created now if none
   * was given). Lets a client that stops early keep using that conversation.
   */
  | { type: 'start'; conversationId: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      modelId: LlmModelId;
      /** The conversation this turn was saved to (newly created if none was given). */
      conversationId: string;
      /** Sources given to the model, numbered as referenced in the answer. */
      citations: Citation[];
    }
  | {
      type: 'error';
      status: number;
      message: string;
      /**
       * Machine-readable reason, e.g. `model_quota_exhausted` when the
       * provider's monthly cap is hit mid-request (after `start`).
       */
      code?: ChatErrorCode | LimitErrorCode;
      /**
       * Set when the turn was already saved to a conversation (e.g. a new one),
       * so a retry continues it instead of creating a duplicate.
       */
      conversationId?: string;
    };

/**
 * Machine-readable `code` on JSON errors from `POST /api/chat/stream` (body:
 * `{ statusCode, message, code? }`), so clients don't branch on message text.
 */
export type ChatErrorCode =
  'conversation_not_found' | 'document_not_found' | 'document_not_ready';
