/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  installAsyncContextPropagation: vi.fn(),
  registerFetchTrace: vi.fn(),
  registerUserInteractionCapture: vi.fn(),
  registerTraceBridge: vi.fn(),
  registerDiagnosticsTestBridge: vi.fn(),
  markStartupBootstrapComplete: vi.fn(),
  initializeRuntimeMotionMode: vi.fn(),
  registerServiceWorker: vi.fn(),
  installNativeSafeAreaSync: vi.fn(),
  applyFullScreenFromSettings: vi.fn(),
  applyScreenOrientationFromSettings: vi.fn(),
  loadRemoteFonts: vi.fn(),
  addErrorLog: vi.fn(),
  primeSecureStorageAfterStartup: vi.fn(async () => undefined),
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: mocks.render })),
}));
vi.mock("@/App.tsx", () => ({ default: () => null }));
vi.mock("@/lib/tracing/traceActionContextStore", () => ({
  installAsyncContextPropagation: mocks.installAsyncContextPropagation,
}));
vi.mock("@/lib/tracing/fetchTrace", () => ({ registerFetchTrace: mocks.registerFetchTrace }));
vi.mock("@/lib/tracing/userInteractionCapture", () => ({
  registerUserInteractionCapture: mocks.registerUserInteractionCapture,
}));
vi.mock("@/lib/tracing/traceBridge", () => ({ registerTraceBridge: mocks.registerTraceBridge }));
vi.mock("@/lib/diagnostics/diagnosticsTestBridge", () => ({
  registerDiagnosticsTestBridge: mocks.registerDiagnosticsTestBridge,
}));
vi.mock("@/lib/startup/startupMilestones", () => ({
  markStartupBootstrapComplete: mocks.markStartupBootstrapComplete,
}));
vi.mock("@/lib/startup/runtimeMotionBudget", () => ({
  initializeRuntimeMotionMode: mocks.initializeRuntimeMotionMode,
}));
vi.mock("@/lib/startup/serviceWorkerRegistration", () => ({
  registerServiceWorker: mocks.registerServiceWorker,
}));
vi.mock("@/lib/logging", () => ({ addErrorLog: mocks.addErrorLog }));
vi.mock("@/lib/native/safeArea", () => ({ installNativeSafeAreaSync: mocks.installNativeSafeAreaSync }));
vi.mock("@/lib/native/fullScreen", () => ({ applyFullScreenFromSettings: mocks.applyFullScreenFromSettings }));
vi.mock("@/lib/native/screenOrientation", () => ({
  applyScreenOrientationFromSettings: mocks.applyScreenOrientationFromSettings,
}));
vi.mock("@/lib/startup/fontLoading", () => ({ loadRemoteFonts: mocks.loadRemoteFonts }));
vi.mock("@/lib/startup/secureStorageBootstrap", () => ({
  primeSecureStorageAfterStartup: mocks.primeSecureStorageAfterStartup,
}));

const setDocumentHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
};

describe("main.tsx deferred startup bootstrap (HARD9-094)", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockClear());
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.removeChild(root);
    setDocumentHidden(false);
    vi.unstubAllGlobals();
  });

  it("runs the deferred bootstrap without waiting on rAF when the document launches hidden", async () => {
    setDocumentHidden(true);
    // Simulates real hidden-tab/background-launch behavior: rAF callbacks never
    // fire while the document is hidden (spec-mandated throttling).
    const rafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("requestIdleCallback", undefined);

    await import("@/main");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rafSpy).not.toHaveBeenCalled();
    expect(mocks.markStartupBootstrapComplete).toHaveBeenCalledTimes(1);
    expect(mocks.registerFetchTrace).toHaveBeenCalledTimes(1);
    expect(mocks.loadRemoteFonts).toHaveBeenCalledTimes(1);
  });

  it("still uses the double rAF gate when the document launches visible", async () => {
    setDocumentHidden(false);
    let rafCalls = 0;
    const rafSpy = vi.fn((callback: FrameRequestCallback) => {
      rafCalls += 1;
      callback(0);
      return rafCalls;
    });
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("requestIdleCallback", undefined);

    await import("@/main");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rafSpy).toHaveBeenCalledTimes(2);
    expect(mocks.markStartupBootstrapComplete).toHaveBeenCalledTimes(1);
  });
});
