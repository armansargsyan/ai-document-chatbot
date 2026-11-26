import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo } from '@ng-icons/lucide';
import type { UsageCounter } from '@ai-document-chatbot/shared';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { DemoUsage } from './demo-usage';
import { DEMO_RULES } from './limit-errors';

let nextId = 0;

export interface UsageItem {
  readonly key: 'documents' | 'uploads' | 'questions';
  readonly used: number;
  readonly limit: number;
  /** `documents` (singular for a limit of 1). */
  readonly noun: string;
  /** `2 of 3 documents` */
  readonly text: string;
  /** 0–100, for the meter. */
  readonly percent: number;
  readonly full: boolean;
}

const NOUNS: Record<UsageItem['key'], [string, string]> = {
  documents: ['document', 'documents'],
  uploads: ['upload', 'uploads'],
  questions: ['question', 'questions'],
};

function item(key: UsageItem['key'], counter: UsageCounter): UsageItem {
  const { used, limit } = counter;
  const noun = NOUNS[key][limit === 1 ? 0 : 1];
  return {
    key,
    used,
    limit,
    noun,
    text: `${used} of ${limit} ${noun}`,
    percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100,
    full: used >= limit,
  };
}

/**
 * "Demo usage: 2 of 3 documents · 4 of 6 uploads · 12 of 30 questions".
 * - `panel`: a bordered strip with small meters and the rules (Documents page)
 * - `inline`: one quiet line with an info popover for the rules (Chat page)
 *
 * Renders nothing until the usage has loaded (or if it never does).
 */
@Component({
  selector: 'app-demo-usage',
  imports: [NgIcon, HlmSkeletonImports],
  providers: [provideIcons({ lucideInfo })],
  templateUrl: './demo-usage-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class DemoUsageSummary {
  protected readonly demo = inject(DemoUsage);
  readonly layout = input<'panel' | 'inline'>('panel');

  protected readonly rules = DEMO_RULES;
  /** Unique per instance: both layouts can be on screen at once. */
  protected readonly rulesId = `demo-rules-${++nextId}`;

  protected readonly items = computed<readonly UsageItem[]>(() => {
    const usage = this.demo.usage();
    if (!usage) return [];
    return [
      item('documents', usage.documents),
      item('uploads', usage.uploads),
      item('questions', usage.questions),
    ];
  });

  /** The whole line as one sentence, for screen readers and tests. */
  protected readonly summary = computed(
    () =>
      `Demo usage: ${this.items()
        .map((i) => i.text)
        .join(' · ')}`,
  );
}
