import { InjectionToken } from '@angular/core';

/**
 * Who built this demo and how to reach them. Shown on the login page and in
 * the app's "About this demo" panel. Leave a field empty to hide it; with
 * every field empty, nothing is shown.
 */
export interface OwnerContact {
  /** e.g. `Jane Doe` */
  readonly name: string;
  /** One short line, e.g. `Frontend engineer`. */
  readonly tagline: string;
  /** Plain address; rendered as a `mailto:` link. */
  readonly email: string;
  /** Full `https://` URLs. */
  readonly linkedin: string;
  readonly github: string;
  readonly website: string;
  /** This project's public repository. */
  readonly source: string;
}

/** The owner's details (public on purpose). Empty fields are hidden. */
export const OWNER_CONTACT: OwnerContact = {
  name: 'Arman Sargsyan',
  tagline: 'Full-Stack & AI Engineer',
  email: 'armansargsyan9991@gmail.com',
  linkedin: 'https://www.linkedin.com/in/arman-sargsyan-a12a17153/',
  github: 'https://github.com/armansargsyan',
  website: '',
  source: 'https://github.com/armansargsyan/ai-document-chatbot',
};

/** Injectable so tests can supply values; defaults to {@link OWNER_CONTACT}. */
export const OWNER_CONTACT_INFO = new InjectionToken<OwnerContact>(
  'OWNER_CONTACT_INFO',
  { factory: () => OWNER_CONTACT },
);
