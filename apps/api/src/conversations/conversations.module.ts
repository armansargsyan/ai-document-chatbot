import { Module } from '@nestjs/common';
import { ConversationRepository } from './conversation.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationRepository],
  exports: [ConversationsService],
})
export class ConversationsModule {}
