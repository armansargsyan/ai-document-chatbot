/**
 * Returns `value` only if it is a safe in-app path to navigate to after
 * sign-in, otherwise null. Rejects absolute and protocol-relative URLs
 * (`https://evil.test`, `//evil.test`, `/\evil.test`), control characters and
 * the login page itself, so a crafted `returnUrl` can't cause an open redirect.
 */
export function safeReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^\/login(?:[/?#]|$)/.test(value)) return null;
  return value;
}
