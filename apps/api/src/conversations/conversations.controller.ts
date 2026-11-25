import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  type ConversationDetail,
  type ConversationSummary,
  type ListConversationsResponse,
  type RenameConversationRequest,
} from '@ai-document-chatbot/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/token-verifier';
import { FirestoreIdPipe } from '../common/firestore-id.pipe';
import { ConversationsService } from './conversations.service';

const renameSchema = z
  .object({
    title: z
      .string({ error: 'title must be a string' })
      .trim()
      .min(1, { error: 'title must not be empty' })
      .max(MAX_CONVERSATION_TITLE_LENGTH, {
        error: `title must be at most ${MAX_CONVERSATION_TITLE_LENGTH} characters`,
      }),
  })
  .strict() satisfies z.ZodType<RenameConversationRequest>;

class RenamePipe implements PipeTransform<unknown, RenameConversationRequest> {
  transform(value: unknown): RenameConversationRequest {
    const result = renameSchema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((i) =>
          i.code === 'unrecognized_keys'
            ? 'Unexpected fields in request'
            : i.message,
        ),
      );
    }
    return result.data;
  }
}

const ConversationId = new FirestoreIdPipe('Conversation not found');

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ListConversationsResponse> {
    return this.conversations.list(user.uid);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ConversationId) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.get(user.uid, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ConversationId) id: string,
    @Body(RenamePipe) body: RenameConversationRequest,
  ): Promise<ConversationSummary> {
    return this.conversations.rename(user.uid, id, body.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ConversationId) id: string,
  ): Promise<void> {
    return this.conversations.remove(user.uid, id);
  }
}
