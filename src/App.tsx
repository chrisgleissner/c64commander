import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TabBar } from "@/components/TabBar";
import HomePage from "./pages/HomePage";
import QuickSettingsPage from "./pages/QuickSettingsPage";
import ConfigBrowserPage from "./pages/ConfigBrowserPage";
import SettingsPage from "./pages/SettingsPage";
import DocsPage from "./pages/DocsPage";
import NotFound from "./pages/NotFound";
import { RefreshControlProvider, useRefreshControl } from "@/hooks/useRefreshControl";
import { getRefreshIntervalMs } from "@/hooks/useC64Connection";

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
  const { quickExpandedCount, configExpandedCount } = useRefreshControl();
  const [isVisible, setIsVisible] = useState(() => !document.hidden);

  const isHome = location.pathname === '/';
  const isQuick = location.pathname.startsWith('/quick');
  const isConfig = location.pathname.startsWith('/config');

  const shouldPoll = useMemo(() => {
    if (!isVisible) return false;
    if (isHome) return true;
    if (isQuick && quickExpandedCount > 0) return true;
    if (isConfig && configExpandedCount > 0) return true;
    return false;
  }, [isVisible, isHome, isQuick, isConfig, quickExpandedCount, configExpandedCount]);

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

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }
    const interval = window.setInterval(() => {
      client.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0]?.toString().startsWith("c64"),
      });
    }, getRefreshIntervalMs());

    return () => window.clearInterval(interval);
  }, [client, shouldPoll]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <RefreshControlProvider>
          <BrowserRouter>
            <RouteRefresher />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/quick" element={<QuickSettingsPage />} />
              <Route path="/config" element={<ConfigBrowserPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <TabBar />
          </BrowserRouter>
        </RefreshControlProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
