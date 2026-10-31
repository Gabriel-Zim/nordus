#!/usr/bin/env node
// Nordus: raio-x das saídas de internet dos robôs (proxy residencial e Mac de casa), para rodar por cron ou systemd timer
// (veja o LEIA-ME.md). Usa o NORDUS_DATA_DIR (padrão ~/.nordus), lê browserEngine.egress do config.json e o arquivo de
// segredos dos proxies (NORDUS_PROXY_FILE). Imprime uma linha por saída, sem usuário nem senha. Sai com 1 se alguma piorou.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { runExitHealth } from "../../server/browser/egress/exit-health.ts";
import { createHomeLink, parseHomeAddress } from "../../server/browser/egress/home-link.ts";
import { ProxyPool } from "../../server/browser/egress/proxy-pool.ts";

const dataDir = process.env.NORDUS_DATA_DIR ?? join(homedir(), ".nordus");
let egress;
try { egress = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"))?.browserEngine?.egress; } catch { egress = undefined; }

const exits = [...new ProxyPool().exits()];
const address = parseHomeAddress(egress?.home?.address);
if (address) {
  const link = createHomeLink(address);
  exits.unshift({ name: "casa", kind: "home", label: "casa", upstream: link.upstream, state: () => link.state(), resting: () => link.resting(), probe: () => link.probe() });
}
if (!exits.length) { console.log("Nenhuma saída configurada."); process.exit(0); }

const checks = await runExitHealth({ exits, dataDir });
for (const check of checks) {
  console.log(`${check.name}: ${check.up ? "no ar" : "FORA"}${check.ip ? ` ip ${check.ip}` : ""}${check.city ? ` ${check.city}` : ""}${check.asn ? ` ${check.asn}` : ""}${check.page !== undefined ? ` página ${check.page}` : ""}${check.reasons.length ? ` | piorou: ${check.reasons.join("; ")}` : ""}`);
}
process.exit(checks.some((check) => check.worse) ? 1 : 0);
