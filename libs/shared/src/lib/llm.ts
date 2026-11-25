export type LlmProviderId = 'openai' | 'anthropic' | 'gemini';

/**
 * Models the api accepts. Clients pick one per request by `id`; anything else
 * is rejected. Edit this list to add or retire models.
 */
export const LLM_MODELS = [
  { id: 'gpt-6.2-astra', provider: 'openai', label: 'GPT-6.2 Astra' },
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna' },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
  },
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5' },
  { id: 'gemini-4-argon', provider: 'gemini', label: 'Gemini 4 Argon' },
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
}

/** Response of `GET /api/models`. */
export interface LlmModelsResponse {
  models: LlmModelInfo[];
  defaultModelId: LlmModelId;
}
