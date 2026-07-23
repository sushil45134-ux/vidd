/**
 * Safe storage wrapper: some Smart TV browsers (Tizen) and privacy modes
 * throw when accessing localStorage/sessionStorage. Wrap every call in
 * try/catch with an in-memory fallback so the app never crashes.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear" | "key"> & {
  readonly length: number;
};

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

function pick(kind: "local" | "session"): StorageLike {
  if (typeof window === "undefined") return createMemoryStorage();
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    const probe = "__ss_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return createMemoryStorage();
  }
}

const localMem = createMemoryStorage();
const sessionMem = createMemoryStorage();

export const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return pick("local").getItem(key);
    } catch {
      return localMem.getItem(key);
    }
  },
  setItem(key: string, value: string): void {
    try {
      pick("local").setItem(key, value);
    } catch {
      localMem.setItem(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      pick("local").removeItem(key);
    } catch {
      localMem.removeItem(key);
    }
  },
};

export const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      return pick("session").getItem(key);
    } catch {
      return sessionMem.getItem(key);
    }
  },
  setItem(key: string, value: string): void {
    try {
      pick("session").setItem(key, value);
    } catch {
      sessionMem.setItem(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      pick("session").removeItem(key);
    } catch {
      sessionMem.removeItem(key);
    }
  },
};
