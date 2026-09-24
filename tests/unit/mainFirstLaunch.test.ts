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
  applyFullScreenFromSettings: vi.fn(),
  applyScreenOrientationFromSettings: vi.fn(),
  addErrorLog: vi.fn(),
  primeSecureStorageAfterStartup: vi.fn(async () => undefined),
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: mocks.render })),
}));
// A module that saves to storage as it loads, as the device safety defaults do when they read the
// saved devices on import.
vi.mock("@/App.tsx", () => {
  localStorage.setItem("c64u_written_on_import", "1");
  return { default: () => null };
});
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
vi.mock("@/lib/native/fullScreen", () => ({ applyFullScreenFromSettings: mocks.applyFullScreenFromSettings }));
vi.mock("@/lib/native/screenOrientation", () => ({
  applyScreenOrientationFromSettings: mocks.applyScreenOrientationFromSettings,
}));
vi.mock("@/lib/startup/secureStorageBootstrap", () => ({
  primeSecureStorageAfterStartup: mocks.primeSecureStorageAfterStartup,
}));

describe("main.tsx first-launch detection", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.removeChild(root);
    localStorage.clear();
  });

  it("samples storage for the first-run tour before any app module can write to it", async () => {
    await import("@/main");
    const { hasPriorAppState } = await import("@/lib/tour/tourState");

    expect(localStorage.getItem("c64u_written_on_import")).toBe("1");
    expect(hasPriorAppState()).toBe(false);
  });
});
