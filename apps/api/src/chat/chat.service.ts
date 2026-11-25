import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ChatMessage,
  ChatRequest,
  Citation,
  LlmModelId,
} from '@ai-document-chatbot/shared';
import { ConversationsService } from '../conversations/conversations.service';
import {
  LlmRequestAbortedError,
  describeProviderError,
  toHttpException,
} from '../llm/llm-errors';
import { LlmService } from '../llm/llm.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { SYSTEM_PROMPT, buildUserPrompt, toCitations } from './prompt';

/** A ready-to-stream answer: retrieval is done, the model call starts on iteration. */
export interface PreparedChat {
  conversationId: string;
  citations: Citation[];
  stream: AsyncIterable<string>;
}

/**
 * Providers want alternating turns starting with the user. History can break
 * that (e.g. an earlier answer failed, leaving two user turns in a row), so
 * merge consecutive same-role turns and drop a leading assistant turn.
 */
export function normalizeHistory(history: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const original of history) {
    // Old `[n]` markers pointed at earlier excerpts; the new prompt renumbers from 1.
    // Only assistant turns carry them; user text (e.g. code like `arr[0]`) is kept.
    const content = (
      original.role === 'assistant'
        ? original.content.replace(/\s*\[\d+\]/g, '')
        : original.content
    ).trim();
    if (!content) continue; // providers reject empty turns
    const message = { role: original.role, content };
    const last = merged.at(-1);
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
  }
  if (merged[0]?.role === 'assistant') merged.shift();
  // The new user turn follows, so history must end with an assistant turn.
  if (merged.at(-1)?.role === 'user') merged.pop();
  return merged;
}

const MAX_OUTPUT_TOKENS = 1024;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly retrieval: RetrievalService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Everything that can fail before the first token: model availability and
   * retrieval. Throws HttpExceptions, so the controller can still answer with
   * a normal HTTP error before the SSE stream starts.
   */
  async prepare(
    uid: string,
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<PreparedChat> {
    this.llm.assertAvailable(request.modelId);
    if (!this.retrieval.available) {
      throw new ServiceUnavailableException('Document search is unavailable');
    }

    // 404 for a conversation that isn't the caller's, before any paid call.
    const history = request.conversationId
      ? await this.conversations.history(uid, request.conversationId)
      : [];

    let chunks;
    try {
      chunks = await this.retrieval.retrieve(uid, request.message);
    } catch (error) {
      this.logger.warn(`Retrieval failed: ${describeProviderError(error)}`);
      // Only a rate limit is worth surfacing as-is; anything else (bad embedding
      // key, Firestore errors such as a missing vector index) means search is down.
      const status = (error as { status?: unknown })?.status;
      throw status === 429
        ? toHttpException(error)
        : new ServiceUnavailableException('Document search is unavailable');
    }
    // The client left during retrieval: don't start (and pay for) a model call.
    if (signal.aborted) throw new LlmRequestAbortedError();

    const conversationId = await this.conversations.recordUserMessage(
      uid,
      request.conversationId,
      request.message,
    );

    return {
      conversationId,
      citations: toCitations(chunks),
      stream: this.llm.streamChat({
        modelId: request.modelId,
        system: SYSTEM_PROMPT,
        messages: [
          ...normalizeHistory(history),
          { role: 'user', content: buildUserPrompt(request.message, chunks) },
        ],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        signal,
      }),
    };
  }

  /** Saves the finished answer to the conversation. */
  complete(
    uid: string,
    prepared: PreparedChat,
    answer: { content: string; modelId: LlmModelId },
  ): Promise<void> {
    return this.conversations.recordAssistantMessage(
      uid,
      prepared.conversationId,
      {
        ...answer,
        citations: prepared.citations,
      },
    );
  }
}
