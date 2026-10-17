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
import { Capacitor } from "@capacitor/core";

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

const WARM_QUIET_AFTER_INPUT_MS = 2_000;
/**
 * Loads the other tabs' code one at a time while the app is idle, so a first visit shows the page
 * instead of "Loading screen..." (about 0.7 s on a phone). One chunk per step keeps each parse short
 * enough not to delay playback that the page's own thread is feeding.
 */
export const warmPageChunks = (): (() => void) => {
  const loaders = [loadPlayFilesPage, loadDisksPage, loadConfigBrowserPage, loadSettingsPage];
  let timer: number | undefined;
  let cancelled = false;
  let index = 0;
  const whenIdle = (callback: () => void, delayMs: number) => {
    timer = window.setTimeout(() => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 3000 });
      else callback();
    }, delayMs);
  };
  let lastInputAt = Number.NEGATIVE_INFINITY;
  const noteInput = () => {
    lastInputAt = Date.now();
  };
  const INPUT_EVENTS = ["keydown", "pointerdown", "touchstart", "wheel"] as const;
  INPUT_EVENTS.forEach((type) => window.addEventListener(type, noteInput, { capture: true, passive: true }));
  const loadNext = () => {
    if (cancelled) return;
    // A native build bundles its chunks, and onLine is false in airplane mode, which Demo Mode runs in.
    const chunksNeedNetwork = !Capacitor.isNativePlatform() && navigator.onLine === false;
    if (chunksNeedNetwork || Date.now() - lastInputAt < WARM_QUIET_AFTER_INPUT_MS) {
      whenIdle(loadNext, WARM_STEP_DELAY_MS);
      return;
    }
    const load = loaders[index];
    index += 1;
    if (!load) return;
    load()
      .catch((error: unknown) => {
        addLog("warn", "Page code warm-up failed", {
          step: index,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      })
      .finally(() => whenIdle(loadNext, WARM_STEP_DELAY_MS));
  };
  whenIdle(loadNext, WARM_START_DELAY_MS);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    INPUT_EVENTS.forEach((type) => window.removeEventListener(type, noteInput, { capture: true }));
  };
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
 * A kept page keeps its own scroll offset. Its position is noted only when the page is torn down, for the rare
 * rebuild of a kept page (Settings after a setting changed elsewhere), which then opens where it was left. Noting it
 * on every tab switch measured the cards of a page that had just been hidden, which laid it out again: 80 to 120 ms.
 */
const CachedPagePosition = ({ pageIndex }: { pageIndex: number }) => {
  useLayoutEffect(() => {
    restorePagePosition(pageIndex, slotFor(pageIndex));
    return () => rememberPagePosition(pageIndex, slotFor(pageIndex));
  }, [pageIndex]);
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
        {cached ? <CachedPagePosition pageIndex={pageIndex} /> : <PagePosition pageIndex={pageIndex} />}
        <ScreenActivityProvider active={isActive}>
          <LocationWhileActive active={isActive}>{page}</LocationWhileActive>
        </ScreenActivityProvider>
      </Suspense>
    </PageErrorBoundary>
  );
});
