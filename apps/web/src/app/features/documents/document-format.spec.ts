import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { MAX_PDF_BYTES } from '@ai-document-chatbot/shared';
import {
  formatBytes,
  uploadErrorMessage,
  validatePdf,
} from './document-format';

function file(name: string, size: number, type = 'application/pdf'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function httpError(status: number, error: unknown = null) {
  return new HttpErrorResponse({
    status,
    error,
    headers: new HttpHeaders(),
    url: '/api/documents',
  });
}

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [812, '812 B'],
    [340 * 1024, '340 KB'],
    [2.4 * 1024 * 1024, '2.4 MB'],
    [MAX_PDF_BYTES, '10 MB'],
  ])('%d → %s', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

describe('validatePdf', () => {
  it('accepts a PDF by MIME type or by extension', () => {
    expect(validatePdf(file('a.pdf', 1000))).toBeNull();
    expect(validatePdf(file('scan', 1000, 'application/pdf'))).toBeNull();
    expect(validatePdf(file('REPORT.PDF', 1000, ''))).toBeNull();
  });

  it('rejects other types', () => {
    expect(validatePdf(file('notes.docx', 1000, 'application/msword'))).toBe(
      'Only PDF files can be uploaded.',
    );
    expect(validatePdf(file('photo.png', 1000, 'image/png'))).toContain(
      'Only PDF',
    );
  });

  it('rejects files over the limit and empty files', () => {
    expect(validatePdf(file('a.pdf', MAX_PDF_BYTES))).toBeNull();
    expect(validatePdf(file('big.pdf', MAX_PDF_BYTES + 1))).toBe(
      'This file is larger than 10 MB, the upload limit.',
    );
    expect(validatePdf(file('huge.pdf', 25 * 1024 * 1024))).toContain(
      'larger than 10 MB',
    );
    expect(validatePdf(file('empty.pdf', 0))).toBe('This file is empty.');
  });
});

describe('uploadErrorMessage', () => {
  const body = (message: unknown) => ({ statusCode: 0, message, error: 'X' });

  it.each([413, 415, 422, 429])('shows the server message for %d', (status) => {
    const message = `Server says ${status}.`;
    expect(uploadErrorMessage(httpError(status, body(message)))).toBe(message);
  });

  it('joins validation message arrays', () => {
    expect(uploadErrorMessage(httpError(400, body(['A.', 'B.'])))).toBe(
      'A. B.',
    );
  });

  it('falls back to friendly copy when a 4xx has no message', () => {
    expect(uploadErrorMessage(httpError(413))).toContain('too large');
    expect(uploadErrorMessage(httpError(415))).toContain('isn’t a PDF');
    expect(uploadErrorMessage(httpError(429, 'not json'))).toContain(
      'upload limit',
    );
  });

  it('never shows the server message for 5xx', () => {
    const leaky = body('OpenAI key missing at /srv/app/config.ts:12');
    const m503 = uploadErrorMessage(httpError(503, leaky));
    const m502 = uploadErrorMessage(httpError(502, leaky));
    const m500 = uploadErrorMessage(httpError(500, leaky));
    expect(m503).toBe(
      'Document processing is unavailable right now. Try again later.',
    );
    expect(m502).toContain('couldn’t finish processing');
    expect(m500).toContain('Something went wrong');
    for (const m of [m503, m502, m500]) expect(m).not.toContain('OpenAI');
  });

  it('handles network failures, expired sessions and unknown errors', () => {
    expect(uploadErrorMessage(httpError(0))).toContain('Check your connection');
    expect(uploadErrorMessage(httpError(401, body('Unauthorized')))).toContain(
      'session has expired',
    );
    expect(uploadErrorMessage(new Error('boom'))).toContain(
      'Something went wrong',
    );
  });
});
