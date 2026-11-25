/** The authenticated caller, attached to the request by `FirebaseAuthGuard`. */
export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies a bearer ID token and returns the user it belongs to.
 * Rejects for any malformed, expired or wrongly signed token. Revocation is not
 * checked (it costs a network call per request), so a revoked token stays
 * valid until it expires (at most 1h).
 * Abstract class (not an interface) so it can be used as a DI token and
 * replaced with a fake in tests.
 */
export abstract class TokenVerifier {
  abstract verify(idToken: string): Promise<AuthUser>;
}
