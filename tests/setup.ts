import "@testing-library/jest-dom";
import { JSDOM } from "jsdom";
import { vi } from "vitest";

const bootstrapDom = () => {
  if (typeof window !== "undefined" && typeof document !== "undefined") return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { window: domWindow } = dom;
  (globalThis as typeof globalThis & { window?: Window }).window = domWindow as unknown as Window;
  (globalThis as typeof globalThis & { document?: Document }).document = domWindow.document;
  (globalThis as typeof globalThis & { navigator?: Navigator }).navigator = domWindow.navigator;
  (globalThis as typeof globalThis & { HTMLElement?: typeof HTMLElement }).HTMLElement = domWindow.HTMLElement;
  (globalThis as typeof globalThis & { Element?: typeof Element }).Element = domWindow.Element;
  (globalThis as typeof globalThis & { Node?: typeof Node }).Node = domWindow.Node;
  (globalThis as typeof globalThis & { CustomEvent?: typeof CustomEvent }).CustomEvent = domWindow.CustomEvent;
  (globalThis as typeof globalThis & { FileReader?: typeof FileReader }).FileReader = domWindow.FileReader;
  (globalThis as typeof globalThis & { Blob?: typeof Blob }).Blob = domWindow.Blob;
  if (typeof window.setTimeout !== "function") {
    window.setTimeout = globalThis.setTimeout.bind(globalThis);
  }
  if (typeof window.clearTimeout !== "function") {
    window.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  }
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 16) as unknown as number;
  }
};

const installVitestCompat = () => {
  const envStubs = new Map<string, string | undefined>();
  const globalStubs = new Map<string, unknown>();

  if (!vi.mocked) {
    vi.mocked = ((value: unknown) => value) as typeof vi.mocked;
  }
  if (!vi.stubEnv) {
    vi.stubEnv = ((key: string, value: string) => {
      if (!envStubs.has(key)) envStubs.set(key, process.env[key]);
      process.env[key] = value;
    }) as typeof vi.stubEnv;
  }
  if (!vi.unstubAllEnvs) {
    vi.unstubAllEnvs = (() => {
      envStubs.forEach((value, key) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      envStubs.clear();
    }) as typeof vi.unstubAllEnvs;
  }
  if (!vi.stubGlobal) {
    vi.stubGlobal = ((key: string, value: unknown) => {
      if (!globalStubs.has(key)) {
        globalStubs.set(key, (globalThis as Record<string, unknown>)[key]);
      }
      (globalThis as Record<string, unknown>)[key] = value;
    }) as typeof vi.stubGlobal;
  }
  if (!vi.unstubAllGlobals) {
    vi.unstubAllGlobals = (() => {
      globalStubs.forEach((value, key) => {
        if (value === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
        } else {
          (globalThis as Record<string, unknown>)[key] = value;
        }
      });
      globalStubs.clear();
    }) as typeof vi.unstubAllGlobals;
  }
  if (!vi.setSystemTime) {
    vi.setSystemTime = ((time: number | Date) => {
      vi.useFakeTimers();
      const target = typeof time === "number" ? time : time.getTime();
      const now = Date.now();
      const delta = target - now;
      if (delta !== 0 && vi.advanceTimersByTime) {
        vi.advanceTimersByTime(delta);
      }
    }) as typeof vi.setSystemTime;
  }
  if (!vi.runAllTimersAsync) {
    vi.runAllTimersAsync = (async () => {
      if (vi.runAllTimers) {
        vi.runAllTimers();
        return;
      }
      if (vi.advanceTimersByTimeAsync) {
        await vi.advanceTimersByTimeAsync(0);
      }
    }) as typeof vi.runAllTimersAsync;
  }
};

bootstrapDom();
installVitestCompat();

// Default to non-native platform in unit tests unless explicitly overridden.
(globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;
if (typeof window !== "undefined") {
  (window as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;

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

  // Minimal PointerEvent polyfill for libraries expecting it.
  if (typeof (window as any).PointerEvent === "undefined") {
    class PointerEvent extends MouseEvent { }
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
