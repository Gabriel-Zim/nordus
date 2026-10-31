import { describe, expect, it } from "vitest";

import { BUILD_RELOAD_COOLDOWN_MS, createPageBuildWatch, type PageBuildPlatform } from "./page-build";

function page(options: { own?: string | null; served?: string | null; hidden?: boolean; busy?: boolean } = {}) {
  let hidden = options.hidden ?? false;
  let busy = options.busy ?? false;
  let now = 0;
  let saved: { build: string; at: number } | null = null;
  const listeners = new Set<() => void>();
  const reloads: string[] = [];
  const platform: PageBuildPlatform = {
    ownBuild: () => (options.own === undefined ? "old" : options.own),
    fetchServedBuild: async () => (options.served === undefined ? "new" : options.served),
    hidden: () => hidden,
    busy: () => busy,
    onHiddenChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload: () => reloads.push(saved?.build ?? ""),
    now: () => now,
    readReload: () => saved,
    writeReload: (entry) => {
      saved = entry;
    },
  };
  return {
    watch: createPageBuildWatch(platform),
    reloads,
    listeners,
    look(away: boolean) {
      hidden = away;
      for (const listener of listeners) listener();
    },
    settle() {
      busy = false;
    },
    advance(ms: number) {
      now += ms;
    },
    freshTab() {
      return createPageBuildWatch(platform);
    },
  };
}

describe("page build watch", () => {
  it("leaves a page on the build the server serves alone", () => {
    const test = page({ own: "same", hidden: true });
    test.watch.served("same");
    expect(test.reloads).toEqual([]);
  });

  it("reloads an older page at once when it is hidden", () => {
    const test = page({ hidden: true });
    test.watch.served("new");
    expect(test.reloads).toEqual(["new"]);
  });

  it("waits for the page to be hidden before reloading one in use", () => {
    const test = page();
    test.watch.served("new");
    test.watch.served("newer");
    expect(test.reloads).toEqual([]);
    test.look(true);
    expect(test.reloads).toEqual(["new"]);
    expect(test.listeners.size).toBe(0);
  });

  it("never reloads under a call or an upload, and waits for the next time the page is hidden", () => {
    const test = page({ hidden: true, busy: true });
    test.watch.served("new");
    test.look(true);
    expect(test.reloads).toEqual([]);
    test.settle();
    test.look(false);
    test.look(true);
    expect(test.reloads).toEqual(["new"]);
  });

  it("does not reload for a failed chunk during a call, even one that starts while it checks", async () => {
    const test = page({ busy: true });
    await test.watch.chunkFailed();
    expect(test.reloads).toEqual([]);

    let startCall = () => {};
    const racing = createPageBuildWatch({
      ownBuild: () => "old", hidden: () => false, onHiddenChange: () => () => {}, now: () => 0,
      busy: () => calling, readReload: () => null, writeReload: () => {}, reload: () => test.reloads.push("racing"),
      fetchServedBuild: async () => (startCall(), "new"),
    });
    let calling = false;
    startCall = () => {
      calling = true;
    };
    await racing.chunkFailed();
    expect(test.reloads).toEqual([]);
  });

  it("never loops when the server keeps serving a page the reload did not bring", () => {
    const test = page({ hidden: true });
    test.watch.served("new");
    test.freshTab().served("new");
    expect(test.reloads).toEqual(["new"]);
    test.advance(BUILD_RELOAD_COOLDOWN_MS);
    test.freshTab().served("new");
    expect(test.reloads).toEqual(["new", "new"]);
  });

  it("reloads on a failed chunk only when the server confirms a newer page", async () => {
    const offline = page({ served: null });
    await offline.watch.chunkFailed();
    const current = page({ served: "old" });
    await current.watch.chunkFailed();
    expect([...offline.reloads, ...current.reloads]).toEqual([]);

    const deployed = page({ served: "new" });
    await deployed.watch.chunkFailed();
    expect(deployed.reloads).toEqual(["new"]);
  });

  it("does nothing for a page without a build stamp", async () => {
    const test = page({ own: null, hidden: true });
    test.watch.served("new");
    await test.watch.chunkFailed();
    expect(test.reloads).toEqual([]);
  });
});
