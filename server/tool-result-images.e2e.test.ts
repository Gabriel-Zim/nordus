import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import type { WireMessage } from "../shared/wire.ts";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = (label: string) => Buffer.concat([PNG_SIGNATURE, Buffer.from(label)]);
const imageBlock = (bytes: Buffer) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } });

it("attaches to the reply only the image a tool made, not the ones the bot read to work", async () => {
  const sheets = [png("contact sheet 1"), png("contact sheet 2")];
  const cover = png("cover made for the person");
  const fixture = await launchVerificationServer({
    // The launcher keeps only OS launch variables and FAKE_CLAUDE_* knobs.
    ...process.env,
    FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([
      ...sheets.map((sheet, index) => ({ name: "Read", input: { file_path: `/fixture/sheet-${index}.png` }, output: [imageBlock(sheet)] })),
      { name: "mcp__zorg__gerar_imagem", input: { prompt: "cover" }, output: [{ type: "text", text: "done" }, imageBlock(cover)] },
    ]),
  });
  const control = async (...args: string[]) => await runControlNordus([...args, "--url", fixture.info.url]) as any;
  try {
    const bot = (await control("new-bot", "--name", "Art director")).bot;
    await control("send", "--bot", bot.id, "--text", "Open the task");
    expect((await control("wait", "--bot", bot.id, "--timeout", "30")).status).toBe("settled");

    const response = await fetch(`${fixture.info.url}/api/threads/${bot.activeTaskId}/messages?limit=50`);
    const { messages } = await response.json() as { messages: WireMessage[] };
    expect(messages.filter(message => message.tool?.name === "Read")).toHaveLength(2);
    const attachments = messages.flatMap(message => message.attachments ?? []);
    expect(attachments).toMatchObject([{ kind: "image", mime: "image/png" }]);
    expect(readFileSync(attachments[0]!.path).equals(cover)).toBe(true);
  } finally {
    await fixture.close();
    expect(existsSync(fixture.info.dataDir)).toBe(false);
  }
}, 90_000);
