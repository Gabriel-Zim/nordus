import { beforeEach, describe, expect, it } from "vitest";
import { __resetAvatarPreloadForTests, avatarUrlsToPreload, preloadAvatars } from "./avatar-preload";

const A = "/api/attachments/a-av-w256h256.webp";
const B = "/api/attachments/b-av-w256h320.webp";

beforeEach(() => __resetAvatarPreloadForTests());

describe("avatar preload", () => {
  it("lists each converted picture once and skips owners without one", () => {
    expect(avatarUrlsToPreload([{ avatarUrl: A }, { avatarUrl: A }, { avatarUrl: null }, {}, { avatarUrl: B }])).toEqual([A, B]);
  });

  it("leaves original pictures to the img, since they are not cached", () => {
    expect(avatarUrlsToPreload([{ avatarUrl: "/api/attachments/x-w2048h2048.png" }, { avatarUrl: "/api/attachments/y.webp" }])).toEqual([]);
  });

  it("loads and decodes each picture once, only when the browser is idle", async () => {
    const queued: Array<() => void> = [];
    const created: Array<{ src: string; decoded: number }> = [];
    const create = () => {
      const image = { src: "", decoded: 0, decode: async () => { image.decoded += 1; } };
      created.push(image);
      return image;
    };
    preloadAvatars([{ avatarUrl: A }, { avatarUrl: B }], (run) => queued.push(run), create);
    preloadAvatars([{ avatarUrl: A }], (run) => queued.push(run), create);
    expect(created).toHaveLength(0);
    queued.forEach((run) => run());
    expect(created.map((image) => image.src)).toEqual([A, B]);
    expect(created.every((image) => image.decoded === 1)).toBe(true);
  });
});
