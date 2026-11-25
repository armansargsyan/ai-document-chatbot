import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ChatRequest, Citation } from '@ai-document-chatbot/shared';
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
  citations: Citation[];
  stream: AsyncIterable<string>;
}

const MAX_OUTPUT_TOKENS = 1024;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly retrieval: RetrievalService,
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

    return {
      citations: toCitations(chunks),
      stream: this.llm.streamChat({
        modelId: request.modelId,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserPrompt(request.message, chunks) },
        ],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        signal,
      }),
    };
  }
}
