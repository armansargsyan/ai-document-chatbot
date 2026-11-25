import {
  Body,
  Controller,
  HttpException,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ChatRequest, ChatStreamEvent } from '@ai-document-chatbot/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/token-verifier';
import {
  LlmRequestAbortedError,
  describeProviderError,
} from '../llm/llm-errors';
import { ChatRequestPipe } from './chat-request.schema';
import { ChatService } from './chat.service';

/**
 * Backpressure is ignored: answers are capped at 1024 output tokens, so the
 * buffered amount stays small. Await 'drain' if that limit grows a lot.
 */
function writeEvent(res: Response, event: ChatStreamEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  /**
   * Answers a question about the user's documents as server-sent events
   * (`delta`… then `done` with citations, or `error`). Validation, model and
   * retrieval failures happen before streaming and are normal HTTP errors.
   */
  @Post('stream')
  async stream(
    @CurrentUser() user: AuthUser,
    @Body(ChatRequestPipe) request: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    // Client went away before we finished: stop the upstream model call.
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    let prepared;
    try {
      prepared = await this.chat.prepare(user.uid, request, abort.signal);
    } catch (error) {
      // The client already disconnected: nothing to answer.
      if (error instanceof LlmRequestAbortedError) return;
      throw error;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const text of prepared.stream) {
        writeEvent(res, { type: 'delta', text });
      }
      writeEvent(res, {
        type: 'done',
        modelId: request.modelId,
        conversationId: request.conversationId ?? null,
        citations: prepared.citations,
      });
    } catch (error) {
      if (error instanceof LlmRequestAbortedError || abort.signal.aborted)
        return;
      const http =
        error instanceof HttpException
          ? error
          : new HttpException('The answer could not be completed', 500);
      if (!(error instanceof HttpException)) {
        this.logger.error(
          `Unexpected chat stream failure: ${describeProviderError(error)}`,
        );
      }
      writeEvent(res, {
        type: 'error',
        status: http.getStatus(),
        message: http.message,
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
}
