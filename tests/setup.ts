/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import {
  FEATURE_FLAG_IDS as REGISTERED_FEATURE_FLAG_IDS,
  type FeatureFlagId,
} from "@/lib/config/featureFlagsRegistry.generated";

const FEATURE_FLAG_STORAGE_PREFIX = "c64u_feature_flag:";
const DEVELOPER_MODE_KEY = "c64u_dev_mode_enabled";

type TestFeatureFlagId = FeatureFlagId;
type TestFeatureFlagState = {
  developerMode?: boolean;
  overrides?: Partial<Record<TestFeatureFlagId, boolean>>;
};

declare global {
  var __setFeatureFlagTestState: ((state?: TestFeatureFlagState) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Shared setup (runs in both Node and jsdom environments)
// ---------------------------------------------------------------------------

/** Memory-backed Storage for environments where native localStorage is unavailable. */
const createMemoryStorage = (): Storage => {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
};

/**
 * Guarantee a working `localStorage` on `globalThis` (and `window` when present).
 * In vitest's jsdom environment localStorage is available by default; this helper
 * provides a fallback for edge cases (e.g. opaque-origin restrictions).
 */
const isStorageUsable = (storage?: Storage | null) => {
  if (!storage) return false;
  try {
    const probeKey = "__c64u_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
};

const ensureLocalStorage = () => {
  const existingStorage = (globalThis as { localStorage?: Storage }).localStorage;
  if (isStorageUsable(existingStorage)) return;
  let storage: Storage | undefined = existingStorage;
  let shouldOverrideWindow = false;

  if (typeof window !== "undefined") {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    if (descriptor?.get) {
      try {
        storage = descriptor.get.call(window) as Storage;
      } catch (error) {
        shouldOverrideWindow = true;
        console.warn("LocalStorage access failed in tests; falling back to memory storage.", error);
      }
    } else if (descriptor?.value) {
      storage = descriptor.value as Storage;
    }
  }

  if (!isStorageUsable(storage)) {
    storage = createMemoryStorage();
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  if (typeof window !== "undefined") {
    let hasUsableLocalStorage = false;
    try {
      hasUsableLocalStorage = isStorageUsable(window.localStorage);
    } catch {
      shouldOverrideWindow = true;
    }

    if (shouldOverrideWindow || !hasUsableLocalStorage) {
      Object.defineProperty(window, "localStorage", {
        value: storage,
        configurable: true,
        writable: true,
      });
    }
  }
};

const canWriteStorage = (storage: unknown): storage is Pick<Storage, "setItem" | "removeItem"> =>
  typeof storage === "object" &&
  storage !== null &&
  typeof (storage as Storage).setItem === "function" &&
  typeof (storage as Storage).removeItem === "function";

const getAvailableStorages = () => {
  const storages: Array<unknown> = [];

  if (typeof localStorage !== "undefined") {
    storages.push(localStorage);
  }

  if (typeof sessionStorage !== "undefined") {
    storages.push(sessionStorage);
  }

  return storages;
};

const getStoredFeatureFlagIds = (storage: unknown): string[] => {
  if (!storage || typeof storage !== "object" || typeof (storage as Storage).key !== "function") return [];

  const featureFlagIds: string[] = [];
  for (let index = 0; index < (storage as Storage).length; index += 1) {
    const key = (storage as Storage).key(index);
    if (!key?.startsWith(FEATURE_FLAG_STORAGE_PREFIX)) continue;
    featureFlagIds.push(key.slice(FEATURE_FLAG_STORAGE_PREFIX.length));
  }

  return featureFlagIds;
};

const getFeatureFlagIdsToClear = (): string[] =>
  Array.from(
    new Set([
      ...REGISTERED_FEATURE_FLAG_IDS,
      ...getAvailableStorages().flatMap((storage) => getStoredFeatureFlagIds(storage)),
    ]),
  );

const clearFeatureFlagTestState = () => {
  const featureFlagIds = getFeatureFlagIdsToClear();
  for (const storage of getAvailableStorages()) {
    if (!canWriteStorage(storage)) continue;
    storage.removeItem(DEVELOPER_MODE_KEY);
    featureFlagIds.forEach((id) => {
      storage.removeItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`);
    });
  }
};

const assertSharedFeatureFlagTestState = (overrides: Partial<Record<TestFeatureFlagId, boolean>>) => {
  const disabledFlags = REGISTERED_FEATURE_FLAG_IDS.filter((id) => overrides[id] === false);
  if (disabledFlags.length > 0) {
    throw new Error(
      `Shared test bootstrap must keep all feature flags enabled; disabled overrides are not allowed: ${disabledFlags.join(", ")}`,
    );
  }
};

const applyFeatureFlagTestState = (state: TestFeatureFlagState = {}) => {
  const { developerMode = true, overrides = {} } = state;

  assertSharedFeatureFlagTestState(overrides);

  clearFeatureFlagTestState();

  if (typeof localStorage !== "undefined" && canWriteStorage(localStorage)) {
    localStorage.setItem(DEVELOPER_MODE_KEY, developerMode ? "1" : "0");
  }

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent<{ enabled: boolean }>("c64u-dev-mode-change", {
        detail: { enabled: developerMode },
      }),
    );
  }

  for (const id of REGISTERED_FEATURE_FLAG_IDS) {
    const enabled = overrides[id] ?? true;
    const storedValue = enabled ? "1" : "0";

    if (typeof localStorage !== "undefined" && canWriteStorage(localStorage)) {
      localStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`, storedValue);
    }

    if (typeof sessionStorage !== "undefined" && canWriteStorage(sessionStorage)) {
      sessionStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`, storedValue);
    }
  }
};

// ---------------------------------------------------------------------------
// Shared initialisation (environment-agnostic)
// ---------------------------------------------------------------------------

ensureLocalStorage();
applyFeatureFlagTestState();

globalThis.__setFeatureFlagTestState = applyFeatureFlagTestState;

beforeEach(() => {
  applyFeatureFlagTestState();
});

afterEach(() => {
  clearFeatureFlagTestState();
});

const packageVersion = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")).version as string;

if (typeof (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ === "undefined") {
  Object.defineProperty(globalThis, "__APP_VERSION__", {
    value: packageVersion,
    configurable: true,
    writable: true,
  });
}

if (typeof (globalThis as { __SW_BUILD_ID__?: string }).__SW_BUILD_ID__ === "undefined") {
  Object.defineProperty(globalThis, "__SW_BUILD_ID__", {
    value: `${packageVersion}-test-build`,
    configurable: true,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// jsdom-only setup (guarded — skipped entirely in Node environment)
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // Default to non-native platform in unit tests unless explicitly overridden.
  (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;
  (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;

  ensureLocalStorage();

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Radix UI (Select) relies on pointer capture APIs that are missing in JSDOM.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }

  if (typeof (window as any).MouseEvent === "undefined") {
    class MouseEvent extends Event {
      constructor(type: string, params?: EventInit) {
        super(type, params);
      }
    }
    (window as any).MouseEvent = MouseEvent;
  }

  // Minimal PointerEvent polyfill for libraries expecting it.
  if (typeof (window as any).PointerEvent === "undefined") {
    class PointerEvent extends (window as any).MouseEvent {}
    (window as any).PointerEvent = PointerEvent;
  }

  // Used by Radix Select to bring the active item into view.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Add window.scrollTo mock
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

  // Radix Slider uses ResizeObserver in JSDOM.
  if (typeof (window as any).ResizeObserver === "undefined") {
    (window as any).ResizeObserver = class {
      constructor(_callback?: ResizeObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
