import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideGithub,
  lucideGlobe,
  lucideLinkedin,
  lucideMail,
} from '@ng-icons/lucide';
import { OWNER_CONTACT_INFO, type OwnerContact } from './owner-contact';

export interface ContactLink {
  readonly key: 'email' | 'linkedin' | 'github' | 'website';
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  /** Opens in a new tab (everything but email). */
  readonly external: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only absolute http(s) URLs; anything else is treated as unset. */
function webUrl(value: string): string | null {
  const url = value.trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** The links worth rendering, in display order. Exported for tests. */
export function contactLinks(contact: OwnerContact): ContactLink[] {
  const links: ContactLink[] = [];
  const email = contact.email.trim();
  if (EMAIL.test(email)) {
    links.push({
      key: 'email',
      label: 'Email',
      href: `mailto:${email}`,
      icon: 'lucideMail',
      external: false,
    });
  }
  const web: [ContactLink['key'], string, string, string][] = [
    ['linkedin', 'LinkedIn', contact.linkedin, 'lucideLinkedin'],
    ['github', 'GitHub', contact.github, 'lucideGithub'],
    ['website', 'Website', contact.website, 'lucideGlobe'],
  ];
  for (const [key, label, value, icon] of web) {
    const href = webUrl(value);
    if (href) links.push({ key, label, href, icon, external: true });
  }
  return links;
}

/**
 * "Built by …" plus the owner's contact links, from {@link OWNER_CONTACT_INFO}.
 * Only fields that are set are shown; with none set it renders nothing.
 */
@Component({
  selector: 'app-owner-contact',
  imports: [NgIcon],
  providers: [
    provideIcons({ lucideGithub, lucideGlobe, lucideLinkedin, lucideMail }),
  ],
  template: `
    @if (visible) {
      <div class="text-xs text-muted-foreground" data-testid="owner-contact">
        @if (name || tagline) {
          <p data-testid="owner-byline">
            @if (name) {
              Built by
              <span class="font-medium text-foreground">{{ name }}</span>
            }
            @if (name && tagline) {
              <span aria-hidden="true"> · </span>
            }
            @if (tagline) {
              <span>{{ tagline }}</span>
            }
          </p>
        } @else {
          <p class="font-medium text-foreground">Contact the author</p>
        }
        @if (links.length) {
          <ul
            class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1"
            [attr.aria-label]="name ? 'Contact ' + name : 'Contact the author'"
          >
            @for (link of links; track link.key) {
              <li>
                <a
                  class="-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 font-medium text-foreground/80 underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:py-2"
                  [href]="link.href"
                  [attr.target]="link.external ? '_blank' : null"
                  [attr.rel]="link.external ? 'noopener noreferrer' : null"
                  [attr.aria-label]="
                    link.external
                      ? link.label + ' (opens in a new tab)'
                      : 'Email ' + (name || 'the author')
                  "
                  [attr.data-testid]="'contact-' + link.key"
                >
                  <ng-icon [name]="link.icon" size="14" aria-hidden="true" />
                  {{ link.label }}
                </a>
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
})
export class OwnerContactLinks {
  private readonly contact = inject(OWNER_CONTACT_INFO);

  // Static config: plain fields, no signals needed.
  protected readonly name = this.contact.name.trim();
  protected readonly tagline = this.contact.tagline.trim();
  protected readonly links = contactLinks(this.contact);
  protected readonly visible =
    !!this.name || !!this.tagline || this.links.length > 0;
}
