import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/board-compose", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/board-compose")>(), openTaskFromMessage: fixture.open }));
const { userMessageMenu } = await import("./message-menu");

const task = { threadId: "t1", groupId: "g1", messageId: "m1", text: "Ship the newsletter" };

beforeEach(() => {
  setLocale("en");
  fixture.open.mockReset();
});

describe("Create task in a message's menu", () => {
  it("opens the draft for that message when chosen", () => {
    const item = userMessageMenu({ messageId: "m1", task }).find((candidate) => candidate.key === "create-task")!;
    expect(item.label).toBe("Create task");
    item.onSelect();
    expect(fixture.open).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("sits right after Edit and before Pin and Star", () => {
    const keys = userMessageMenu({
      messageId: "m1",
      task,
      onEdit: () => {},
      pin: { pinned: false, onToggle: () => {} },
      favorite: { starred: false, onToggle: () => {} },
    }).map((item) => item.key);
    expect(keys.slice(0, 4)).toEqual(["edit", "create-task", "pin", "favorite"]);
  });

  it("is left out when there is no task to make or the message has no words", () => {
    const keys = (value?: { threadId: string; messageId: string; text: string }) => userMessageMenu({ messageId: "m1", task: value }).map((item) => item.key);
    expect(keys()).not.toContain("create-task");
    expect(keys({ threadId: "t1", messageId: "m1", text: "   \n " })).not.toContain("create-task");
  });
});
