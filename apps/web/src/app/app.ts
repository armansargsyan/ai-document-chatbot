import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterOutlet } from '@angular/router';
import type { HealthResponse } from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmButtonImports],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly health = httpResource<HealthResponse>(() => '/api/health');

  protected readonly apiStatus = computed(() => {
    if (this.health.isLoading()) return 'checking…';
    if (this.health.error()) return 'unreachable';
    return this.health.value()?.status ?? 'unknown';
  });
}
