import { TestBed } from '@angular/core/testing';
import {
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  Router,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { AuthClient } from './auth-client';
import { authGuard, guestGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { safeReturnUrl } from './return-url';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from './testing/fake-auth-client';

describe('safeReturnUrl', () => {
  it.each(['/', '/documents', '/c/abc?x=1#y'])('accepts %s', (url) => {
    expect(safeReturnUrl(url)).toBe(url);
  });

  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    'javascript:alert(1)',
    'documents',
    '/login',
    '/login?returnUrl=/x',
    '/\tevil',
    '',
    null,
    undefined,
    ['/x'],
  ])('rejects %j', (url) => {
    expect(safeReturnUrl(url)).toBeNull();
  });
});

describe('route guards', () => {
  let client: FakeAuthClient;
  let router: Router;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: client }, provideRouter([])],
    });
    router = TestBed.inject(Router);
    TestBed.inject(AuthService).start(TEST_CONFIG);
  });

  function runAuthGuard(url: string) {
    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  function runGuestGuard(returnUrl?: string) {
    const route = {
      queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
    } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      guestGuard(route, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  const serialize = (result: boolean | UrlTree) =>
    result instanceof UrlTree ? router.serializeUrl(result) : result;

  describe('authGuard', () => {
    it('waits for the initial auth state', async () => {
      let settled = false;
      const result = runAuthGuard('/').then((r) => {
        settled = true;
        return r;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      client.emit(TEST_USER);
      expect(await result).toBe(true);
    });

    it('redirects signed-out users to /login with the return URL', async () => {
      client.emit(null);
      expect(serialize(await runAuthGuard('/documents?x=1'))).toBe(
        '/login?returnUrl=%2Fdocuments%3Fx%3D1',
      );
    });

    it('omits returnUrl for the home page', async () => {
      client.emit(null);
      expect(serialize(await runAuthGuard('/'))).toBe('/login');
    });
  });

  describe('guestGuard', () => {
    it('lets signed-out users see /login', async () => {
      client.emit(null);
      expect(await runGuestGuard('/documents')).toBe(true);
    });

    it('sends signed-in users to returnUrl', async () => {
      client.emit(TEST_USER);
      expect(serialize(await runGuestGuard('/documents'))).toBe('/documents');
    });

    it.each(['https://evil.test', '//evil.test', '/\\evil.test'])(
      'ignores an unsafe returnUrl (%s)',
      async (returnUrl) => {
        client.emit(TEST_USER);
        expect(serialize(await runGuestGuard(returnUrl))).toBe('/');
      },
    );

    it('sends signed-in users home without returnUrl', async () => {
      client.emit(TEST_USER);
      expect(serialize(await runGuestGuard())).toBe('/');
    });
  });
});
