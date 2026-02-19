/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import { ConnectionController } from '@/components/ConnectionController';
import { DemoModeInterstitial } from '@/components/DemoModeInterstitial';
import { RefreshControlProvider } from "@/hooks/useRefreshControl";
import { addErrorLog, addLog } from "@/lib/logging";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { SidPlayerProvider } from "@/hooks/useSidPlayer";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";
import { TraceContextBridge } from '@/components/TraceContextBridge';
import { GlobalDiagnosticsOverlay } from '@/components/diagnostics/GlobalDiagnosticsOverlay';
import { TestHeartbeat } from '@/components/TestHeartbeat';
import { createActionContext, getActiveAction } from '@/lib/tracing/actionTrace';
import { recordActionEnd, recordActionStart, recordTraceError } from '@/lib/tracing/traceSession';
import { registerGlobalButtonInteractionModel } from '@/lib/ui/buttonInteraction';
import { installConsoleDiagnosticsBridge } from '@/lib/diagnostics/logger';
import { invalidateForVisibilityResume } from '@/lib/query/c64QueryInvalidation';

const HomePage = lazy(() => import('./pages/HomePage'));
const ConfigBrowserPage = lazy(() => import('./pages/ConfigBrowserPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const NotFound = lazy(() => import('./pages/NotFound'));
const PlayFilesPage = lazy(() => import('./pages/PlayFilesPage'));
const DisksPage = lazy(() => import('./pages/DisksPage'));
const CoverageProbePage = lazy(() => import('./pages/CoverageProbePage'));

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
        invalidateForVisibilityResume(client, location.pathname);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [client, location.pathname]);

  return null;
};

const shouldEnableCoverageProbe = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') return true;
  if (typeof window !== 'undefined') {
    return Boolean((window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled);
  }
  return false;
};

const RouteLoadingFallback = () => (
  <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    Loading screen...
  </div>
);

const AppRoutes = () => {
  const coverageProbeEnabled = shouldEnableCoverageProbe();
  return (
    <BrowserRouter>
      <GlobalErrorListener />
      <GlobalButtonInteractionModel />
      <RouteRefresher />
      <DebugStartupLogger />
      <DiagnosticsRuntimeBridge />
      <TraceContextBridge />
      <GlobalDiagnosticsOverlay />
      <ConnectionController />
      <DemoModeInterstitial />
      {coverageProbeEnabled && <TestHeartbeat />}
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {coverageProbeEnabled ? (
            <Route path="/__coverage__" element={<CoverageProbePage />} />
          ) : null}
          <Route path="/" element={<HomePage />} />
          <Route path="/config" element={<ConfigBrowserPage />} />
          <Route path="/play" element={<PlayFilesPage />} />
          <Route path="/disks" element={<DisksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <TabBar />
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <FeatureFlagsProvider>
          <RefreshControlProvider>
            {shouldEnableCoverageProbe() ? (
              <SidPlayerProvider>
                <AppErrorBoundary>
                  <AppRoutes />
                </AppErrorBoundary>
              </SidPlayerProvider>
            ) : (
              <AppErrorBoundary>
                <AppRoutes />
              </AppErrorBoundary>
            )}
          </RefreshControlProvider>
        </FeatureFlagsProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const GlobalErrorListener = () => {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const activeAction = getActiveAction();
      const error = event.error instanceof Error ? event.error : new Error(event.message || 'Window error');
      if (activeAction) {
        recordTraceError(activeAction, error);
      } else {
        const context = createActionContext('Window error', 'system', 'GlobalErrorListener');
        recordActionStart(context);
        recordTraceError(context, error);
        recordActionEnd(context, error);
      }
      addErrorLog('Window error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const activeAction = getActiveAction();
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? 'Unhandled rejection'));
      if (activeAction) {
        recordTraceError(activeAction, error);
      } else {
        const context = createActionContext('Unhandled promise rejection', 'system', 'GlobalErrorListener');
        recordActionStart(context);
        recordTraceError(context, error);
        recordActionEnd(context, error);
      }
      addErrorLog('Unhandled promise rejection', {
        reason: event.reason,
      });
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
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
      const [
        diagnosticsBridgeModule,
        nativeDebugSnapshotsModule,
        webServerLogsModule,
      ] = await Promise.all([
        import('@/lib/native/diagnosticsBridge'),
        import('@/lib/diagnostics/nativeDebugSnapshots'),
        import('@/lib/diagnostics/webServerLogs'),
      ]);
      if (disposed) return;
      stopNativeDiagnosticsBridge = diagnosticsBridgeModule.stopNativeDiagnosticsBridge;
      stopDebugSnapshotPublisher = nativeDebugSnapshotsModule.startNativeDebugSnapshotPublisher();
      stopWebServerLogBridge = webServerLogsModule.startWebServerLogBridge();
      await diagnosticsBridgeModule.startNativeDiagnosticsBridge();
    };

    const handleStartupMilestone = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name !== 'first-meaningful-interaction') return;
      void startDeferredBridges();
    };

    window.addEventListener('c64u-startup-milestone', handleStartupMilestone);
    return () => {
      disposed = true;
      window.removeEventListener('c64u-startup-milestone', handleStartupMilestone);
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
    addErrorLog('React render error', {
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
            <p className="text-lg font-semibold text-foreground">Something went wrong</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit an unexpected error. Please reopen the page or try again.
            </p>
            <Button className="mt-4" onClick={() => window.location.reload()}>
              Reload
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
    if (getPlatform() !== 'android') return;
    if (!loadDebugLoggingEnabled()) return;
    void import('@/lib/native/folderPicker')
      .then(({ FolderPicker }) => FolderPicker.getPersistedUris())
      .then((result) => {
        const uris = result?.uris ?? [];
        addLog('debug', 'SAF persisted URIs on startup', {
          count: uris.length,
          uris: uris.map((entry) => redactTreeUri(entry.uri)),
        });
      })
      .catch((error) => {
        addLog('debug', 'SAF persisted URI lookup failed', { error: (error as Error).message });
      });
  }, []);
  return null;
};

export default App;
