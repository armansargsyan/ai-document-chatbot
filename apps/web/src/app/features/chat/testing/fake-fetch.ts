import type {
  ChatRequest,
  ChatStreamEvent,
  Citation,
  LlmModelsResponse,
} from '@ai-document-chatbot/shared';

/** One SSE message exactly as the api writes it. */
export function sse(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const CITATIONS: Citation[] = [
  {
    number: 1,
    documentId: 'doc-1',
    documentName: 'Lease agreement.pdf',
    page: 3,
    snippet: 'The tenant shall pay rent on the first day of each month.',
  },
  {
    number: 2,
    documentId: 'doc-2',
    documentName: 'House rules.pdf',
    page: 7,
    snippet: 'Quiet hours are from 10 pm to 7 am.',
  },
];

export const MODELS: LlmModelsResponse = {
  models: [
    {
      id: 'gpt-6.2-astra',
      provider: 'openai',
      label: 'GPT-6.2 Astra',
      available: true,
    },
    {
      id: 'claude-haiku-5-5',
      provider: 'anthropic',
      label: 'Claude Haiku 5.5',
      available: true,
    },
    {
      id: 'gemini-4-argon',
      provider: 'gemini',
      label: 'Gemini 4 Argon',
      available: false,
    },
  ],
  defaultModelId: 'claude-haiku-5-5',
};

/** A streamed response body the test writes to, chunk by chunk. */
export class StreamControl {
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private readonly encoder = new TextEncoder();
  readonly body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  private ended = false;

  /** Like a real fetch body: reading rejects once the request is aborted. */
  bindAbort(signal: AbortSignal | null | undefined): void {
    signal?.addEventListener('abort', () =>
      this.fail(new DOMException('The operation was aborted.', 'AbortError')),
    );
  }

  push(text: string): void {
    this.pushBytes(this.encoder.encode(text));
  }

  pushBytes(bytes: Uint8Array): void {
    if (!this.ended) this.controller.enqueue(bytes);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.controller.close();
  }

  fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.controller.error(error);
  }
}

type Handler = (init: RequestInit | undefined) => Promise<Response>;

/** Stand-in for `fetch`: records calls and answers with queued responses. */
export class FakeFetch {
  readonly calls: { url: string; init: RequestInit | undefined }[] = [];
  private readonly queue: Handler[] = [];

  readonly fn = ((input: RequestInfo | URL, init?: RequestInit) => {
    this.calls.push({ url: String(input), init });
    const next = this.queue.shift();
    if (!next) return Promise.reject(new Error('Unexpected fetch'));
    return next(init);
  }) as typeof fetch;

  /**
   * Queues a 200 `text/event-stream` response; returns its body control.
   * `ignoreAbort` mimics a body that doesn't error when the request aborts.
   */
  stream({ ignoreAbort = false } = {}): StreamControl {
    const control = new StreamControl();
    this.queue.push(async (init) => {
      if (!ignoreAbort) control.bindAbort(init?.signal);
      return new Response(control.body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    return control;
  }

  /** Queues a complete stream of these events. */
  events(...events: ChatStreamEvent[]): void {
    const control = this.stream();
    for (const event of events) control.push(sse(event));
    control.close();
  }

  json(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.queue.push(async () =>
      Response.json(body, { status, headers: { ...headers } }),
    );
  }

  networkError(): void {
    this.queue.push(() => Promise.reject(new TypeError('Failed to fetch')));
  }

  body(index = this.calls.length - 1): ChatRequest {
    return JSON.parse(String(this.calls[index].init?.body)) as ChatRequest;
  }

  header(name: string, index = this.calls.length - 1): string | null {
    return new Headers(this.calls[index].init?.headers).get(name);
  }
}

/** In-memory stand-in for `localStorage`. */
export class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}
