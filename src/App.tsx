import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import { MockModeBanner } from '@/components/MockModeBanner';
import HomePage from './pages/HomePage';
import ConfigBrowserPage from "./pages/ConfigBrowserPage";
import SettingsPage from "./pages/SettingsPage";
import DocsPage from "./pages/DocsPage";
import NotFound from "./pages/NotFound";
import PlayFilesPage from './pages/PlayFilesPage';
import DisksPage from './pages/DisksPage.tsx';
import CoverageProbePage from './pages/CoverageProbePage';
import { RefreshControlProvider } from "@/hooks/useRefreshControl";
import { addErrorLog, addLog } from "@/lib/logging";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import { FolderPicker } from "@/lib/native/folderPicker";
import { getPlatform } from "@/lib/native/platform";
import { redactTreeUri } from "@/lib/native/safUtils";
import { SidPlayerProvider } from "@/hooks/useSidPlayer";
import { MockModeProvider } from "@/hooks/useMockMode";
import { FeatureFlagsProvider } from "@/hooks/useFeatureFlags";

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
  const [isVisible, setIsVisible] = useState(() => !document.hidden);

  useEffect(() => {
    client.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0]?.toString().startsWith("c64"),
    });
  }, [location.pathname, client]);

  useEffect(() => {
    const handleVisibility = () => {
      const visible = !document.hidden;
      setIsVisible(visible);
      if (visible) {
        client.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0]?.toString().startsWith("c64"),
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [client]);

  return null;
};

const AppRoutes = () => (
  <BrowserRouter>
    <GlobalErrorListener />
    <RouteRefresher />
    <DebugStartupLogger />
    <MockModeBanner />
    <Routes>
      {import.meta.env.VITE_ENABLE_TEST_PROBES === '1' ? (
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
    <TabBar />
  </BrowserRouter>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <FeatureFlagsProvider>
          <RefreshControlProvider>
            <SidPlayerProvider>
              <MockModeProvider>
                <AppErrorBoundary>
                  <AppRoutes />
                </AppErrorBoundary>
              </MockModeProvider>
            </SidPlayerProvider>
          </RefreshControlProvider>
        </FeatureFlagsProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const GlobalErrorListener = () => {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addErrorLog('Window error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
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
    FolderPicker.getPersistedUris()
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
