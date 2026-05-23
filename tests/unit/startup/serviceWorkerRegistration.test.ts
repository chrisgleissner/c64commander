import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getServiceWorkerScriptUrl,
  registerServiceWorker,
  registerServiceWorkerForEnvironment,
  shouldRegisterServiceWorker,
  shouldRegisterServiceWorkerForEnvironment,
} from "@/lib/startup/serviceWorkerRegistration";
import { addErrorLog, addLog } from "@/lib/logging";

const appVersion = (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "0.0.0";
const swBuildId = (globalThis as { __SW_BUILD_ID__?: string }).__SW_BUILD_ID__ ?? `${appVersion}-test-build`;

const isNativePlatformMock = vi.fn(() => false);

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: { name: error.name, message: error.message, stack: error.stack ?? null },
    errorName: error.name,
    errorStack: error.stack ?? null,
  }),
}));

describe("serviceWorkerRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(false);
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = false;
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          register: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it("skips registration on native platforms", () => {
    isNativePlatformMock.mockReturnValue(true);

    expect(shouldRegisterServiceWorkerForEnvironment(false)).toBe(false);
    expect(registerServiceWorkerForEnvironment(false)).toBe(false);
  });

  it("skips registration when test probes are enabled", () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;

    expect(shouldRegisterServiceWorkerForEnvironment(false)).toBe(false);
    expect(registerServiceWorkerForEnvironment(false)).toBe(false);
  });

  it("skips registration when test probes are enabled through process env", () => {
    const previous = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = "1";

    expect(shouldRegisterServiceWorkerForEnvironment(false)).toBe(false);
    expect(registerServiceWorkerForEnvironment(false)).toBe(false);
    expect(addLog).not.toHaveBeenCalled();

    if (previous === undefined) {
      delete process.env.VITE_ENABLE_TEST_PROBES;
    } else {
      process.env.VITE_ENABLE_TEST_PROBES = previous;
    }
  });

  it("logs and continues when service-worker process metadata cannot be inspected", () => {
    const originalProcess = globalThis.process;
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: new Proxy(originalProcess, {
        get(target, property, receiver) {
          if (property === "env") {
            throw new Error("process env unavailable");
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    });

    try {
      expect(shouldRegisterServiceWorkerForEnvironment(false)).toBe(true);
      expect(addLog).toHaveBeenCalledWith(
        "debug",
        "Failed to inspect service-worker test-probe process metadata",
        expect.objectContaining({
          error: expect.objectContaining({ message: "process env unavailable" }),
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        value: originalProcess,
      });
    }
  });

  it("logs and falls back to an unversioned script URL when Vitest metadata cannot be inspected", () => {
    const originalProcess = globalThis.process;
    vi.stubGlobal("__SW_BUILD_ID__", "");
    vi.stubGlobal("__APP_VERSION__", "0.7.9-test");
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: new Proxy(originalProcess, {
        get(target, property, receiver) {
          if (property === "env") {
            throw new Error("vitest env unavailable");
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    });

    try {
      expect(getServiceWorkerScriptUrl()).toBe("/sw.js");
      expect(addLog).toHaveBeenCalledWith(
        "debug",
        "Failed to inspect Vitest service-worker environment",
        expect.objectContaining({
          error: expect.objectContaining({ message: "vitest env unavailable" }),
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        value: originalProcess,
      });
      vi.unstubAllGlobals();
    }
  });

  it("registers on web platforms and logs failures", async () => {
    const registerMock = vi.fn().mockRejectedValue(new Error("registration failed"));
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          register: registerMock,
        },
      },
    });

    expect(registerServiceWorkerForEnvironment(false)).toBe(true);

    window.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(registerMock).toHaveBeenCalledWith(`/sw.js?v=${swBuildId}`);
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Service worker registration failed",
      expect.objectContaining({
        error: expect.objectContaining({ message: "registration failed" }),
      }),
    );
  });

  it("shouldRegisterServiceWorker delegates to ForEnvironment", () => {
    // In Vitest, import.meta.env.DEV is true, so result is false (dev mode skips SW)
    expect(shouldRegisterServiceWorker()).toBe(false);
  });

  it("registerServiceWorker delegates to ForEnvironment", () => {
    // In Vitest, import.meta.env.DEV is true, so returns false (dev mode skips SW)
    expect(registerServiceWorker()).toBe(false);
  });

  it("builds a versioned service worker script url", () => {
    expect(getServiceWorkerScriptUrl()).toBe(`/sw.js?v=${swBuildId}`);
  });
});
