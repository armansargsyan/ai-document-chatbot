import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from '../config/app-config.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { LlmModule } from '../llm/llm.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { DocumentsModule } from '../documents/documents.module';
import { ChatModule } from '../chat/chat.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ClientConfigModule } from '../client-config/client-config.module';

@Module({
  imports: [
    AppConfigModule,
    FirebaseModule,
    AuthModule,
    // After AuthModule: its global guard must run after authentication.
    RateLimitModule,
    LlmModule,
    EmbeddingsModule,
    DocumentsModule,
    ChatModule,
    ConversationsModule,
    ClientConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
