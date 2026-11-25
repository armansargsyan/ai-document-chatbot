import type { LlmModelId } from './llm';

export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** Body of `POST /api/chat/stream`. */
export interface ChatRequest {
  message: string;
  modelId: LlmModelId;
  /** Existing conversation to continue (20-character id); omit to start a new one. */
  conversationId?: string;
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
 * `event: <type>` and `data: <JSON of the event>`. A stream ends with exactly
 * one `done` or `error` event.
 */
export type ChatStreamEvent =
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
       * Set when the turn was already saved to a conversation (e.g. a new one),
       * so a retry continues it instead of creating a duplicate.
       */
      conversationId?: string;
    };
