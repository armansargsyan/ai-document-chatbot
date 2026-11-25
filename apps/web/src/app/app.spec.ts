import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { AuthClient } from './core/auth/auth-client';
import { AuthService } from './core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from './core/auth/testing/fake-auth-client';

describe('App', () => {
  let client: FakeAuthClient;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: AuthClient, useValue: client }, provideRouter([])],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
  });

  it('renders only the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('router-outlet')).not.toBeNull();
    expect(el.children).toHaveLength(1);
  });

  it('goes to /login when the session ends while the app is open', async () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    client.emit(TEST_USER);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();

    client.emit(null); // e.g. signed out in another tab
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not redirect when the app starts signed out (guards handle that)', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    client.emit(null);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
  });
});
