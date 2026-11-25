/** Public Firebase web-app config. Not secret: Firebase web config is public by design. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string | null;
}

/** Response of the public `GET /api/config`, loaded by the web app at startup. */
export interface ClientConfigResponse {
  firebase: FirebaseWebConfig;
  /** Set only in local development, e.g. `http://127.0.0.1:9099`. */
  authEmulatorUrl: string | null;
}
