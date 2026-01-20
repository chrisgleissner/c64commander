import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import HomePage from './pages/HomePage';
import QuickSettingsPage from "./pages/QuickSettingsPage";
import ConfigBrowserPage from "./pages/ConfigBrowserPage";
import SettingsPage from "./pages/SettingsPage";
import DocsPage from "./pages/DocsPage";
import NotFound from "./pages/NotFound";
import PlayFilesPage from './pages/PlayFilesPage';
import { RefreshControlProvider } from "@/hooks/useRefreshControl";
import { addErrorLog } from "@/lib/logging";
import MusicPlayerPage from "./pages/MusicPlayerPage";
import { SidPlayerProvider } from "@/hooks/useSidPlayer";
import { MockModeProvider } from "@/hooks/useMockMode";
import { FeatureFlagsProvider, useFeatureFlags } from "@/hooks/useFeatureFlags";
import { isSidPlayerEnabled } from "@/lib/config/featureFlags";

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

const SidPlayerRoute = () => {
  const { flags, isLoaded } = useFeatureFlags();
  const location = useLocation();
  const enabled = isSidPlayerEnabled(flags);

  useEffect(() => {
    if (!isLoaded || enabled) return;
    addErrorLog('SID player blocked', {
      reason: 'sid_player_enabled=false',
      path: location.pathname,
    });
    console.warn('SID player blocked: sid_player_enabled=false');
  }, [enabled, isLoaded, location.pathname]);

  if (!isLoaded) return null;
  if (!enabled) return <NotFound />;
  return <MusicPlayerPage />;
};

const AppRoutes = () => (
  <BrowserRouter>
    <ErrorBoundary />
    <RouteRefresher />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/quick" element={<QuickSettingsPage />} />
      <Route path="/config" element={<ConfigBrowserPage />} />
      <Route path="/play" element={<PlayFilesPage />} />
      <Route path="/music" element={<SidPlayerRoute />} />
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
                <AppRoutes />
              </MockModeProvider>
            </SidPlayerProvider>
          </RefreshControlProvider>
        </FeatureFlagsProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const ErrorBoundary = () => {
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

export default App;
