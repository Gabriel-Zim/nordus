import { beforeAll, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Task } from "@/state/store";

import { workBubbleLines } from "./Sidebar";

beforeAll(() => setLocale("en"));

const task = (title: string, extra: Partial<Task> = {}) => ({ threadId: title, title, createdAt: 0, ...extra }) as Task;

it("names the conversation a bot works in, with its step beneath", () => {
  expect(workBubbleLines([task("Ticket #21: delivered, never arrived", { busy: true })], "Checking the carrier")).toEqual({
    main: "Ticket #21: delivered, never arrived",
    step: "Checking the carrier",
  });
});

it("counts other conversations in progress and skips idle ones", () => {
  const tasks = [task("Lumon carousel", { activity: "working" }), task("Idle one"), task("Reel v3", { busy: true })];
  expect(workBubbleLines(tasks, null)).toEqual({ main: "Lumon carousel +1", step: null });
});

it("lets the step lead when the conversation has no name yet, and says nothing without either", () => {
  expect(workBubbleLines([task("New thread", { busy: true })], "Drafting the reply")).toEqual({ main: "Drafting the reply", step: null });
  expect(workBubbleLines([task("New thread", { busy: true })], null)).toBeNull();
});
