import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type ChatMessage,
  type Citation,
  type ConversationDetail,
  type ConversationSummary,
  type ListConversationsResponse,
  type LlmModelId,
} from '@ai-document-chatbot/shared';
import {
  ConversationGoneError,
  ConversationRepository,
  toSummary,
} from './conversation.repository';

/** Previous messages sent to the model as context. */
export const HISTORY_MESSAGES = 10;
const TITLE_FROM_MESSAGE_LENGTH = 60;

export function titleFromMessage(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  const title =
    chars.length > TITLE_FROM_MESSAGE_LENGTH
      ? `${chars.slice(0, TITLE_FROM_MESSAGE_LENGTH).join('').trimEnd()}…`
      : oneLine;
  // At most 61 code points, well under MAX_CONVERSATION_TITLE_LENGTH.
  return title || 'New conversation';
}

@Injectable()
export class ConversationsService {
  constructor(private readonly repository: ConversationRepository) {}

  list(uid: string): Promise<ListConversationsResponse> {
    return this.repository
      .list(uid)
      .then((conversations) => ({ conversations }));
  }

  async get(uid: string, id: string): Promise<ConversationDetail> {
    const record = await this.requireOwned(uid, id);
    const messages = await this.repository.listMessages(uid, id);
    return { ...toSummary(id, record), messages };
  }

  async rename(
    uid: string,
    id: string,
    title: string,
  ): Promise<ConversationSummary> {
    const record = await this.requireOwned(uid, id);
    await this.mapGone(this.repository.rename(uid, id, title));
    return toSummary(id, { ...record, title });
  }

  async remove(uid: string, id: string): Promise<void> {
    await this.requireOwned(uid, id);
    await this.repository.delete(uid, id);
  }

  /** Recent turns of an existing conversation, as model context (404 if not the caller's). */
  async history(uid: string, id: string): Promise<ChatMessage[]> {
    await this.requireOwned(uid, id);
    const recent = await this.repository.recentMessages(
      uid,
      id,
      HISTORY_MESSAGES,
    );
    return recent.map(({ role, content }) => ({ role, content }));
  }

  /** Records the user's turn, creating the conversation first if needed. Returns its id. */
  async recordUserMessage(
    uid: string,
    conversationId: string | undefined,
    content: string,
  ): Promise<string> {
    const now = new Date().toISOString();
    const message = {
      role: 'user' as const,
      content,
      createdAt: now,
      modelId: null,
      citations: [],
    };
    if (conversationId) {
      await this.mapGone(
        this.repository.addMessage(uid, conversationId, message),
      );
      return conversationId;
    }
    const id = this.repository.newId(uid);
    await this.repository.createWithMessage(
      uid,
      id,
      {
        title: titleFromMessage(content),
        createdAt: now,
        updatedAt: now,
      },
      message,
    );
    return id;
  }

  async recordAssistantMessage(
    uid: string,
    conversationId: string,
    answer: { content: string; modelId: LlmModelId; citations: Citation[] },
  ): Promise<void> {
    await this.mapGone(
      this.repository.addMessage(uid, conversationId, {
        role: 'assistant',
        createdAt: new Date().toISOString(),
        ...answer,
      }),
    );
  }

  /** A conversation deleted between our check and the write is a 404, not a 500. */
  private async mapGone<T>(write: Promise<T>): Promise<T> {
    try {
      return await write;
    } catch (error) {
      if (error instanceof ConversationGoneError) {
        throw new NotFoundException('Conversation not found');
      }
      throw error;
    }
  }

  private async requireOwned(uid: string, id: string) {
    // Paths are under users/{uid}, so another user's id simply doesn't exist here.
    const record = await this.repository.get(uid, id);
    if (!record) throw new NotFoundException('Conversation not found');
    return record;
  }
}
