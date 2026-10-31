import { describe, expect, it } from "vitest";

import { projectMessage } from "./mcp-server.ts";

describe("projectMessage", () => {
  it("marks Nordus's quick note, so an agent reading the transcript never takes it for the bot's answer", () => {
    expect(projectMessage({ id: "n", at: 1, role: "bot", kind: "text", text: "Ainda estou rodando todos os testes, há 21 min.", quickAck: true }))
      .toMatchObject({ quickAck: true });
    expect(projectMessage({ id: "r", at: 2, role: "bot", kind: "text", text: "Pronto." }).quickAck).toBeUndefined();
  });
});
