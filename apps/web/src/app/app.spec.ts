import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the title and API status', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.tick();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/health')
      .flush({ status: 'ok', timestamp: new Date().toISOString() });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain(
      'AI Document Chatbot',
    );
    expect(el.querySelector('[data-testid="api-status"]')?.textContent).toBe(
      'ok',
    );
  });
});
