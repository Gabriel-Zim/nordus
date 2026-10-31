// One connected Google account (Gmail, Calendar, Drive, Docs, Sheets) for a bot. The server passes the tokens in.
import { createGoogleClient, googleTools } from "./google-tools.ts";
import { serveStdioMcp } from "./stdio-mcp.ts";

const env = {
  account: process.env.GOOGLE_ACCOUNT ?? "",
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  refresh: process.env.GOOGLE_REFRESH_TOKEN ?? "",
  access: process.env.GOOGLE_ACCESS_TOKEN ?? "",
  expiresAt: Number(process.env.GOOGLE_EXPIRES_AT ?? 0) || 0,
};

serveStdioMcp("google", googleTools(createGoogleClient(env), env.account));
