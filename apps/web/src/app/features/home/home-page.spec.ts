import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import type { MeResponse } from '@ai-document-chatbot/shared';
import { AuthClient } from '../../core/auth/auth-client';
import { AuthService } from '../../core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from '../../core/auth/testing/fake-auth-client';
import { HomePage } from './home-page';

const me: MeResponse = {
  uid: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  picture: 'https://example.com/ada.png',
};

describe('HomePage', () => {
  let client: FakeAuthClient;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        { provide: AuthClient, useValue: client },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
    client.emit(TEST_USER);
  });

  async function render(response: MeResponse = me) {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/me')
      .flush(response);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the name and avatar from /api/auth/me', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('Ada Lovelace');
    expect(
      el.querySelector<HTMLImageElement>('img[data-testid="avatar"]')?.src,
    ).toBe('https://example.com/ada.png');
  });

  it('falls back to an initial without a picture', async () => {
    const { el } = await render({ ...me, picture: null });
    expect(el.querySelector('img')).toBeNull();
    expect(
      el.querySelector('[data-testid="avatar"]')?.textContent?.trim(),
    ).toBe('A');
  });

  it('signs out (the App owns the redirect to /login)', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const { el, fixture } = await render();

    const signOut = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sign out'),
    );
    signOut?.click();
    await fixture.whenStable();

    expect(client.signOutCalls).toBe(1);
    expect(TestBed.inject(AuthService).isSignedIn()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a friendly message when sign-out fails', async () => {
    client.signOutError = Object.assign(
      new Error('auth/internal-error: raw details'),
      {
        code: 'auth/internal-error',
      },
    );
    const { el, fixture } = await render();

    const signOut = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sign out'),
    );
    signOut?.click();
    await fixture.whenStable();

    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Couldn’t sign you out');
    expect(el.textContent).not.toContain('raw details');
    expect(signOut?.hasAttribute('disabled')).toBe(false);
  });
});
