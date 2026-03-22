/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  invalidateForVisibilityResume: vi.fn(),
  useNavigationGuardBlocker: vi.fn(),
  registerGlobalButtonInteractionModel: vi.fn(),
  installConsoleDiagnosticsBridge: vi.fn(),
  startNativeDiagnosticsBridge: vi.fn().mockResolvedValue(undefined),
  stopNativeDiagnosticsBridge: vi.fn().mockResolvedValue(undefined),
  startNativeDebugSnapshotPublisher: vi.fn(),
  startWebServerLogBridge: vi.fn(),
  recordActionStart: vi.fn(),
  recordActionEnd: vi.fn(),
  recordTraceError: vi.fn(),
  createActionContext: vi.fn((name: string, origin: string, component: string) => ({
    id: `${name}:${origin}:${component}`,
    name,
    origin,
    component,
  })),
  getActiveAction: vi.fn(),
  loadDebugLoggingEnabled: vi.fn(),
  getPlatform: vi.fn(),
  redactTreeUri: vi.fn((uri: string) => `redacted:${uri}`),
  getPersistedUris: vi.fn(),
  uninstallConsoleBridge: vi.fn(),
  buttonInteractionCleanup: vi.fn(),
  debugSnapshotCleanup: vi.fn(),
  webServerLogCleanup: vi.fn(),
  traceContextBridge: vi.fn(() => <div data-testid="trace-context-bridge" />),
}));

vi.mock("@/components/ui/toaster", () => ({ Toaster: () => <div data-testid="toaster" /> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => <div data-testid="sonner" /> }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    size,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    size?: string;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} data-size={size} className={className}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useDisplayProfile", () => ({
  DisplayProfileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDisplayProfile: () => ({
    viewportWidth: 390,
    autoProfile: "compact",
    profile: "compact",
    override: "auto",
    overrideLabel: "Auto",
    tokens: {},
    setOverride: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({
  FeatureFlagsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useRefreshControl", () => ({
  RefreshControlProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useLightingStudio", () => ({
  LightingStudioProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLightingStudio: () => ({
    studioState: { activeProfileId: null, profiles: [], automation: {} },
    capabilities: {},
    rawDeviceState: {},
    resolved: { activeProfile: null, activeAutomationChip: null, resolvedState: {}, contextLens: [], sourceCue: null },
    connectionSentinelState: null,
    circadianState: null,
    playbackContext: { sourceBucket: null, activeItemLabel: null },
    studioOpen: false,
    contextLensOpen: false,
    previewState: null,
    manualLockEnabled: false,
    deviceLocationStatus: "idle",
    deviceLocationError: null,
    openStudio: vi.fn(),
    closeStudio: vi.fn(),
    openContextLens: vi.fn(),
    closeContextLens: vi.fn(),
    setPreviewState: vi.fn(),
    clearPreviewState: vi.fn(),
    applyPreviewAsProfileBase: vi.fn(),
    setActiveProfileId: vi.fn(),
    saveProfile: vi.fn(),
    duplicateProfile: vi.fn(),
    renameProfile: vi.fn(),
    deleteProfile: vi.fn(),
    togglePinProfile: vi.fn(),
    updateAutomation: vi.fn(),
    setPlaybackContext: vi.fn(),
    setManualLockEnabled: vi.fn(),
    lockCurrentLook: vi.fn(),
    unlockCurrentLook: vi.fn(),
    markManualLightingChange: vi.fn(),
    updateCircadianLocationPreference: vi.fn(),
    requestDeviceLocation: vi.fn(),
    isActiveProfileModified: false,
  }),
}));
vi.mock("@/components/TabBar", () => ({ TabBar: () => <div data-testid="tab-bar">Tab Bar</div> }));
vi.mock("@/components/ConnectionController", () => ({
  ConnectionController: () => <div data-testid="connection-controller" />,
}));
vi.mock("@/components/DemoModeInterstitial", () => ({
  DemoModeInterstitial: () => <div data-testid="demo-mode-interstitial" />,
}));
vi.mock("@/components/TraceContextBridge", () => ({ TraceContextBridge: mocks.traceContextBridge }));
vi.mock("@/components/diagnostics/GlobalDiagnosticsOverlay", () => ({
  GlobalDiagnosticsOverlay: () => <div data-testid="global-diagnostics-overlay" />,
}));
vi.mock("@/components/TestHeartbeat", () => ({
  TestHeartbeat: () => <div data-testid="test-heartbeat">Heartbeat</div>,
}));
vi.mock("@/components/lighting/LightingStudioDialog", () => ({
  LightingStudioDialog: () => <div data-testid="lighting-studio-dialog" />,
  LightingAutomationCue: () => <div data-testid="lighting-automation-cue" />,
}));

vi.mock("@/lib/logging", () => ({ addErrorLog: mocks.addErrorLog, addLog: mocks.addLog }));
vi.mock("@/lib/query/c64QueryInvalidation", () => ({
  invalidateForVisibilityResume: mocks.invalidateForVisibilityResume,
}));
vi.mock("@/lib/navigation/navigationGuards", () => ({ useNavigationGuardBlocker: mocks.useNavigationGuardBlocker }));
vi.mock("@/lib/ui/buttonInteraction", () => ({
  registerGlobalButtonInteractionModel: mocks.registerGlobalButtonInteractionModel,
}));
vi.mock("@/lib/diagnostics/logger", () => ({ installConsoleDiagnosticsBridge: mocks.installConsoleDiagnosticsBridge }));
vi.mock("@/lib/native/diagnosticsBridge", () => ({
  startNativeDiagnosticsBridge: mocks.startNativeDiagnosticsBridge,
  stopNativeDiagnosticsBridge: mocks.stopNativeDiagnosticsBridge,
}));
vi.mock("@/lib/diagnostics/nativeDebugSnapshots", () => ({
  startNativeDebugSnapshotPublisher: mocks.startNativeDebugSnapshotPublisher,
}));
vi.mock("@/lib/diagnostics/webServerLogs", () => ({ startWebServerLogBridge: mocks.startWebServerLogBridge }));
vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: mocks.createActionContext,
  getActiveAction: mocks.getActiveAction,
}));
vi.mock("@/lib/tracing/traceSession", () => ({
  recordActionEnd: mocks.recordActionEnd,
  recordActionStart: mocks.recordActionStart,
  recordTraceError: mocks.recordTraceError,
}));
vi.mock("@/lib/config/appSettings", () => ({ loadDebugLoggingEnabled: mocks.loadDebugLoggingEnabled }));
vi.mock("@/lib/native/platform", () => ({ getPlatform: mocks.getPlatform }));
vi.mock("@/lib/native/safUtils", () => ({ redactTreeUri: mocks.redactTreeUri }));
vi.mock("@/lib/native/folderPicker", () => ({ FolderPicker: { getPersistedUris: mocks.getPersistedUris } }));
vi.mock("@/lib/i18n", () => ({ t: (_key: string, fallback: string) => fallback }));

