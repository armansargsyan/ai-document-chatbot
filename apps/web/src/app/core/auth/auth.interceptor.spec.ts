import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthClient } from './auth-client';
import { authInterceptor, needsIdToken } from './auth.interceptor';
import { AuthService } from './auth.service';
import { FakeAuthClient, TEST_CONFIG } from './testing/fake-auth-client';

describe('needsIdToken', () => {
  const base = 'https://app.example.com/';

  it.each([
    ['/api/x', true],
    ['/api/documents/1?x=1', true],
    ['https://app.example.com/api/auth/me', true],
    ['/api/config', false],
    ['/api/config/', false],
    ['/api/health', false],
    ['/api', false],
    ['/apix/y', false],
    ['/assets/logo.svg', false],
    ['https://evil.example.com/api/x', false],
    ['//evil.example.com/api/x', false],
  ])('%s -> %s', (url, expected) => {
    expect(needsIdToken(url, base)).toBe(expected);
  });
});

describe('authInterceptor', () => {
  let client: FakeAuthClient;
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthClient, useValue: client },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).start(TEST_CONFIG);
  });

  afterEach(() => httpMock.verify());

  async function send(url: string) {
    const response = firstValueFrom(http.get(url));
    // The token is fetched asynchronously before the request goes out.
    await new Promise((resolve) => setTimeout(resolve));
    const req = httpMock.expectOne(url);
    req.flush({});
    await response;
    return req.request;
  }

  it('adds the bearer token to /api requests', async () => {
    const request = await send('/api/x');
    expect(request.headers.get('Authorization')).toBe('Bearer test-id-token');
  });

  it.each(['/api/config', '/api/health'])(
    'does not add it to the public %s',
    async (url) => {
      const request = await send(url);
      expect(request.headers.has('Authorization')).toBe(false);
    },
  );

  it('does not add it to other origins', async () => {
    const request = await send('https://other.example.com/api/x');
    expect(request.headers.has('Authorization')).toBe(false);
  });

  it('sends no header when signed out', async () => {
    client.token = null;
    const request = await send('/api/x');
    expect(request.headers.has('Authorization')).toBe(false);
  });
});
