import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthClient } from '../../core/auth/auth-client';
import {
  FakeAuthClient,
  TEST_CONFIG,
  firebaseError,
} from '../../core/auth/testing/fake-auth-client';
import { ClientConfigService } from '../../core/config/client-config.service';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  let client: FakeAuthClient;
  let httpMock: HttpTestingController;
  let fixture: ComponentFixture<LoginPage>;
  let el: HTMLElement;
  let navigateByUrl: MockInstance<Router['navigateByUrl']>;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        { provide: AuthClient, useValue: client },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  });

  afterEach(() => httpMock.verify());

  /** Creates the page after `/api/config` answers, as the app initializer would. */
  async function render(configOk = true) {
    const load = TestBed.inject(ClientConfigService).load();
    const req = httpMock.expectOne('/api/config');
    if (configOk) req.flush(TEST_CONFIG);
    else req.flush(null, { status: 503, statusText: 'Service Unavailable' });
    await load;
    client.emit(null);

    fixture = TestBed.createComponent(LoginPage);
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  const button = () =>
    el.querySelector<HTMLButtonElement>('[data-testid="google-sign-in"]');
  const alert = () => el.querySelector('[role="alert"]');
  const unavailable = () =>
    el.querySelector('[data-testid="config-unavailable"]');

  it('shows the app name, value proposition and Google button', async () => {
    await render();
    expect(el.textContent).toContain('AI Document Chatbot');
    expect(el.querySelector('h1')?.textContent).toContain('cite the page');
    expect(button()?.textContent).toContain('Continue with Google');
    expect(button()?.disabled).toBe(false);
  });

  it('signs in on click and navigates home', async () => {
    await render();
    button()?.click();
    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('returns to a safe returnUrl after sign-in', async () => {
    await render();
    fixture.componentRef.setInput('returnUrl', '/documents');
    button()?.click();
    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/documents');
  });

  it('ignores an unsafe returnUrl', async () => {
    await render();
    fixture.componentRef.setInput('returnUrl', '//evil.test');
    button()?.click();
    await fixture.whenStable();
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('is busy and disabled while the popup is open', async () => {
    let finish!: () => void;
    client.signInImpl = () => new Promise<void>((r) => (finish = r));
    await render();

    button()?.click();
    await fixture.whenStable();
    expect(button()?.disabled).toBe(true);
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(button()?.textContent).toContain('Waiting for Google');

    finish();
    await new Promise((resolve) => setTimeout(resolve)); // let sign-in settle
    await fixture.whenStable();
    expect(button()?.disabled).toBe(false);
    expect(button()?.textContent).toContain('Continue with Google');
  });

  it('announces a friendly error when sign-in fails', async () => {
    client.signInImpl = () =>
      Promise.reject(firebaseError('auth/network-request-failed'));
    await render();

    button()?.click();
    await fixture.whenStable();
    expect(alert()?.textContent).toContain('Check your connection');
    expect(alert()?.textContent).not.toContain('auth/');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows nothing when the user closes the popup', async () => {
    client.signInImpl = () =>
      Promise.reject(firebaseError('auth/popup-closed-by-user'));
    await render();

    button()?.click();
    await fixture.whenStable();
    expect(alert()?.textContent?.trim()).toBe('');
  });

  it('shows an unavailable state with a working retry when /api/config fails', async () => {
    await render(false);
    expect(button()).toBeNull();
    expect(unavailable()?.textContent).toContain(
      'Sign-in is temporarily unavailable',
    );

    unavailable()?.querySelector('button')?.click();
    httpMock.expectOne('/api/config').flush(TEST_CONFIG);
    await fixture.whenStable();

    expect(unavailable()).toBeNull();
    expect(button()?.disabled).toBe(false);
  });
});
