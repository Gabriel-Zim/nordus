export interface Env {
  DB: D1Database;
  /** https://conta.nordus.ai */
  ORIGIN: string;
  /** The zone the addresses live under: name.DOMAIN */
  DOMAIN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  GOOGLE_CLIENT_ID: string;
  MAX_PER_ACCOUNT: string;
  /** Secrets (wrangler secret put). */
  CF_API_TOKEN: string;
  GOOGLE_CLIENT_SECRET: string;
  ID_TOKEN_KEY: string;
}
