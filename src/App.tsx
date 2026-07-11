/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import { ConnectionController } from "@/components/ConnectionController";
import { DemoModeInterstitial } from "@/components/DemoModeInterstitial";
import { DeviceDiscoveryInterstitial } from "@/components/DeviceDiscoveryInterstitial";
import { DeviceAuthChallengeDialog } from "@/components/DeviceAuthChallengeDialog";
import { RefreshControlProvider } from "@/hooks/useRefreshControl";
import { addErrorLog, addLog } from "@/lib/logging";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { FeatureFlagsProvider, useFeatureFlags } from "@/hooks/useFeatureFlags";
import { FocusNavigationProvider, type KeypadShortcutHandlers } from "@/hooks/useFocusNavigation";
import { TraceContextBridge } from "@/components/TraceContextBridge";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { KeypadQuickMenu } from "@/components/input/KeypadQuickMenu";
import { requestDiagnosticsOpen } from "@/lib/diagnostics/diagnosticsOverlay";
import { requestDeviceSwitcherOpen, requestQuickMenuOpen } from "@/lib/input/keypadCommands";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { createActionContext, getActiveAction } from "@/lib/tracing/actionTrace";
import { recordActionEnd, recordActionStart, recordTraceError } from "@/lib/tracing/traceSession";
import { registerGlobalButtonInteractionModel } from "@/lib/ui/buttonInteraction";
import { installConsoleDiagnosticsBridge } from "@/lib/diagnostics/logger";
import {
  runConfigReconciler,
  runDiagnosticsReconciler,
  runPlaybackReconciler,
} from "@/lib/diagnostics/diagnosticsReconciler";
import { useNavigationGuardBlocker } from "@/lib/navigation/navigationGuards";
import { tabIndexForPath, TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { t } from "@/lib/i18n";

const isAbortLikeError = (error: unknown) => {
  return classifyError(error).failureClass === "user-cancellation";
};

const describeUnhandledRejectionReason = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "AbortError");
};
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { SwipeNavigationLayer } from "@/components/SwipeNavigationLayer";
import { LightingStudioProvider } from "@/hooks/useLightingStudio";
import { LightingStudioDialog } from "@/components/lighting/LightingStudioDialog";
import { StartupLaunchSequence } from "@/components/StartupLaunchSequence";
import {
  markStartupLaunchSequenceComplete,
  resolveStartupLaunchSequenceTimings,
  runLaunchSequence,
  shouldShowStartupLaunchSequence,
  type LaunchSequencePhase,
} from "@/lib/startup/launchSequence";

const NotFound = lazy(() => import("./pages/NotFound"));

export const shouldBundleCoverageProbeModules = () =>
  import.meta.env.VITE_ENABLE_TEST_PROBES === "1" || !import.meta.env.PROD;

type CoverageProbeModules = {
  CoverageProbePage: React.LazyExoticComponent<React.ComponentType> | null;
  DeviceSwitchLabPage: React.LazyExoticComponent<React.ComponentType> | null;
  TestHeartbeat: React.LazyExoticComponent<React.ComponentType> | null;
  DeviceSwitchLabLauncher: React.LazyExoticComponent<React.ComponentType> | null;
};

