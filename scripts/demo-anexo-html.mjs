// Demo local do anexo HTML embutido. Sobe o servidor e o cliente com uma pasta de dados temporaria e ISOLADA
// (HOME e NORDUS_DATA_DIR dentro de um mkdtemp), semeia uma conversa com uma mensagem de robo que anexa
// docs/exemplos/quadro-ideias.html e imprime a URL. Nunca toca em ~/.nordus nem em producao.
// Uso: node scripts/demo-anexo-html.mjs    (Ctrl+C encerra e apaga a pasta temporaria)
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = Number(process.env.DEMO_API_PORT || 8797);
const uiPort = Number(process.env.DEMO_UI_PORT || 5179);
const base = mkdtempSync(join(tmpdir(), "nordus-demo-html-"));
const home = join(base, "home");
const data = join(home, ".nordus");
const attachments = join(data, "attachments");
mkdirSync(attachments, { recursive: true, mode: 0o700 });

const botId = "estrategistadeconteudo";
const threadId = "estrategistadeconteudo-demo-thread";
const htmlName = `${randomUUID()}.html`;
copyFileSync(join(root, "docs", "exemplos", "quadro-ideias.html"), join(attachments, htmlName));
const msgId = "quadro-ideias-message";
const now = Date.now();

const hash = createHash("sha256").update("").digest("hex");
const selection = { instanceId: "ghost", model: "ghost-1" };
writeFileSync(join(data, "bots.json"), JSON.stringify([{
  id: botId, threadId, name: "ESTRATEGISTADECONTEUDO", title: "", description: "", soul: "", soulHash: hash, notifications: true,
  color: "purple", unread: false, modelSelection: selection, resumeCursors: {}, createdAt: 0,
  tasks: [{ threadId, title: "ESTRATEGISTADECONTEUDO", createdAt: 0, updatedAt: 0, resumeCursors: {}, modelSelection: selection, unread: false }],
}]));
writeFileSync(join(data, `messages-${threadId}.json`), JSON.stringify({
  activeLeafId: msgId,
  messages: [
    { id: "pedido", at: now - 60_000, parentId: null, role: "user", kind: "text", text: "Me traga três ideias de filme com storyboard." },
    {
      id: msgId, at: now - 30_000, parentId: "pedido", role: "bot", kind: "text",
      text: "Aqui está o quadro com as três ideias. Abra cada uma, escreva ou grave seus ajustes e envie de volta.",
      attachments: [{ kind: "file", path: join(attachments, htmlName), name: "quadro-ideias.html" }],
      from: { botId, name: "ESTRATEGISTADECONTEUDO", color: "purple" },
    },
  ],
}));

const env = { ...process.env, HOME: home, NORDUS_DATA_DIR: data, NORDUS_PORT: String(apiPort), NORDUS_WEBHOOK_PORT: String(apiPort + 1), NORDUS_UI_PORT: String(uiPort) };
const children = [
  spawn(process.execPath, ["--experimental-strip-types", "server/index.ts"], { cwd: root, env, stdio: "inherit" }),
  spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js")], { cwd: root, env, stdio: "inherit" }),
];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => { rmSync(base, { recursive: true, force: true }); process.exit(0); }, 800);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", () => stop());
console.log(`\nDemo isolada em ${base}\nConversa: http://127.0.0.1:${uiPort}/ (abra o robo ESTRATEGISTADECONTEUDO; no primeiro acesso clique em "Pular tour")\nAnexo direto: http://127.0.0.1:${uiPort}/api/threads/${threadId}/messages/${msgId}/file?html=1&name=${htmlName}\n`);
