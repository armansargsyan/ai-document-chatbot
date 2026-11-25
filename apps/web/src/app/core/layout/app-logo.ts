import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The product mark: a page with a highlighted (cited) line. Decorative. */
@Component({
  selector: 'app-logo',
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="size-full text-foreground" viewBox="0 0 28 28" fill="none">
      <path
        d="M7 3.5h10l6 6V22a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 5 22V6a2.5 2.5 0 0 1 2-2.5Z"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linejoin="round"
      />
      <path
        d="M17 3.5V8a1.5 1.5 0 0 0 1.5 1.5H23"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linejoin="round"
      />
      <rect
        x="8.5"
        y="14"
        width="11"
        height="3.5"
        rx="1"
        class="fill-chart-4 dark:fill-chart-3"
      />
      <path
        d="M9 20.5h7"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class AppLogo {}
