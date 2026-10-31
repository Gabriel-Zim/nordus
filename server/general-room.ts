import type { Store } from "./store.ts";
import type { BotRecord, GroupRecord } from "./store.ts";

export const GENERAL_ROOM_NAME = "Geral";

type GeneralStore = Pick<Store, "bots" | "groups" | "createGroup" | "patchGroup" | "onChange">;

function everyone(visibility: unknown): boolean {
  return visibility === undefined || visibility === "everyone";
}

export interface GeneralRoomOptions {
  autoRouting?: boolean;
  /** Whether a bot works for the workspace itself; a client's bot never joins the shared room. */
  internal: (bot: BotRecord) => boolean;
}

/** The shared room every signed-in person sees: the internal bots anyone may see, nothing restricted and nothing
 * that belongs to a client, so no client's bot ever shares a room with another's or with the workspace's own. */
export function ensureGeneralRoom(store: GeneralStore, options: GeneralRoomOptions): GroupRecord | undefined {
  const eligible = store.bots.filter((bot) => !bot.client && everyone(bot.visibility) && options.internal(bot)).map((bot) => bot.id);
  const existing = store.groups.find((group) => group.general && !group.dm);
  if (!existing) {
    if (eligible.length < 2) return undefined;
    const created = store.createGroup(GENERAL_ROOM_NAME, eligible, false, undefined, {
      bulletin: "",
      defaultResponder: options.autoRouting ? { kind: "auto" } : undefined,
      completed: true,
    });
    return store.patchGroup(created.id, { general: true }) ?? created;
  }
  const same = existing.memberIds.length === eligible.length && eligible.every((id) => existing.memberIds.includes(id));
  if (same && existing.audienceFloor === undefined) return existing;
  const kept = existing.memberIds.filter((id) => eligible.includes(id));
  const added = eligible.filter((id) => !kept.includes(id));
  return store.patchGroup(existing.id, { memberIds: [...kept, ...added], audienceFloor: undefined }) ?? existing;
}

/** At start only an existing room is brought in line (a bot may have become a client's while the server was off); it is never created here. */
export function resyncGeneralRoom(store: GeneralStore, options: GeneralRoomOptions): void {
  if (store.groups.some((group) => group.general && !group.dm)) ensureGeneralRoom(store, options);
}

export function keepGeneralRoom(store: GeneralStore, options: () => GeneralRoomOptions): () => void {
  return store.onChange((change) => {
    if (change.type === "bot" || change.type === "bot.deleted") ensureGeneralRoom(store, options());
  });
}
