// Recordings waiting for the server, in IndexedDB: localStorage is too small for audio and a reload must not lose them.
const DB = "nordus-voice-notes";
const STORE = "recordings";

export interface VoiceBlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbVoiceBlobs(factory: IDBFactory): VoiceBlobStore {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    }).catch((error) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };
  const store = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    async put(id, blob) {
      await request((await store("readwrite")).put(blob, id));
    },
    async get(id) {
      const value = await request((await store("readonly")).get(id));
      return value instanceof Blob ? value : undefined;
    },
    async delete(id) {
      await request((await store("readwrite")).delete(id));
    },
    async keys() {
      return (await request((await store("readonly")).getAllKeys())).map(String);
    },
  };
}

/** Private browsing can refuse IndexedDB; the recording then lives as long as the page. */
export function memoryVoiceBlobs(): VoiceBlobStore {
  const blobs = new Map<string, Blob>();
  return {
    async put(id, blob) { blobs.set(id, blob); },
    async get(id) { return blobs.get(id); },
    async delete(id) { blobs.delete(id); },
    async keys() { return [...blobs.keys()]; },
  };
}

export function fallbackVoiceBlobs(primary: VoiceBlobStore, fallback = memoryVoiceBlobs()): VoiceBlobStore {
  return {
    async put(id, blob) {
      await primary.put(id, blob).catch(() => fallback.put(id, blob));
    },
    async get(id) {
      return (await primary.get(id).catch(() => undefined)) ?? fallback.get(id);
    },
    async delete(id) {
      await Promise.allSettled([primary.delete(id), fallback.delete(id)]);
    },
    async keys() {
      return [...new Set([...await primary.keys().catch(() => []), ...await fallback.keys()])];
    },
  };
}
