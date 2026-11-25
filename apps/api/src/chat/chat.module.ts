import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [LlmModule, RetrievalModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
