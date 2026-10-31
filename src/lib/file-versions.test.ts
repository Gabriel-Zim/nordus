import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { producedFileVersions } from "./file-versions";

const bot = (id: string, names: string[]) => ({ id, role: "bot", kind: "text", at: 1, attachments: names.map((name) => ({ kind: "file", path: `/x/${id}-${name}`, mime: "text/plain", name })) }) as unknown as Message;

describe("file versions", () => {
  it("numbers each delivery of the same file name in the thread", () => {
    const versions = producedFileVersions([bot("a", ["Proposta.md"]), { id: "u", role: "user", kind: "text", at: 2 } as Message, bot("b", ["proposta.md", "capa.png"])]);
    expect(versions.get("a")?.get("proposta.md")).toBe(1);
    expect(versions.get("b")?.get("proposta.md")).toBe(2);
    expect(versions.get("b")?.get("capa.png")).toBe(1);
  });
});
