import { describe, expect, it } from "vitest";
import type { NotificationLogEntry } from "../../shared/notification";
import { countsAsUnread, reduceNotificationFeed } from "./notification-feed";

const entry = (id: string, extra: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  id, at: 1, kind: "approval", botId: "b", botName: "DESIGNERGRAFICO", threadId: "t", title: "DESIGNERGRAFICO precisa de você", body: "", read: false, ...extra,
});

describe("a resolved notification", () => {
  it("stays in the feed but leaves the count, once", () => {
    const feed = reduceNotificationFeed([entry("a"), entry("b")], { type: "notificationsResolved", ids: ["a"], at: 50 });
    expect(feed.map((item) => item.resolvedAt)).toEqual([50, undefined]);
    expect(feed.filter(countsAsUnread).map((item) => item.id)).toEqual(["b"]);
    expect(reduceNotificationFeed(feed, { type: "notificationsResolved", ids: ["a"], at: 90 })[0]?.resolvedAt).toBe(50);
  });

  it("keeps a resolution that arrived while an older copy of the feed was on its way", () => {
    const resolved = reduceNotificationFeed([entry("a")], { type: "notificationsResolved", ids: ["a"], at: 50 });
    const hydrated = reduceNotificationFeed(resolved, { type: "notificationsHydrated", notifications: [entry("a")] });
    expect(hydrated[0]?.resolvedAt).toBe(50);
  });
});
