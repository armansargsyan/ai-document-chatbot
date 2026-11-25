import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AuthClient } from '../auth/auth-client';
import { AuthService } from '../auth/auth.service';
import { FakeAuthClient, TEST_CONFIG } from '../auth/testing/fake-auth-client';
import { ClientConfigService } from './client-config.service';

describe('ClientConfigService', () => {
  let client: FakeAuthClient;
  let service: ClientConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthClient, useValue: client },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(ClientConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the config from the api and starts auth with it', async () => {
    const done = service.load();
    expect(service.status()).toBe('loading');
    httpMock.expectOne('/api/config').flush(TEST_CONFIG);
    await done;

    expect(service.status()).toBe('ready');
    expect(client.config).toEqual(TEST_CONFIG);
  });

  it('reports unavailable (and lets guards proceed) when the api fails', async () => {
    const done = service.load();
    httpMock
      .expectOne('/api/config')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    await expect(done).resolves.toBeUndefined();

    expect(service.status()).toBe('unavailable');
    expect(TestBed.inject(AuthService).ready()).toBe(true);
    expect(client.config).toBeNull();
  });

  it('can retry after a failure and shares concurrent requests', async () => {
    const first = service.load();
    httpMock.expectOne('/api/config').error(new ProgressEvent('error'));
    await first;

    const a = service.load();
    const b = service.load();
    expect(a).toBe(b);
    httpMock.expectOne('/api/config').flush(TEST_CONFIG);
    await a;
    expect(service.status()).toBe('ready');
  });
});
