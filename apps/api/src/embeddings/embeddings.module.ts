import { Global, Module } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/app-config.service';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import { Embedder, OpenAiEmbedder, QuotaTrackingEmbedder } from './embedder';

/**
 * Provides `Embedder`, or `null` when no OpenAI key is configured (callers
 * then answer 503). Inject with `@Inject(Embedder)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: Embedder,
      inject: [AppConfigService, ProviderQuotaTracker],
      useFactory: (
        config: AppConfigService,
        quota: ProviderQuotaTracker,
      ): Embedder | null => {
        const apiKey = config.llmApiKeys.openai;
        return apiKey
          ? new QuotaTrackingEmbedder(
              new OpenAiEmbedder(
                new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 }),
              ),
              quota,
            )
          : null;
      },
    },
  ],
  exports: [Embedder],
})
export class EmbeddingsModule {}