// Computed lazily (never at module scope) and memoized so every caller gets the
// SAME lazy() component references across renders — constructing lazy() fresh
// each call would remount Suspense boundaries. Calling shouldBundleCoverageProbeModules()
// at module-evaluation time (rather than from here, at first actual use) crashed
// Playwright's Node-based `--list` collection for any spec transitively importing
// this module, since import.meta.env isn't available under Vite's transform there.
let cachedCoverageProbeModules: CoverageProbeModules | null = null;
const getCoverageProbeModules = (): CoverageProbeModules => {
  if (cachedCoverageProbeModules) return cachedCoverageProbeModules;
  const available = shouldBundleCoverageProbeModules();
  cachedCoverageProbeModules = {
    CoverageProbePage: available ? lazy(() => import("./pages/CoverageProbePage")) : null,
    DeviceSwitchLabPage: available ? lazy(() => import("./pages/DeviceSwitchLabPage")) : null,
    TestHeartbeat: available
      ? lazy(async () => ({ default: (await import("@/components/TestHeartbeat")).TestHeartbeat }))
      : null,
    DeviceSwitchLabLauncher: available
      ? lazy(async () => ({
          default: (await import("@/components/DeviceSwitchLabLauncher")).DeviceSwitchLabLauncher,
        }))
      : null,
  };
  return cachedCoverageProbeModules;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteRefresher = () => {
  const location = useLocation();
  const client = useQueryClient();

  useEffect(() => {
    const handleVisibility = () => {
      const visible = !document.hidden;
      if (visible) {
        void runDiagnosticsReconciler("App resumed while diagnostics runtime was active");
        void runConfigReconciler(client, location.pathname, "App resumed and route-backed config needs refresh");
        void runPlaybackReconciler("App resumed and playback certainty may have decayed");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [client, location.pathname]);

  return null;
};

const GlobalNavigationBlocker = () => {
  useNavigationGuardBlocker();
  return null;
};

export const shouldEnableCoverageProbe = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (!shouldBundleCoverageProbeModules()) return false;
  if (typeof window !== "undefined") {
    return Boolean((window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled);
  }
  return false;
};

export const shouldAutoLaunchDeviceSwitchLab = () => {
  const rawPlan = import.meta.env.VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON;
  return Boolean(rawPlan?.trim());
};

const DeviceSwitchLabLauncherGate = ({ enabled }: { enabled: boolean }) => {
  const location = useLocation();
  const { DeviceSwitchLabLauncher } = getCoverageProbeModules();

  if (!enabled || !DeviceSwitchLabLauncher) {
    return null;
  }

  const shouldShowLauncher = shouldAutoLaunchDeviceSwitchLab() || location.pathname === "/__device-switch__";
  if (!shouldShowLauncher) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <DeviceSwitchLabLauncher />
    </Suspense>
  );
};

const RouteLoadingFallback = () => (
  <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    {t("app.loadingScreen", "Loading screen...")}
  </div>
);

/**
 * Renders NotFound only for genuinely unknown paths — not for primary tab routes
 * or known sub-routes (which are rendered inside the SwipeNavigationLayer slots).
 */
export const NotFoundForUnknownPaths = () => {
  const location = useLocation();
  if (tabIndexForPath(location.pathname) >= 0) return null;
  return <NotFound />;
};

const DeviceSwitchLabAutoLauncher = ({ enabled }: { enabled: boolean }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hasNavigatedRef = React.useRef(false);

  useEffect(() => {
    if (!enabled || hasNavigatedRef.current) {
      return;
    }
    if (!shouldAutoLaunchDeviceSwitchLab()) {
      return;
    }
    if (location.pathname === "/__device-switch__") {
      hasNavigatedRef.current = true;
      return;
    }
    hasNavigatedRef.current = true;
    navigate("/__device-switch__", { replace: true });
  }, [enabled, location.pathname, navigate]);

  return null;
};

/**
 * Input profile that drives the keypad-first focus ring for keypad/T9 input. No
 * runtime profile selector exists yet, so the only profile is the generic
 * keypad keymap (D-pad + numeric keypad).
 */
const KEYPAD_FOCUS_PROFILE_ID = "keypad";

/**
 * Keyboard / D-pad / keypad navigation is gated on the user-visible,
 * **default-on** experimental `keypad_input_enabled` flag (group `experimental`;
 * users can still disable it; the C64U Remote variant bakes its own override).
 * The provider ALWAYS mounts; the flag only drives `enabled`. With the flag off
 * the global key listener + scope-discovery engine are detached, no `tabindex`/
 * attributes are written, and pointer/keyboard behaviour is byte-for-byte
 * baseline (the Prime Directive).
 *
 * `KeypadFocusNavigation` renders inside `FeatureFlagsProvider`, so reading the
 * flag here is safe.
 */
const KeypadFocusNavigation = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const { flags } = useFeatureFlags();
  const shortcuts = useMemo<KeypadShortcutHandlers>(
    () => ({
      jumpToTab: (index) => {
        const route = TAB_ROUTES[index];
        if (route) navigate(route.path);
      },
      openDiagnostics: () => requestDiagnosticsOpen("header"),
      openDeviceSwitcher: () => requestDeviceSwitcherOpen(),
      openQuickMenu: () => requestQuickMenuOpen(),
    }),
    [navigate],
  );
  return (
    <FocusNavigationProvider
      enabled={flags.keypad_input_enabled}
      profileId={KEYPAD_FOCUS_PROFILE_ID}
      onNavigateBack={() => navigate(-1)}
      shortcuts={shortcuts}
    >
      {children}
    </FocusNavigationProvider>
  );
};

const AppRoutes = () => {
  const coverageProbeEnabled = shouldEnableCoverageProbe();
  const { CoverageProbePage, DeviceSwitchLabPage, TestHeartbeat } = getCoverageProbeModules();
  return (
    <BrowserRouter>
      <LightingStudioProvider>
        <InterstitialStateProvider>
          <KeypadFocusNavigation>
            <DeviceSwitchLabAutoLauncher enabled={coverageProbeEnabled} />
            <GlobalErrorListener />
            <GlobalButtonInteractionModel />
            <GlobalNavigationBlocker />
            <RouteRefresher />
            <DebugStartupLogger />
            <DiagnosticsRuntimeBridge />
            <TraceContextBridge />
            <GlobalDiagnosticsOverlay />
            <KeypadQuickMenu />
            <ConnectionController />
            <DemoModeInterstitial />
            <DeviceDiscoveryInterstitial />
            <DeviceAuthChallengeDialog />
            <LightingStudioDialog />
            {coverageProbeEnabled && TestHeartbeat ? (
              <Suspense fallback={null}>
                <TestHeartbeat />
              </Suspense>
            ) : null}
            <DeviceSwitchLabLauncherGate enabled={coverageProbeEnabled} />
            <Suspense fallback={<RouteLoadingFallback />}>
              <SwipeNavigationLayer />
              <Routes>
                {coverageProbeEnabled && CoverageProbePage ? (
                  <Route path="/__coverage__" element={<CoverageProbePage />} />
                ) : null}
                {coverageProbeEnabled && DeviceSwitchLabPage ? (
                  <Route path="/__device-switch__" element={<DeviceSwitchLabPage />} />
                ) : null}
                <Route path="*" element={<NotFoundForUnknownPaths />} />
              </Routes>
            </Suspense>
            <TabBar />
          </KeypadFocusNavigation>
        </InterstitialStateProvider>
      </LightingStudioProvider>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <DisplayProfileProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <FeatureFlagsProvider>
            <RefreshControlProvider>
              <AppErrorBoundary>
                <StartupLaunchCoordinator />
              </AppErrorBoundary>
            </RefreshControlProvider>
          </FeatureFlagsProvider>
        </TooltipProvider>
      </DisplayProfileProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const StartupLaunchCoordinator = () => {
  const timings = React.useMemo(() => resolveStartupLaunchSequenceTimings(), []);
  const [phase, setPhase] = React.useState<LaunchSequencePhase>(() =>
    shouldShowStartupLaunchSequence() ? "fade-in" : "app-ready",
  );
  const [visible, setVisible] = React.useState(() => shouldShowStartupLaunchSequence());

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    return runLaunchSequence({
      timings,
      onPhaseChange: (nextPhase) => {
        setPhase(nextPhase);
        if (nextPhase === "app-ready") {
          markStartupLaunchSequenceComplete();
          setVisible(false);
        }
      },
    });
  }, [timings, visible]);

  const activePhase: LaunchSequencePhase = visible ? phase : "app-ready";

  return (
    <>
      <div
        className="app-launch-shell"
        data-launch-phase={activePhase}
        data-launch-visible={visible ? "true" : "false"}
        data-testid="app-shell"
        style={{ "--app-launch-fade-in-ms": `${timings.fadeOutMs}ms` } as React.CSSProperties}
      >
        <AppRoutes />
      </div>
      {visible ? <StartupLaunchSequence phase={phase} timings={timings} /> : null}
    </>
  );
};

const GlobalErrorListener = () => {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const activeAction = getActiveAction();
      const error = event.error instanceof Error ? event.error : new Error(event.message || "Window error");
      if (activeAction) {
        recordTraceError(activeAction, error);
      } else {
        const context = createActionContext("Window error", "system", "GlobalErrorListener");
        recordActionStart(context);
        recordTraceError(context, error);
        recordActionEnd(context, error);
      }
      addErrorLog("Window error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isAbortLikeError(event.reason)) {
        event.preventDefault();
        addLog("debug", "Ignored abort-like unhandled rejection", {
          reason: describeUnhandledRejectionReason(event.reason),
        });
        return;
      }
      const activeAction = getActiveAction();
      const error =
        event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Unhandled rejection"));
      if (activeAction) {
        recordTraceError(activeAction, error);
      } else {
        const context = createActionContext("Unhandled promise rejection", "system", "GlobalErrorListener");
        recordActionStart(context);
        recordTraceError(context, error);
        recordActionEnd(context, error);
      }
      addErrorLog("Unhandled promise rejection", {
        reason: event.reason,
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
};

const GlobalButtonInteractionModel = () => {
  useEffect(() => {
    return registerGlobalButtonInteractionModel();
  }, []);
  return null;
};

const DiagnosticsRuntimeBridge = () => {
  useEffect(() => {
    const uninstallConsoleBridge = installConsoleDiagnosticsBridge();
    let disposed = false;
    let started = false;
    let stopNativeDiagnosticsBridge: (() => Promise<void>) | null = null;
    let stopDebugSnapshotPublisher: (() => void) | null = null;
    let stopWebServerLogBridge: (() => void) | null = null;

    const startDeferredBridges = async () => {
      if (started || disposed) return;
      if (getPlatform() === "web") return;
      started = true;
      const [diagnosticsBridgeModule, nativeDebugSnapshotsModule, webServerLogsModule] = await Promise.all([
        import("@/lib/native/diagnosticsBridge"),
        import("@/lib/diagnostics/nativeDebugSnapshots"),
        import("@/lib/diagnostics/webServerLogs"),
      ]);
      if (disposed) return;
      stopNativeDiagnosticsBridge = diagnosticsBridgeModule.stopNativeDiagnosticsBridge;
      stopDebugSnapshotPublisher = nativeDebugSnapshotsModule.startNativeDebugSnapshotPublisher();
      stopWebServerLogBridge = webServerLogsModule.startWebServerLogBridge();
      await diagnosticsBridgeModule.startNativeDiagnosticsBridge();
    };

    const handleStartupMilestone = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name !== "first-meaningful-interaction") return;
      void startDeferredBridges();
    };

    window.addEventListener("c64u-startup-milestone", handleStartupMilestone);
    return () => {
      disposed = true;
      window.removeEventListener("c64u-startup-milestone", handleStartupMilestone);
      uninstallConsoleBridge();
      stopDebugSnapshotPublisher?.();
      stopWebServerLogBridge?.();
      if (stopNativeDiagnosticsBridge) {
        void stopNativeDiagnosticsBridge();
      }
    };
  }, []);
  return null;
};

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addErrorLog("React render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-lg">
            <p className="text-lg font-semibold text-foreground">{t("app.error.title", "Something went wrong")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("app.error.description", "The app hit an unexpected error. Please reopen the page or try again.")}
            </p>
            <Button className="mt-4" onClick={() => window.location.reload()}>
              {t("app.error.reload", "Reload")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// PageErrorBoundary lives in its own module (imported + re-exported here) so
// SwipeNavigationLayer can share the one implementation without an App ↔
// SwipeNavigationLayer import cycle (HARD19-033).
export { PageErrorBoundary } from "@/components/PageErrorBoundary";

const DebugStartupLogger = () => {
  useEffect(() => {
    if (getPlatform() !== "android") return;
    if (!loadDebugLoggingEnabled()) return;
    void import("@/lib/native/folderPicker")
      .then(({ FolderPicker }) => FolderPicker.getPersistedUris())
      .then((result) => {
        const uris = result?.uris ?? [];
        addLog("debug", "SAF persisted URIs on startup", {
          count: uris.length,
          uris: uris.map((entry) => redactTreeUri(entry.uri)),
        });
      })
      .catch((error) => {
        addLog("debug", "SAF persisted URI lookup failed", {
          error: (error as Error).message,
        });
      });
  }, []);
  return null;
};

export default App;
