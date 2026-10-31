import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { foldPerStretch } from "./stretch-fold";

const line = (id: string, key: string): Message => ({ id, at: 1, role: "bot", kind: "text", text: key });
const person = (id: string): Message => ({ id, at: 1, role: "user", kind: "text", text: "oi" });
const byText = (message: Message) => (message.role === "bot" ? message.text ?? null : null);

describe("foldPerStretch", () => {
  it("keeps the newest line of each key and lists every member oldest first", () => {
    const { counts, folded, members } = foldPerStretch([line("a0", "a"), line("b1", "b"), line("a2", "a"), line("b3", "b"), line("a4", "a")], byText);
    expect(Object.fromEntries(counts)).toEqual({ a4: 3, b3: 2 });
    expect([...folded].sort()).toEqual(["a0", "a2", "b1"]);
    expect(members.get("a4")).toEqual(["a0", "a2", "a4"]);
    expect(members.get("b3")).toEqual(["b1", "b3"]);
  });

  it("starts a new group after the person writes", () => {
    const { counts, folded, members } = foldPerStretch([line("x1", "x"), line("x2", "x"), person("p"), line("x3", "x")], byText);
    expect(Object.fromEntries(counts)).toEqual({ x2: 2, x3: 1 });
    expect([...folded]).toEqual(["x1"]);
    expect(members.get("x3")).toEqual(["x3"]);
  });

  it("leaves a line without a key out, and does not take a bot's relayed message for the person's", () => {
    const relayed: Message = { ...person("r"), from: { botId: "designergrafico", name: "DESIGNERGRAFICO", color: "green" } };
    const { counts, folded } = foldPerStretch([line("k1", "k"), { ...line("n", "n"), kind: "activity" }, relayed, line("k2", "k")], (m) => (m.kind === "text" && m.role === "bot" ? m.text ?? null : null));
    expect(Object.fromEntries(counts)).toEqual({ k2: 2 });
    expect([...folded]).toEqual(["k1"]);
  });
});
