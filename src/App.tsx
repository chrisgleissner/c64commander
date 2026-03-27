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
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import React, { Suspense, lazy, useEffect } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import { ConnectionController } from "@/components/ConnectionController";
import { DemoModeInterstitial } from "@/components/DemoModeInterstitial";
import { RefreshControlProvider } from "@/hooks/useRefreshControl";
import { addErrorLog, addLog } from "@/lib/logging";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { TraceContextBridge } from "@/components/TraceContextBridge";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { TestHeartbeat } from "@/components/TestHeartbeat";
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
import { tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { t } from "@/lib/i18n";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { SwipeNavigationLayer } from "@/components/SwipeNavigationLayer";
import { LightingStudioProvider } from "@/hooks/useLightingStudio";
import { LightingStudioDialog } from "@/components/lighting/LightingStudioDialog";

const NotFound = lazy(() => import("./pages/NotFound"));
const CoverageProbePage = lazy(() => import("./pages/CoverageProbePage"));

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
  if (typeof window !== "undefined") {
    return Boolean((window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled);
  }
  return false;
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

const AppRoutes = () => {
  const coverageProbeEnabled = shouldEnableCoverageProbe();
  return (
    <BrowserRouter>
      <LightingStudioProvider>
        <InterstitialStateProvider>
          <GlobalErrorListener />
          <GlobalButtonInteractionModel />
          <GlobalNavigationBlocker />
          <RouteRefresher />
          <DebugStartupLogger />
          <DiagnosticsRuntimeBridge />
          <TraceContextBridge />
          <GlobalDiagnosticsOverlay />
          <ConnectionController />
          <DemoModeInterstitial />
          <LightingStudioDialog />
          {coverageProbeEnabled && <TestHeartbeat />}
          <Suspense fallback={<RouteLoadingFallback />}>
            <SwipeNavigationLayer />
            <Routes>
              {coverageProbeEnabled ? <Route path="/__coverage__" element={<CoverageProbePage />} /> : null}
              <Route path="*" element={<NotFoundForUnknownPaths />} />
            </Routes>
          </Suspense>
          <TabBar />
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
                <AppRoutes />
              </AppErrorBoundary>
            </RefreshControlProvider>
          </FeatureFlagsProvider>
        </TooltipProvider>
      </DisplayProfileProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

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

export class PageErrorBoundary extends React.Component<
  { children: React.ReactNode; active?: boolean },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { children: React.ReactNode; active?: boolean }) {
    if (!prevProps.active && this.props.active && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addErrorLog("Page render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.active === false) {
        return null;
      }

      return (
        <div
          className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10"
          data-testid="page-error-boundary-fallback"
        >
          <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow">
            <p className="text-sm font-semibold text-foreground">{t("app.error.title", "Something went wrong")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("app.error.description", "The app hit an unexpected error. Please reopen the page or try again.")}
            </p>
            <Button size="sm" className="mt-3" onClick={() => this.setState({ hasError: false })}>
              {t("app.error.retry", "Try again")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
