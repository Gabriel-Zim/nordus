import type { LocalePack } from "./choices";

// pt-br is bundled with the app (the default language); every other pack is its own chunk, fetched when chosen.
const loaders = import.meta.glob<{ default: LocalePack }>(["./*.json", "!./pt-br.json", "!./source-hashes.json"]);

export async function loadLocalePack(code: string): Promise<LocalePack> {
  const load = loaders[`./${code}.json`];
  if (!load) throw new Error(`No language pack for ${code}`);
  return (await load()).default;
}
