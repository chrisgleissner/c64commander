/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
}));
vi.mock("@/hooks/useFeatureFlags", () => ({
  FeatureFlagsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useRefreshControl", () => ({
  RefreshControlProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

import App from "@/App";

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

  it("keeps the play route mounted and hides it after navigation away from /play", async () => {
    window.history.pushState({}, "", "/play");
    render(<App />);

    expect(await screen.findByText("Play Files Page")).toBeInTheDocument();
    const routeContainer = await screen.findByTestId("persistent-play-files-route");
    expect(routeContainer).toHaveAttribute("aria-hidden", "false");
    expect(routeContainer.className).toContain("contents");

    await act(async () => {
      window.history.pushState({}, "", "/settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByTestId("persistent-play-files-route")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("persistent-play-files-route").className).toContain("hidden");
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
