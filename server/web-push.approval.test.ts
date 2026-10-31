import { createECDH } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { Notification } from "../shared/notification.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { decryptPush as decrypt } from "./testing/web-push-receiver.ts";
import { createWebPush, pushPayload, subscriptionInput, type PushDecoration } from "./web-push.ts";

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "nordus-web-push-approval-")); });
afterEach(async () => { await removeTempDir(dataDir); });

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const receiverAuth = Buffer.alloc(16, 7);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const subscription = (endpoint: string) => subscriptionInput.parse({
  subscription: { endpoint, keys: { p256dh: b64(receiver.getPublicKey()), auth: b64(receiverAuth) } }, finished: true, sounds: true,
});
const approval: Notification = {
  kind: "approval", botId: "atlas", botName: "Atlas", threadId: "t-atlas", title: "Atlas precisa de você", body: "Aprovar?", requestId: "req-1",
};
const decoration: PushDecoration = {
  title: "Atlas quer voltar produção para a v2.14.3",
  body: "Desfaz o deploy das 14h02. Pediu a Rafael.",
  actions: [{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }, { action: "extra", title: "Mais" }],
  approval: { id: "t-atlas.m1", token: "one-tap", done: { approve: "Aprovado por você · enviado", decline: "Recusado por você" } },
};

it("restyles a banner and adds the two buttons, never a third", () => {
  const payload = pushPayload(approval, { sounds: true }, decoration);
  expect(payload).toMatchObject({
    title: "Atlas quer voltar produção para a v2.14.3",
    body: "Desfaz o deploy das 14h02. Pediu a Rafael.",
    actions: [{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }],
    approval: { id: "t-atlas.m1", token: "one-tap" },
    botId: "atlas",
    threadId: "t-atlas",
    requestId: "req-1",
  });
});

it("sends a banner without buttons or token as it always did when there is nothing to decorate", () => {
  const plain = pushPayload(approval, { sounds: true });
  expect(plain).not.toHaveProperty("actions");
  expect(plain).not.toHaveProperty("approval");
  expect(plain).toMatchObject({ title: "Atlas precisa de você", body: "Aprovar?" });
  const onlyText = pushPayload(approval, { sounds: true }, { title: "Outro título" });
  expect(onlyText).toMatchObject({ title: "Outro título", body: "Aprovar?" });
  expect(onlyText).not.toHaveProperty("actions");
});

it("asks for the decoration once per device and sends each device its own token", async () => {
  const seen: string[] = [];
  const sent: Uint8Array[] = [];
  const webPush = createWebPush({
    dataDir,
    subject: "https://nordus.ai",
    fetch: async (_url, init) => { sent.push(init.body); return { status: 201 }; },
    decorate: (_notification, row) => {
      seen.push(row.owner);
      return { ...decoration, approval: { ...decoration.approval!, token: `token-for-${row.owner}` } };
    },
  });
  webPush.subscriptions.save("session-ada", subscription("https://web.push.apple.com/a"));
  webPush.subscriptions.save("session-bob", subscription("https://web.push.apple.com/b"));

  expect(await webPush.dispatch(approval, { sees: () => true })).toEqual([201, 201]);
  expect(seen.sort()).toEqual(["session-ada", "session-bob"]);
  const tokens = sent.map((body) => JSON.parse(decrypt(Buffer.from(body), receiver.getPrivateKey(), receiverAuth)).approval.token).sort();
  expect(tokens).toEqual(["token-for-session-ada", "token-for-session-bob"]);
});
