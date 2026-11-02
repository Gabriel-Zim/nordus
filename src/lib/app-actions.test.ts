import { describe, expect, it } from "vitest";
import type { AppState } from "@/state/store";
import { newConversationAction, runningWork, stopWorkActions } from "./app-actions";

const bot = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, threadId: `${id}-main`, ...extra }) as unknown as AppState["bots"][number];
const group = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, threadId: `${id}-main`, memberIds: [], ...extra }) as unknown as AppState["groups"][number];

describe("new conversation from the keyboard or the palette", () => {
  it("opens a new task with the bot or room on screen", () => {
    expect(newConversationAction({ bots: [bot("ana")], groups: [], selectedId: "ana" })).toEqual({ type: "newTask", botId: "ana" });
    expect(newConversationAction({ bots: [], groups: [group("time")], selectedId: "time" })).toEqual({ type: "newGroupTask", groupId: "time" });
  });

  it("does nothing on a direct message or with nothing open", () => {
    expect(newConversationAction({ bots: [], groups: [group("dm", { dm: true })], selectedId: "dm" })).toBeNull();
    expect(newConversationAction({ bots: [bot("ana")], groups: [], selectedId: "" })).toBeNull();
  });
});

describe("stop all running work", () => {
  it("lists every working conversation of every bot and room, and nothing that waits on the person", () => {
    const state = {
      bots: [
        bot("ana", { tasks: [
          { threadId: "a1", busy: true },
          { threadId: "a2", activity: "working" },
          { threadId: "a3", busy: true, activity: "waiting-on-you" },
          { threadId: "a4" },
        ] }),
        bot("leo", { busy: true }),
        bot("idle"),
      ],
      groups: [group("time", { busyBotId: "ana" }), group("calma")],
    };
    expect(runningWork(state)).toEqual([
      { kind: "bot", botId: "ana", threadId: "a1" },
      { kind: "bot", botId: "ana", threadId: "a2" },
      { kind: "bot", botId: "leo", threadId: "leo-main" },
      { kind: "group", groupId: "time", threadId: "time-main" },
    ]);
  });

  it("stops each one through the same stop the conversation's own button uses", () => {
    expect(stopWorkActions([
      { kind: "bot", botId: "ana", threadId: "a1" },
      { kind: "group", groupId: "time", threadId: "t1" },
    ])).toEqual([
      { type: "interrupt", botId: "ana", threadId: "a1" },
      { type: "interruptGroup", groupId: "time", threadId: "t1" },
    ]);
  });
});
