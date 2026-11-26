import {
  DOCUMENT,
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import {
  isLlmModelId,
  type LlmModelId,
  type LlmModelInfo,
  type LlmModelsResponse,
  type LlmProviderId,
} from '@ai-document-chatbot/shared';

export const MODELS_URL = '/api/models';
/** localStorage key of the last model the user picked. */
export const MODEL_STORAGE_KEY = 'chat.modelId';

export const PROVIDER_LABELS: Record<LlmProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
};

export interface ModelGroup {
  provider: LlmProviderId;
  label: string;
  models: LlmModelInfo[];
}

/**
 * The model to preselect: the saved choice if it is still available, else the
 * server default if available, else the first available model; null if none.
 */
export function pickDefaultModel(
  response: LlmModelsResponse,
  saved: string | null,
): LlmModelId | null {
  const available = response.models.filter((m) => m.available);
  const has = (id: unknown) => available.some((m) => m.id === id);
  if (has(saved)) return saved as LlmModelId;
  if (has(response.defaultModelId)) return response.defaultModelId;
  return available[0]?.id ?? null;
}

/** Where the chosen model is remembered; null when storage is unavailable. */
export const MODEL_STORAGE = new InjectionToken<Pick<
  Storage,
  'getItem' | 'setItem'
> | null>('MODEL_STORAGE', {
  factory: () => {
    try {
      return inject(DOCUMENT).defaultView?.localStorage ?? null;
    } catch {
      return null; // storage blocked (private mode, sandboxed iframe)
    }
  },
});

/** The model list from `GET /api/models` and the current choice. Page-scoped. */
@Injectable()
export class ChatModels {
  readonly resource = httpResource<LlmModelsResponse>(() => MODELS_URL);

  private readonly response = computed(() =>
    this.resource.hasValue() ? this.resource.value() : null,
  );
  private readonly storage = inject(MODEL_STORAGE);
  /** The user's pick in this page (null until they change the select). */
  private readonly chosen = signal<LlmModelId | null>(null);

  readonly loading = computed(
    () => this.resource.isLoading() && !this.response(),
  );
  readonly loadFailed = computed(
    () => !!this.resource.error() && !this.response(),
  );
  /** Loaded, but no model can be used (no key configured, or out of budget). */
  readonly noneAvailable = computed(() => {
    const response = this.response();
    return !!response && !response.models.some((m) => m.available);
  });
  /** None is available and at least one is out of its monthly demo budget. */
  readonly noneAvailableQuota = computed(
    () =>
      this.noneAvailable() &&
      !!this.response()?.models.some(
        (m) => m.unavailableReason === 'quota_exhausted',
      ),
  );
  readonly someUnavailable = computed(
    () => !!this.response()?.models.some((m) => !m.available),
  );

  /** Models grouped by provider, in allow-list order. */
  readonly groups = computed<ModelGroup[]>(() => {
    const groups = new Map<LlmProviderId, ModelGroup>();
    for (const model of this.response()?.models ?? []) {
      let group = groups.get(model.provider);
      if (!group) {
        group = {
          provider: model.provider,
          label: PROVIDER_LABELS[model.provider] ?? model.provider,
          models: [],
        };
        groups.set(model.provider, group);
      }
      group.models.push(model);
    }
    return [...groups.values()];
  });

  /** The model the next message goes to; null while loading or if none is available. */
  readonly selectedId = computed<LlmModelId | null>(() => {
    const response = this.response();
    if (!response) return null;
    const chosen = this.chosen();
    if (chosen && response.models.some((m) => m.id === chosen && m.available)) {
      return chosen;
    }
    return pickDefaultModel(response, this.readSaved());
  });

  readonly selected = computed(
    () =>
      this.response()?.models.find((m) => m.id === this.selectedId()) ?? null,
  );

  select(id: string | null | undefined): void {
    if (!isLlmModelId(id)) return;
    const model = this.response()?.models.find((m) => m.id === id);
    if (!model?.available) return;
    this.chosen.set(id);
    try {
      this.storage?.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // Not remembered across visits; the choice still applies now.
    }
  }

  label(id: LlmModelId | null | undefined): string | null {
    if (!id) return null;
    return this.response()?.models.find((m) => m.id === id)?.label ?? null;
  }

  reload(): void {
    this.resource.reload();
  }

  /** The switcher's text for a model: its label, plus why it can't be picked. */
  optionLabel(model: LlmModelInfo): string {
    if (model.available) return model.label;
    return model.unavailableReason === 'quota_exhausted'
      ? `${model.label} (monthly demo limit reached)`
      : `${model.label} (unavailable)`;
  }

  /** Tooltip for an unavailable model; null when it can be picked. */
  optionTitle(model: LlmModelInfo): string | null {
    if (model.available) return null;
    const provider = PROVIDER_LABELS[model.provider] ?? model.provider;
    return model.unavailableReason === 'quota_exhausted'
      ? `${provider} has reached its demo limit for this month`
      : `No API key is configured for ${provider}`;
  }

  private readSaved(): string | null {
    try {
      return this.storage?.getItem(MODEL_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
