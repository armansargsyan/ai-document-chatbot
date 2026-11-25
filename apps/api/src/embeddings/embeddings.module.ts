import { Global, Module } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';
import { Embedder, OpenAiEmbedder } from './embedder';

/**
 * Provides `Embedder`, or `null` when no OpenAI key is configured (callers
 * then answer 503). Inject with `@Inject(Embedder)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: Embedder,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Embedder | null => {
        const apiKey = config.llmApiKeys.openai;
        return apiKey
          ? new OpenAiEmbedder(
              new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 }),
            )
          : null;
      },
    },
  ],
  exports: [Embedder],
})
export class EmbeddingsModule {}
