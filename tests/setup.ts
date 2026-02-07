import "@testing-library/jest-dom";
import { vi } from "vitest";

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
      return store.has(key) ? store.get(key) ?? null : null;
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

// ---------------------------------------------------------------------------
// Shared initialisation (environment-agnostic)
// ---------------------------------------------------------------------------

ensureLocalStorage();

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
      addListener: () => { },
      removeListener: () => { },
      addEventListener: () => { },
      removeEventListener: () => { },
      dispatchEvent: () => { },
    }),
  });

  // Radix UI (Select) relies on pointer capture APIs that are missing in JSDOM.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => { };
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => { };
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
    class PointerEvent extends (window as any).MouseEvent { }
    (window as any).PointerEvent = PointerEvent;
  }

  // Used by Radix Select to bring the active item into view.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => { };
  }

  // Add window.scrollTo mock
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => { },
  });

  // Radix Slider uses ResizeObserver in JSDOM.
  if (typeof (window as any).ResizeObserver === "undefined") {
    (window as any).ResizeObserver = class {
      constructor(_callback?: ResizeObserverCallback) { }
      observe() { }
      unobserve() { }
      disconnect() { }
    };
  }
}
