/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { lazy, Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { UNSAFE_LocationContext as LocationContext, useLocation } from "react-router-dom";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { usePageActivity } from "@/hooks/usePageActivity";
import { AppChromeModeProvider } from "@/components/layout/AppChromeContext";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { PageLoadingFallback } from "@/components/PageLoadingFallback";
import { rememberPagePosition, restorePagePosition } from "@/lib/navigation/pagePositions";
import { addLog } from "@/lib/logging";

const loadHomePage = () => import("@/pages/HomePage");
const loadPlayFilesPage = () => import("@/pages/PlayFilesPage");
const loadDisksPage = () => import("@/pages/DisksPage");
const loadConfigBrowserPage = () => import("@/pages/ConfigBrowserPage");
const loadSettingsPage = () => import("@/pages/SettingsPage");

const HomePage = lazy(loadHomePage);
const PlayFilesPage = lazy(loadPlayFilesPage);
const DisksPage = lazy(loadDisksPage);
const ConfigBrowserPage = lazy(loadConfigBrowserPage);
const SettingsPage = lazy(loadSettingsPage);
const OpenSourceLicensesPage = lazy(() => import("@/pages/OpenSourceLicensesPage"));
const DocsPage = lazy(() => import("@/pages/DocsPage"));

const WARM_START_DELAY_MS = 2500;
const WARM_STEP_DELAY_MS = 1500;

/**
 * Loads the other tabs' code one at a time while the app is idle, so a first visit shows the page
 * instead of "Loading screen..." (about 0.7 s on a phone). One chunk per step keeps each parse short
 * enough not to delay playback that the page's own thread is feeding.
 */
export const warmPageChunks = (): (() => void) => {
  const loaders = [loadPlayFilesPage, loadDisksPage, loadConfigBrowserPage, loadSettingsPage];
  let timer: number | undefined;
  let index = 0;
  const loadNext = () => {
    const load = loaders[index];
    index += 1;
    if (!load) return;
    load()
      .catch((error: unknown) => {
        addLog("warn", "Page code warm-up failed", { step: index, error: (error as Error).message });
      })
      .finally(() => {
        timer = window.setTimeout(loadNext, WARM_STEP_DELAY_MS);
      });
  };
  timer = window.setTimeout(loadNext, WARM_START_DELAY_MS);
  return () => window.clearTimeout(timer);
};

const HomeSlot = () => <HomePage />;
const PlaySlot = () => <PlayFilesPage />;
const DisksSlot = () => <DisksPage />;
const ConfigSlot = () => <ConfigBrowserPage />;
const DocsSlot = () => <DocsPage />;

// The licenses overlay is portaled over the whole app, so a kept Settings page draws it only while it is on screen.
const SettingsSlot = () => {
  const location = useLocation();
  const onScreen = usePageActivity();
  return (
    <>
      <SettingsPage />
      {onScreen && location.pathname === "/settings/open-source-licenses" ? (
        <Suspense fallback={null}>
          <OpenSourceLicensesPage />
        </Suspense>
      ) : null}
    </>
  );
};

const SLOT_COMPONENTS: Array<() => React.ReactNode> = [
  HomeSlot,
  PlaySlot,
  DisksSlot,
  ConfigSlot,
  SettingsSlot,
  DocsSlot,
];

const RUNWAY_SELECTOR = '[data-testid="swipe-navigation-runway"]';
const slotFor = (pageIndex: number) => document.querySelector(`${RUNWAY_SELECTOR} > [data-route-index="${pageIndex}"]`);

/*
 * Rendered before the page, so its layout effect puts the scroll offset back before the page's cards
 * decide which of them are in view, and its cleanup reads the position before the page leaves the DOM.
 */
const PagePosition = ({ pageIndex }: { pageIndex: number }) => {
  useLayoutEffect(() => {
    restorePagePosition(pageIndex, slotFor(pageIndex));
    return () => rememberPagePosition(pageIndex, slotFor(pageIndex));
  }, [pageIndex]);
  return null;
};

/*
 * A kept page keeps its own scroll offset. Its position is still noted when it is left, while it is on screen, for
 * the rare rebuild of a kept page (Settings after a setting changed elsewhere), which then opens where it was left.
 */
const CachedPagePosition = ({ pageIndex, active }: { pageIndex: number; active: boolean }) => {
  useLayoutEffect(() => {
    restorePagePosition(pageIndex, slotFor(pageIndex));
  }, [pageIndex]);
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (wasActive.current && !active) rememberPagePosition(pageIndex, slotFor(pageIndex));
    wasActive.current = active;
  }, [active, pageIndex]);
  return null;
};

/*
 * A page that is not on screen keeps the location it last saw. Every useLocation and useNavigate consumer re-renders
 * when the location changes, so without this each tab switch re-rendered those in every kept page: a 169 ms task
 * on a Pixel 4 at half its CPU rate before the new page could start to show.
 */
const LocationWhileActive = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const live = React.useContext(LocationContext);
  const seen = useRef(live);
  if (active) seen.current = live;
  return <LocationContext.Provider value={seen.current}>{children}</LocationContext.Provider>;
};

export const PageSlotBody = React.memo(function PageSlotBody({
  pageIndex,
  isActive,
  cached,
}: {
  pageIndex: number;
  isActive: boolean;
  cached: boolean;
}) {
  // The same element across activity changes, so turning a page on or off re-renders only what reads that state.
  const page = useMemo(() => {
    const Component = SLOT_COMPONENTS[pageIndex];
    return (
      <AppChromeModeProvider mode="sticky">
        <Component />
      </AppChromeModeProvider>
    );
  }, [pageIndex]);
  return (
    <PageErrorBoundary active={isActive}>
      <Suspense fallback={<PageLoadingFallback />}>
        {cached ? (
          <CachedPagePosition pageIndex={pageIndex} active={isActive} />
        ) : (
          <PagePosition pageIndex={pageIndex} />
        )}
        <ScreenActivityProvider active={isActive}>
          <LocationWhileActive active={isActive}>{page}</LocationWhileActive>
        </ScreenActivityProvider>
      </Suspense>
    </PageErrorBoundary>
  );
});
