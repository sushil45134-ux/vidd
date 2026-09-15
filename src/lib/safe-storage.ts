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

const localMem = createMemoryStorage();
const sessionMem = createMemoryStorage();

// Resolve the browser storage once. The old implementation called
// `window.localStorage` on every operation and returned a *new* memory store
// whenever access was blocked, so a TV could successfully write a preference
// and immediately fail to read it back. Keeping the selected store stable
// makes the fallback useful and also avoids repeatedly probing a fragile TV
// storage implementation during React renders.
let localStore: StorageLike | null = null;
let sessionStore: StorageLike | null = null;

function pick(kind: "local" | "session"): StorageLike {
  const cached = kind === "local" ? localStore : sessionStore;
  if (cached) return cached;
  if (typeof window === "undefined") return kind === "local" ? localMem : sessionMem;

  const fallback = kind === "local" ? localMem : sessionMem;
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    const probe = "__ss_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    if (kind === "local") localStore = storage;
    else sessionStore = storage;
    return storage;
  } catch {
    if (kind === "local") localStore = fallback;
    else sessionStore = fallback;
    return fallback;
  }
}

function switchToMemory(kind: "local" | "session"): StorageLike {
  const fallback = kind === "local" ? localMem : sessionMem;
  if (kind === "local") localStore = fallback;
  else sessionStore = fallback;
  return fallback;
}

export const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return pick("local").getItem(key);
    } catch {
      return switchToMemory("local").getItem(key);
    }
  },
  setItem(key: string, value: string): void {
    try {
      pick("local").setItem(key, value);
    } catch {
      switchToMemory("local").setItem(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      pick("local").removeItem(key);
    } catch {
      switchToMemory("local").removeItem(key);
    }
  },
};

export const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      return pick("session").getItem(key);
    } catch {
      return switchToMemory("session").getItem(key);
    }
  },
  setItem(key: string, value: string): void {
    try {
      pick("session").setItem(key, value);
    } catch {
      switchToMemory("session").setItem(key, value);
    }
  },
  removeItem(key: string): void {
    try {
      pick("session").removeItem(key);
    } catch {
      switchToMemory("session").removeItem(key);
    }
  },
};
