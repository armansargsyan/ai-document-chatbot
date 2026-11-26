export type LlmProviderId = 'openai' | 'anthropic' | 'gemini';

/**
 * Models the api accepts. Clients pick one per request by `id`; anything else
 * is rejected. Edit this list to add or retire models.
 */
export const LLM_MODELS = [
  // Demo: one cheap model per provider (each provider has a hard monthly cap).
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna' },
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5' },
  { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash' },
] as const satisfies readonly {
  id: string;
  provider: LlmProviderId;
  label: string;
}[];

export type LlmModel = (typeof LLM_MODELS)[number];
export type LlmModelId = LlmModel['id'];

export const DEFAULT_LLM_MODEL_ID: LlmModelId = 'claude-haiku-5-5';

export function isLlmModelId(value: unknown): value is LlmModelId {
  return LLM_MODELS.some((model) => model.id === value);
}

export function getLlmModel(id: LlmModelId): LlmModel {
  // Safe: LlmModelId is derived from LLM_MODELS.
  return LLM_MODELS.find((model) => model.id === id) as LlmModel;
}

/** One turn of a conversation sent to a model. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One entry of `GET /api/models`. `available` is false when the provider has no API key configured. */
export interface LlmModelInfo {
  id: LlmModelId;
  provider: LlmProviderId;
  label: string;
  available: boolean;
  /**
   * Why the model can't be used, when `available` is false: no API key on the
   * server, or the provider's monthly demo budget is used up.
   */
  unavailableReason?: 'not_configured' | 'quota_exhausted';
}

/** Response of `GET /api/models`. */
export interface LlmModelsResponse {
  models: LlmModelInfo[];
  defaultModelId: LlmModelId;
}
