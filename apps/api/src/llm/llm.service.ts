import {
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODELS,
  getLlmModel,
  isLlmModelId,
  type ChatMessage,
  type LlmModelsResponse,
} from '@ai-document-chatbot/shared';
import { LLM_PROVIDERS, type LlmProvider } from './llm-provider';
import {
  LlmRequestAbortedError,
  describeProviderError,
  isAbortLike,
  toHttpException,
} from './llm-errors';

export interface StreamChatOptions {
  /** Model id from the shared allow-list. */
  modelId: string;
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
/**
 * Max wait for the first upstream event (any kind, including reasoning or
 * thinking progress). Once the response has started, there is no cap. Generous
 * because Gemini may send its first chunk only after it finishes thinking.
 */
export const FIRST_TOKEN_TIMEOUT_MS = 120_000;

/** Picks the provider for a model from the allow-list and streams its reply. */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: ReadonlyMap<string, LlmProvider>;

  constructor(@Inject(LLM_PROVIDERS) providers: LlmProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  /** Throws 400 for a model outside the allow-list, 503 if its provider has no key. */
  assertAvailable(modelId: string): void {
    this.resolve(modelId);
  }

  private resolve(modelId: string) {
    if (!isLlmModelId(modelId)) {
      throw new BadRequestException('Unknown model');
    }
    const model = getLlmModel(modelId);
    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new ServiceUnavailableException(
        'The selected model is unavailable',
      );
    }
    return { model, provider };
  }

  listModels(): LlmModelsResponse {
    return {
      models: LLM_MODELS.map((m) => ({
        id: m.id,
        provider: m.provider,
        label: m.label,
        available: this.providers.has(m.provider),
      })),
      defaultModelId: DEFAULT_LLM_MODEL_ID,
    };
  }

  /**
   * Streams text deltas. Validation errors are thrown on the first iteration,
   * before any upstream call. Vendor errors are mapped to HttpExceptions with
   * generic messages; no upstream activity within FIRST_TOKEN_TIMEOUT_MS is a 504.
   * If `options.signal` aborted, throws `LlmRequestAbortedError` instead.
   */
  async *streamChat(options: StreamChatOptions): AsyncIterable<string> {
    const { model, provider } = this.resolve(options.modelId);

    // Our own time-to-first-token limit, distinguishable from the caller's abort.
    const firstToken = new AbortController();
    const timer = setTimeout(() => firstToken.abort(), FIRST_TOKEN_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, firstToken.signal])
      : firstToken.signal;

    try {
      for await (const delta of provider.streamChat({
        model: model.id,
        system: options.system,
        messages: options.messages,
        maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        signal,
        onActivity: () => clearTimeout(timer),
      })) {
        yield delta;
      }
    } catch (error) {
      if (options.signal?.aborted) throw new LlmRequestAbortedError();
      const mapped =
        firstToken.signal.aborted && isAbortLike(error)
          ? new GatewayTimeoutException('The model provider timed out')
          : toHttpException(error);
      this.logger.warn(
        `${model.provider} request failed: ${describeProviderError(error)}`,
      );
      throw mapped;
    } finally {
      clearTimeout(timer);
    }
  }
}
