import {
  HttpException,
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
import { limitError } from '../common/limit-errors';
import { ConversationsService } from '../conversations/conversations.service';
import { DocumentRepository } from '../documents/document.repository';
import {
  LlmRequestAbortedError,
  describeProviderError,
  toHttpException,
} from '../llm/llm-errors';
import { LlmService } from '../llm/llm.service';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import { UsageService } from '../usage/usage.service';
import {
  RetrievalService,
  assertSearchable,
  type RetrievedChunk,
} from '../retrieval/retrieval.service';
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
    private readonly documents: DocumentRepository,
    private readonly usage: UsageService,
    private readonly quota: ProviderQuotaTracker,
  ) {}

  /**
   * Everything that can fail before the first token, in order: model
   * availability (incl. a known exhausted provider), document search
   * availability, conversation ownership (404), the scoped document (404/409)
   * and the document list, the question quota (403), then retrieval. Throws
   * HttpExceptions, so the controller can still answer with a normal HTTP
   * error before the SSE stream starts. Nothing paid (embedding, model) runs
   * before these checks.
   *
   * The question is charged right before retrieval and refunded if the
   * request then fails before any answer text, unless the client left.
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
    if (this.quota.searchExhausted) throw limitError('search_quota_exhausted');

    // 404 for a conversation that isn't the caller's, before any paid call.
    const history = request.conversationId
      ? await this.conversations.history(uid, request.conversationId)
      : [];

    // One read serves both the prompt's document list and the scope check.
    let documents;
    try {
      documents = await this.documents.list(uid);
    } catch (error) {
      this.logger.warn(
        `Listing documents failed: ${describeProviderError(error)}`,
      );
      throw new ServiceUnavailableException('Document search is unavailable');
    }
    const { documentId } = request;
    if (documentId !== undefined) {
      assertSearchable(documents.find((doc) => doc.id === documentId));
    }

    // 403 question_limit_reached; from here on a failure refunds the question.
    await this.usage.reserveQuestion(uid);

    let chunks: RetrievedChunk[];
    let conversationId: string;
    try {
      chunks = await this.retrieve(uid, request.message, documentId);
      // The client left during retrieval: don't start (and pay for) a model call.
      if (signal.aborted) throw new LlmRequestAbortedError();
      conversationId = await this.conversations.recordUserMessage(
        uid,
        request.conversationId,
        request.message,
      );
    } catch (error) {
      if (!(error instanceof LlmRequestAbortedError) && !signal.aborted) {
        await this.usage.refundQuestion(uid);
      }
      throw error;
    }

    return {
      conversationId,
      citations: toCitations(chunks),
      stream: this.refundIfUnanswered(
        uid,
        signal,
        this.llm.streamChat({
          modelId: request.modelId,
          system: SYSTEM_PROMPT,
          messages: [
            ...normalizeHistory(history),
            {
              role: 'user',
              content: buildUserPrompt(request.message, chunks, {
                documents,
                scopedDocumentId: documentId,
              }),
            },
          ],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          signal,
        }),
      ),
    };
  }

  private async retrieve(
    uid: string,
    message: string,
    documentId: string | undefined,
  ) {
    try {
      return await this.retrieval.retrieve(uid, message, { documentId });
    } catch (error) {
      // 404/409: the scoped document went away or changed since the list.
      // 503 search_quota_exhausted: the embedder recognized the spend cap.
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Retrieval failed: ${describeProviderError(error)}`);
      // Only a rate limit is worth surfacing as-is; anything else (bad embedding
      // key, Firestore errors such as a missing vector index) means search is down.
      const status = (error as { status?: unknown })?.status;
      throw status === 429
        ? toHttpException(error)
        : new ServiceUnavailableException('Document search is unavailable');
    }
  }

  /**
   * Passes the answer through and refunds the question only when the provider
   * failed before streaming anything, with an error that means the call was
   * not billed: rate limited (429), provider failure (502) or unavailable /
   * out of quota (503). Empty answers, rejected or blocked prompts (400) and
   * timeouts (504) may have been billed, so they keep the charge; otherwise a
   * user could repeat such a prompt for free and drain the provider's budget.
   * No refund when the client aborted.
   */
  private async *refundIfUnanswered(
    uid: string,
    signal: AbortSignal,
    stream: AsyncIterable<string>,
  ): AsyncIterable<string> {
    let started = false;
    try {
      for await (const text of stream) {
        started = true;
        yield text;
      }
    } catch (error) {
      if (!started && !signal.aborted && isUnbilledFailure(error)) {
        await this.usage.refundQuestion(uid);
      }
      throw error;
    }
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

const UNBILLED_STATUSES = new Set([429, 502, 503]);

function isUnbilledFailure(error: unknown): boolean {
  return (
    error instanceof HttpException && UNBILLED_STATUSES.has(error.getStatus())
  );
}
