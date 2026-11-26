import { TestBed } from '@angular/core/testing';
import {
  OWNER_CONTACT,
  OWNER_CONTACT_INFO,
  type OwnerContact,
} from './owner-contact';
import { OwnerContactLinks, contactLinks } from './owner-contact-links';

const EMPTY: OwnerContact = {
  name: '',
  tagline: '',
  email: '',
  linkedin: '',
  github: '',
  website: '',
  source: '',
};

async function render(contact: OwnerContact) {
  TestBed.configureTestingModule({
    imports: [OwnerContactLinks],
    providers: [{ provide: OWNER_CONTACT_INFO, useValue: contact }],
  });
  const fixture = TestBed.createComponent(OwnerContactLinks);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('OwnerContactLinks', () => {
  it('renders nothing while no field is set', async () => {
    const el = await render(EMPTY);
    expect(el.querySelector('[data-testid="owner-contact"]')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('turns every set field of the shipped config into a valid link', () => {
    const set = Object.entries(OWNER_CONTACT).filter(
      ([key, value]) => value !== '' && key !== 'name' && key !== 'tagline',
    );
    expect(contactLinks(OWNER_CONTACT).map((l) => l.key)).toEqual(
      set.map(([key]) => key),
    );
  });

  it('renders only the fields that are set', async () => {
    const el = await render({
      ...EMPTY,
      name: 'Sam Example',
      github: 'https://github.example/sam',
    });
    expect(
      el.querySelector('[data-testid="owner-byline"]')?.textContent,
    ).toContain('Built by Sam Example');
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.dataset['testid'])).toEqual(['contact-github']);
    expect(links[0].getAttribute('href')).toBe('https://github.example/sam');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('aria-label')).toBe(
      'GitHub (opens in a new tab)',
    );
  });

  it('links email with mailto: in the same tab', async () => {
    const el = await render({ ...EMPTY, email: 'sam@example.com' });
    const mail = el.querySelector<HTMLAnchorElement>(
      '[data-testid="contact-email"]',
    );
    expect(mail?.getAttribute('href')).toBe('mailto:sam@example.com');
    expect(mail?.hasAttribute('target')).toBe(false);
    expect(mail?.getAttribute('aria-label')).toBe('Email the author');
    // No name: a generic heading instead of a byline.
    expect(el.textContent).toContain('Contact the author');
  });
});

describe('contactLinks', () => {
  it('drops values that are not a valid email or http(s) URL', () => {
    expect(
      contactLinks({
        ...EMPTY,
        email: 'not-an-email',
        linkedin: 'javascript:alert(1)',
        website: 'example.com',
      }),
    ).toEqual([]);
  });

  it('keeps the display order: email, LinkedIn, GitHub, website, source', () => {
    expect(
      contactLinks({
        ...EMPTY,
        source: 'https://s.example',
        website: 'https://w.example',
        email: 'a@b.co',
        linkedin: 'https://l.example',
        github: 'https://g.example',
      }).map((l) => l.key),
    ).toEqual(['email', 'linkedin', 'github', 'website', 'source']);
  });
});