vi.mock("@/pages/HomePage", () => ({ default: () => <div>Home Page</div> }));
vi.mock("@/pages/ConfigBrowserPage", () => ({ default: () => <div>Config Browser Page</div> }));
vi.mock("@/pages/SettingsPage", () => ({ default: () => <div>Settings Page</div> }));
vi.mock("@/pages/OpenSourceLicensesPage", () => ({ default: () => <div>Open Source Licenses</div> }));
vi.mock("@/pages/DocsPage", () => ({ default: () => <div>Docs Page</div> }));
vi.mock("@/pages/NotFound", () => ({ default: () => <div>Not Found</div> }));
vi.mock("@/pages/PlayFilesPage", () => ({ default: () => <div>Play Files Page</div> }));
vi.mock("@/pages/DisksPage", () => ({ default: () => <div>Disks Page</div> }));
vi.mock("@/pages/CoverageProbePage", () => ({ default: () => <div>Coverage Probe Page</div> }));

import App, { shouldEnableCoverageProbe } from "@/App";

describe("App runtime wiring", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    mocks.addErrorLog.mockReset();
    mocks.addLog.mockReset();
    mocks.invalidateForVisibilityResume.mockReset();
    mocks.useNavigationGuardBlocker.mockReset();
    mocks.registerGlobalButtonInteractionModel.mockReset();
    mocks.installConsoleDiagnosticsBridge.mockReset();
    mocks.startNativeDiagnosticsBridge.mockClear();
    mocks.stopNativeDiagnosticsBridge.mockClear();
    mocks.startNativeDebugSnapshotPublisher.mockReset();
    mocks.startWebServerLogBridge.mockReset();
    mocks.recordActionStart.mockReset();
    mocks.recordActionEnd.mockReset();
    mocks.recordTraceError.mockReset();
    mocks.createActionContext.mockClear();
    mocks.getActiveAction.mockReset();
    mocks.loadDebugLoggingEnabled.mockReset();
    mocks.getPlatform.mockReset();
    mocks.redactTreeUri.mockClear();
    mocks.getPersistedUris.mockReset();
    mocks.uninstallConsoleBridge.mockReset();
    mocks.buttonInteractionCleanup.mockReset();
    mocks.debugSnapshotCleanup.mockReset();
    mocks.webServerLogCleanup.mockReset();
    mocks.traceContextBridge.mockReset();

    Object.defineProperty(window, "__c64uTestProbeEnabled", {
      configurable: true,
      value: false,
      writable: true,
    });

    mocks.installConsoleDiagnosticsBridge.mockReturnValue(mocks.uninstallConsoleBridge);
    mocks.registerGlobalButtonInteractionModel.mockReturnValue(mocks.buttonInteractionCleanup);
    mocks.startNativeDebugSnapshotPublisher.mockReturnValue(mocks.debugSnapshotCleanup);
    mocks.startWebServerLogBridge.mockReturnValue(mocks.webServerLogCleanup);
    mocks.traceContextBridge.mockImplementation(() => <div data-testid="trace-context-bridge" />);
    mocks.loadDebugLoggingEnabled.mockReturnValue(false);
    mocks.getPlatform.mockReturnValue("web");
    mocks.getActiveAction.mockReturnValue(null);
    mocks.getPersistedUris.mockResolvedValue({ uris: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the coverage probe route and heartbeat when the runtime probe flag is enabled", async () => {
    Object.defineProperty(window, "__c64uTestProbeEnabled", {
      configurable: true,
      value: true,
      writable: true,
    });
    window.history.pushState({}, "", "/__coverage__");

    render(<App />);

    expect(await screen.findByText("Coverage Probe Page")).toBeInTheDocument();
    expect(screen.getByTestId("test-heartbeat")).toBeInTheDocument();
    expect(mocks.registerGlobalButtonInteractionModel).toHaveBeenCalledTimes(1);
    expect(mocks.useNavigationGuardBlocker).toHaveBeenCalledTimes(1);
  });

  it("renders NotFound for unknown routes outside the swipe navigation pages", async () => {
    window.history.pushState({}, "", "/definitely-not-a-tab");

    render(<App />);

    expect(await screen.findByText("Not Found")).toBeInTheDocument();
  });

  it("returns false for coverage probes when no window object is available", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error test-only window removal for the no-window branch
    delete globalThis.window;

    try {
      expect(shouldEnableCoverageProbe()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
        writable: true,
      });
    }
  });

  it("returns true for coverage probes when the build-time probe flag is enabled", () => {
    const originalProbeFlag = import.meta.env.VITE_ENABLE_TEST_PROBES;
    import.meta.env.VITE_ENABLE_TEST_PROBES = "1";

    try {
      expect(shouldEnableCoverageProbe()).toBe(true);
    } finally {
      import.meta.env.VITE_ENABLE_TEST_PROBES = originalProbeFlag;
    }
  });

  it("updates the swipe navigation active slot after navigating away from /play", async () => {
    window.history.pushState({}, "", "/play");
    render(<App />);

    expect(await screen.findByText("Play Files Page")).toBeInTheDocument();
    expect(await screen.findByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");

    await act(async () => {
      window.history.pushState({}, "", "/settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "false");
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-active", "true");
  });

  it("wraps from the last page to the first page on a touch swipe left", async () => {
    window.history.pushState({}, "", "/docs");
    render(<App />);

    expect(await screen.findByText("Docs Page")).toBeInTheDocument();

    const container = screen.getByTestId("swipe-navigation-container");
    const runway = screen.getByTestId("swipe-navigation-runway");

    fireEvent.pointerDown(container, {
      button: -1,
      pointerId: 91,
      isPrimary: true,
      pointerType: "touch",
      clientX: 220,
      clientY: 180,
    });
    fireEvent.pointerMove(container, {
      pointerId: 91,
      pointerType: "touch",
      clientX: 120,
      clientY: 184,
    });
    fireEvent.pointerUp(container, {
      pointerId: 91,
      pointerType: "touch",
      clientX: 120,
      clientY: 184,
    });

    await waitFor(() => {
      expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    });

    fireEvent.transitionEnd(runway, { target: runway });

    expect(await screen.findByText("Home Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-home")).toHaveAttribute("data-slot-active", "true");
  });

  it("invalidates visible-route queries on visibility resume", async () => {
    window.history.pushState({}, "", "/settings");
    const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });

    render(<App />);
    await screen.findByText("Settings Page");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mocks.invalidateForVisibilityResume).toHaveBeenCalledWith(expect.anything(), "/settings");

    if (originalHidden) {
      Object.defineProperty(document, "hidden", originalHidden);
    }
  });

  it("does not invalidate queries while the document remains hidden", async () => {
    window.history.pushState({}, "", "/settings");
    const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });

    render(<App />);
    await screen.findByText("Settings Page");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mocks.invalidateForVisibilityResume).not.toHaveBeenCalled();

    if (originalHidden) {
      Object.defineProperty(document, "hidden", originalHidden);
    }
  });

  it("records window errors when no active action exists", async () => {
    render(<App />);
    await screen.findByText("Home Page");

    const error = new Error("boom");
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "boom", error, filename: "app.tsx", lineno: 12, colno: 4 }),
      );
    });

    expect(mocks.createActionContext).toHaveBeenCalledWith("Window error", "system", "GlobalErrorListener");
    expect(mocks.recordActionStart).toHaveBeenCalledTimes(1);
    expect(mocks.recordTraceError).toHaveBeenCalledWith(expect.objectContaining({ name: "Window error" }), error);
    expect(mocks.recordActionEnd).toHaveBeenCalledWith(expect.objectContaining({ name: "Window error" }), error);
    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "Window error",
      expect.objectContaining({ message: "boom", filename: "app.tsx", lineno: 12, colno: 4, stack: error.stack }),
    );
  });

  it('falls back to the default "Window error" message when the browser event has no error payload', async () => {
    render(<App />);
    await screen.findByText("Home Page");

    act(() => {
      window.dispatchEvent(new ErrorEvent("error"));
    });

    expect(mocks.recordTraceError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Window error" }),
      expect.objectContaining({ message: "Window error" }),
    );
  });

  it("records unhandled rejections against the current active action", async () => {
    const activeAction = { id: "active-action" };
    mocks.getActiveAction.mockReturnValue(activeAction);

    render(<App />);
    await screen.findByText("Home Page");

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      configurable: true,
      value: new Error("async boom"),
    });

    act(() => {
      window.dispatchEvent(rejection);
    });

    expect(mocks.recordTraceError).toHaveBeenCalledWith(
      activeAction,
      expect.objectContaining({ message: "async boom" }),
    );
    expect(mocks.createActionContext).not.toHaveBeenCalledWith(
      "Unhandled promise rejection",
      "system",
      "GlobalErrorListener",
    );
    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      expect.objectContaining({ reason: expect.objectContaining({ message: "async boom" }) }),
    );
  });

  it("records window errors against the current active action when one exists", async () => {
    const activeAction = { id: "active-action" };
    mocks.getActiveAction.mockReturnValue(activeAction);

    render(<App />);
    await screen.findByText("Home Page");

    const error = new Error("boom");
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "boom", error, filename: "app.tsx", lineno: 1, colno: 1 }),
      );
    });

    expect(mocks.recordTraceError).toHaveBeenCalledWith(activeAction, error);
    expect(mocks.createActionContext).not.toHaveBeenCalledWith("Window error", "system", "GlobalErrorListener");
    expect(mocks.addErrorLog).toHaveBeenCalledWith("Window error", expect.objectContaining({ message: "boom" }));
  });

  it("records unhandled rejections when no active action exists", async () => {
    render(<App />);
    await screen.findByText("Home Page");

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { configurable: true, value: new Error("async fail") });

    act(() => {
      window.dispatchEvent(rejection);
    });

    expect(mocks.createActionContext).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      "system",
      "GlobalErrorListener",
    );
    expect(mocks.recordActionStart).toHaveBeenCalledTimes(1);
    expect(mocks.recordActionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Unhandled promise rejection" }),
      expect.objectContaining({ message: "async fail" }),
    );
    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      expect.objectContaining({ reason: expect.objectContaining({ message: "async fail" }) }),
    );
  });

  it("normalizes non-error unhandled rejections into Error objects", async () => {
    render(<App />);
    await screen.findByText("Home Page");

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { configurable: true, value: "plain rejection" });

    act(() => {
      window.dispatchEvent(rejection);
    });

    expect(mocks.recordTraceError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Unhandled promise rejection" }),
      expect.objectContaining({ message: "plain rejection" }),
    );
  });

  it('falls back to the default "Unhandled rejection" message when the rejection event has no reason', async () => {
    render(<App />);
    await screen.findByText("Home Page");

    const rejection = new Event("unhandledrejection");

    act(() => {
      window.dispatchEvent(rejection);
    });

    expect(mocks.recordTraceError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Unhandled promise rejection" }),
      expect.objectContaining({ message: "Unhandled rejection" }),
    );
  });

  it("starts deferred diagnostics bridges on first meaningful interaction and cleans them up on unmount", async () => {
    const { unmount } = render(<App />);
    await screen.findByText("Home Page");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-startup-milestone", { detail: { name: "first-meaningful-interaction" } }),
      );
    });

    await waitFor(() => {
      expect(mocks.startNativeDiagnosticsBridge).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(mocks.uninstallConsoleBridge).toHaveBeenCalledTimes(1);
    expect(mocks.debugSnapshotCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.webServerLogCleanup).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mocks.stopNativeDiagnosticsBridge).toHaveBeenCalledTimes(1);
    });
  });

  it("logs persisted SAF URIs on android startup when debug logging is enabled", async () => {
    mocks.getPlatform.mockReturnValue("android");
    mocks.loadDebugLoggingEnabled.mockReturnValue(true);
    mocks.getPersistedUris.mockResolvedValue({ uris: [{ uri: "content://tree/one" }, { uri: "content://tree/two" }] });

    render(<App />);
    await screen.findByText("Home Page");

    await waitFor(() => {
      expect(mocks.addLog).toHaveBeenCalledWith(
        "debug",
        "SAF persisted URIs on startup",
        expect.objectContaining({
          count: 2,
          uris: ["redacted:content://tree/one", "redacted:content://tree/two"],
        }),
      );
    });
  });

  it("logs persisted URI lookup failures on android startup when the folder picker rejects", async () => {
    mocks.getPlatform.mockReturnValue("android");
    mocks.loadDebugLoggingEnabled.mockReturnValue(true);
    mocks.getPersistedUris.mockRejectedValue(new Error("picker failed"));

    render(<App />);
    await screen.findByText("Home Page");

    await waitFor(() => {
      expect(mocks.addLog).toHaveBeenCalledWith(
        "debug",
        "SAF persisted URI lookup failed",
        expect.objectContaining({ error: "picker failed" }),
      );
    });
  });

  it("skips persisted SAF URI startup logging outside android or when debug logging is disabled", async () => {
    mocks.getPlatform.mockReturnValue("web");
    mocks.loadDebugLoggingEnabled.mockReturnValue(false);

    render(<App />);
    await screen.findByText("Home Page");

    await waitFor(() => {
      expect(mocks.getPersistedUris).not.toHaveBeenCalled();
    });
    expect(mocks.addLog).not.toHaveBeenCalledWith("debug", "SAF persisted URIs on startup", expect.anything());
  });

  it("renders the app fallback and reloads after a top-level render error", async () => {
    const reload = vi.fn();
    const originalLocation = window.location;

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        reload,
      },
    });

    mocks.traceContextBridge.mockImplementation(() => {
      throw new Error("trace bridge render failed");
    });

    render(<App />);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText("The app hit an unexpected error. Please reopen the page or try again."),
    ).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Reload" }).click();
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "React render error",
      expect.objectContaining({
        message: "trace bridge render failed",
        componentStack: expect.any(String),
      }),
    );

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
