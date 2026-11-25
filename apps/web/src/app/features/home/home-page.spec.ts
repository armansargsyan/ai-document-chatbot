import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthClient } from '../../core/auth/auth-client';
import { AuthService } from '../../core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from '../../core/auth/testing/fake-auth-client';
import { HomePage } from './home-page';

describe('HomePage', () => {
  let client: FakeAuthClient;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [{ provide: AuthClient, useValue: client }, provideRouter([])],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
  });

  async function render() {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('greets the user by first name and links to Documents', async () => {
    client.emit(TEST_USER);
    const el = await render();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Welcome, Ada');
    const link = el.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toContain('Go to documents');
    expect(link?.getAttribute('href')).toBe('/documents');
  });

  it('falls back to a plain greeting without a display name', async () => {
    client.emit({ ...TEST_USER, displayName: null });
    const el = await render();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Welcome');
  });
});
