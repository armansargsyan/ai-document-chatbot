import type { Citation } from './chat';
import type { LlmModelId } from './llm';

export const MAX_CONVERSATION_TITLE_LENGTH = 100;

/** A conversation in the history sidebar. Timestamps are ISO 8601. */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  /** Time of the latest message; lists are ordered by this, newest first. */
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Model that wrote an assistant message; null for user messages. */
  modelId: LlmModelId | null;
  /** Sources an assistant message cites as `[n]`; empty for user messages. */
  citations: Citation[];
}

/** Response of `GET /api/conversations/:id`: messages oldest first. */
export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

/** Response of `GET /api/conversations`. */
export interface ListConversationsResponse {
  conversations: ConversationSummary[];
}

/** Body of `PATCH /api/conversations/:id`. */
export interface RenameConversationRequest {
  title: string;
}
