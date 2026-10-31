// Side-effect import that scrubs ambient Nordus env before a module snapshots it (scripts/mcp-server.ts reads
// NORDUS_URL / NORDUS_PORT at evaluation). Import order is the contract: keep it above the module under test.
import { isAmbientNordusKey } from "./nordus-env.ts";

for (const key of Object.keys(process.env)) {
  if (isAmbientNordusKey(key)) delete process.env[key];
}
