/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useSwipeGesture, type SwipeDirection, type SwipeGestureMetadata } from "@/hooks/useSwipeGesture";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { addLog } from "@/lib/logging";
import { TAB_ROUTES, resolveSwipeTarget, tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { confirmNavigation } from "@/lib/navigation/navigationGuards";
import { AppChromeModeProvider } from "@/components/layout/AppChromeContext";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { APP_SETTINGS_KEYS, loadEnableSwipeNavigation } from "@/lib/config/appSettings";
import { useTourActive } from "@/hooks/useTourActive";
import {
  addRevealedIndex,
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
  resolveDragRevealedIndex,
  resolveNavigationDirection,
  resolveRunwayTranslatePercent,
  type RunwayPanelIndexes,
} from "@/lib/navigation/swipeNavigationModel";
import { t } from "@/lib/i18n";

const HomePage = lazy(() => import("@/pages/HomePage"));
const PlayFilesPage = lazy(() => import("@/pages/PlayFilesPage"));
const DisksPage = lazy(() => import("@/pages/DisksPage"));
const ConfigBrowserPage = lazy(() => import("@/pages/ConfigBrowserPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const OpenSourceLicensesPage = lazy(() => import("@/pages/OpenSourceLicensesPage"));
const DocsPage = lazy(() => import("@/pages/DocsPage"));

type RuntimeMotionMode = "standard" | "reduced";
type RunwayPhase = "idle" | "dragging" | "transitioning";

type RunwayState = {
  phase: RunwayPhase;
  centerIndex: number;
  panelIndexes: RunwayPanelIndexes;
  dragOffsetPx: number;
  targetIndex: number;
  transitionDirection: -1 | 0 | 1;
  lastVelocityX: number;
  /**
   * Page indexes mounted for the current gesture on top of the active one.
   * Empty while idle, and only ever grows until the runway settles again.
   */
  revealedIndexes: readonly number[];
};

type RunwayContainerProps = {
  routeIndex: number;
  profile: string;
  navigate: (path: string) => void;
};

const TRANSITION_DURATION_MS = 280;
const TRANSITION_DURATION_COMPACT_MS = 220;
const TRANSITION_DURATION_REDUCED_MS = 180;
const TRANSITION_DURATION_TEST_MS = 1200;
const TRANSITION_SETTLE_BUFFER_MS = 80;
const DRAG_SETTLE_TIMEOUT_MS = 600;

const HomeSlot = () => <HomePage />;
const PlaySlot = () => <PlayFilesPage />;
const DisksSlot = () => <DisksPage />;
const ConfigSlot = () => <ConfigBrowserPage />;
const DocsSlot = () => <DocsPage />;

const SettingsSlot = () => {
  const location = useLocation();
  return (
    <>
      <SettingsPage />
      {location.pathname === "/settings/open-source-licenses" ? (
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

const buildIdleState = (index: number): RunwayState => ({
  phase: "idle",
  centerIndex: index,
  panelIndexes: resolveAdjacentIndexes(index),
  dragOffsetPx: 0,
  targetIndex: index,
  transitionDirection: 0,
  lastVelocityX: 0,
  revealedIndexes: [],
});

const didWrapAround = (fromIndex: number, toIndex: number, direction: -1 | 0 | 1) => {
  if (direction === 1) return toIndex < fromIndex;
  if (direction === -1) return toIndex > fromIndex;
  return false;
};

const SlotLoadingFallback = () => (
  <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10 text-sm text-muted-foreground">
    {t("app.loadingScreen", "Loading screen...")}
  </div>
);

const readRuntimeMotionMode = (): RuntimeMotionMode => {
  if (typeof document === "undefined") return "standard";
  return document.documentElement.dataset.c64MotionMode === "reduced" ? "reduced" : "standard";
};

export const resolveTransitionConfig = (profile: string, runtimeMotionMode: RuntimeMotionMode, velocityX: number) => {
  if (
    import.meta.env.VITE_ENABLE_TEST_PROBES === "1" ||
    (typeof window !== "undefined" && (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled)
  ) {
    return {
      durationMs: TRANSITION_DURATION_TEST_MS,
      easing: "linear",
      reducedEffects: false,
    };
  }

  let durationMs = profile === "compact" ? TRANSITION_DURATION_COMPACT_MS : TRANSITION_DURATION_MS;
  let easing = "cubic-bezier(0.22, 1, 0.36, 1)";

  if (runtimeMotionMode === "reduced") {
    durationMs = TRANSITION_DURATION_REDUCED_MS;
    easing = "linear";
  }

  if (Math.abs(velocityX) > 0.8) {
    durationMs = Math.max(140, durationMs - 40);
  }

  return {
    durationMs,
    easing,
    reducedEffects: runtimeMotionMode === "reduced",
  };
};

export function SwipeNavigationLayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useDisplayProfile();
  const routeIndex = tabIndexForPath(location.pathname);

  if (routeIndex < 0) return null;

  return <RunwayContainer routeIndex={routeIndex} profile={profile} navigate={navigate} />;
}

function RunwayContainer({ routeIndex, profile, navigate }: RunwayContainerProps) {
  const interstitialActive = useInterstitialActive();
  const [runway, setRunway] = useState<RunwayState>(() => buildIdleState(routeIndex));
  const [swipeNavigationEnabled, setSwipeNavigationEnabled] = useState(() => loadEnableSwipeNavigation());
  // Disabled outright while the tour runs: a swipe that changed the page under a spotlight would
  // leave the spotlight pointing at nothing (spec.md section 8.1).
  const tourActive = useTourActive();
  const swipeEnabled = swipeNavigationEnabled && !tourActive;
  const runwayRef = useRef(runway);
  runwayRef.current = runway;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollResetFrameRef = useRef<number | null>(null);
  // Tracks pointer-capture liveness independent of dx changing, so the
  // drag-settle timer below can tell a stationary held pointer apart from
  // a genuinely missed pointerup/pointercancel. See HARD9-026.
  const pointerActiveRef = useRef(false);
  const runtimeMotionMode = readRuntimeMotionMode();
  const transitionConfig = resolveTransitionConfig(profile, runtimeMotionMode, runway.lastVelocityX);
  const resetContainerScroll = useCallback((reason: string) => {
    const container = containerRef.current;
    if (!container || container.scrollLeft === 0) return;
    const offset = container.scrollLeft;
    container.scrollLeft = 0;
    addLog("debug", "[SwipeNav] reset-scroll-left", {
      reason,
      offset,
    });
  }, []);
  const scheduleContainerScrollReset = useCallback(
    (reason: string) => {
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        resetContainerScroll(reason);
        return;
      }
      if (scrollResetFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollResetFrameRef.current);
      }
      scrollResetFrameRef.current = window.requestAnimationFrame(() => {
        scrollResetFrameRef.current = null;
        resetContainerScroll(reason);
      });
    },
    [resetContainerScroll],
  );

  useEffect(() => {
    const handleSettingsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (detail?.key !== APP_SETTINGS_KEYS.ENABLE_SWIPE_NAVIGATION_KEY) return;
      setSwipeNavigationEnabled(loadEnableSwipeNavigation());
    };

    window.addEventListener("c64u-app-settings-updated", handleSettingsUpdate);
    return () => window.removeEventListener("c64u-app-settings-updated", handleSettingsUpdate);
  }, []);

  useLayoutEffect(() => {
    resetContainerScroll("state-sync");
    scheduleContainerScrollReset("state-sync-frame");
  }, [resetContainerScroll, routeIndex, runway.phase, scheduleContainerScrollReset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      resetContainerScroll("native-scroll");
      scheduleContainerScrollReset("native-scroll-frame");
    };
    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollResetFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollResetFrameRef.current);
        scrollResetFrameRef.current = null;
      }
    };
  }, [resetContainerScroll, scheduleContainerScrollReset]);

  useEffect(() => {
    const current = runwayRef.current;
    if (routeIndex === current.centerIndex && current.phase === "idle") return;
    if (current.phase === "transitioning" && current.targetIndex === routeIndex) return;

    const direction = resolveNavigationDirection(current.centerIndex, routeIndex);
    if (direction === 0) {
      setRunway(buildIdleState(routeIndex));
      return;
    }

    addLog("debug", "[SwipeNav] route-transition-start", {
      reason: "route-change",
      from: TAB_ROUTES[current.centerIndex].label,
      to: TAB_ROUTES[routeIndex].label,
      direction,
      wrapAround: didWrapAround(current.centerIndex, routeIndex, direction),
    });

    setRunway({
      phase: "transitioning",
      centerIndex: current.centerIndex,
      panelIndexes: buildRunwayPanelIndexes(current.centerIndex, routeIndex),
      dragOffsetPx: 0,
      targetIndex: routeIndex,
      transitionDirection: direction,
      lastVelocityX: current.lastVelocityX,
      revealedIndexes: addRevealedIndex(addRevealedIndex(current.revealedIndexes, current.centerIndex), routeIndex),
    });
  }, [routeIndex]);

  const handleTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const current = runwayRef.current;
    if (current.phase !== "transitioning") return;

    addLog("debug", "[SwipeNav] transition-end", {
      from: TAB_ROUTES[current.centerIndex].label,
      to: TAB_ROUTES[current.targetIndex].label,
      direction: current.transitionDirection,
    });

    setRunway(buildIdleState(current.targetIndex));
  }, []);

  // Some WebView/CSS engines miss transitionend for transform animations. Settle
  // the runway after the configured duration plus a small buffer so navigation
  // never stays stuck in "transitioning" for seconds on real devices.
  useEffect(() => {
    if (runway.phase !== "transitioning") return;
    const settleAfterMs = transitionConfig.durationMs + TRANSITION_SETTLE_BUFFER_MS;
    const timer = setTimeout(() => {
      const current = runwayRef.current;
      if (current.phase !== "transitioning") return;
      addLog("debug", "[SwipeNav] transition-end-synthesized", {
        to: TAB_ROUTES[current.targetIndex].label,
        settleAfterMs,
      });
      setRunway(buildIdleState(current.targetIndex));
    }, settleAfterMs);
    return () => clearTimeout(timer);
  }, [runway.phase, runway.targetIndex, transitionConfig.durationMs]);

  // Recovers a runway stuck in "dragging" after a missed pointerup/
  // pointercancel (some WebView/OS combinations drop it). Re-arming this on
  // every dx change made a pointer held stationary >600ms - a normal
  // mid-gesture pause, not a missed event - indistinguishable from the
  // failure this timer exists to catch, snapping the runway back while the
  // finger was still down. Keyed only on phase (not dx) so it does not
  // restart on every pointermove, and each firing checks actual pointer
  // liveness (fed by useSwipeGesture's onActiveChange) before resetting -
  // if the pointer is still down, it re-checks later instead. See
  // HARD9-026.
  useEffect(() => {
    if (runway.phase !== "dragging") return;
    let timer: ReturnType<typeof setTimeout>;
    const checkSettled = () => {
      const current = runwayRef.current;
      if (current.phase !== "dragging") return;
      if (pointerActiveRef.current) {
        timer = setTimeout(checkSettled, DRAG_SETTLE_TIMEOUT_MS);
        return;
      }
      addLog("debug", "[SwipeNav] drag-reset-synthesized", {
        center: TAB_ROUTES[current.centerIndex].label,
        settleAfterMs: DRAG_SETTLE_TIMEOUT_MS,
        dragOffsetPx: current.dragOffsetPx,
      });
      setRunway(buildIdleState(current.centerIndex));
    };
    timer = setTimeout(checkSettled, DRAG_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [runway.phase]);

  const onProgress = useCallback(
    (dx: number, velocityX: number) => {
      if (!swipeEnabled) return;
      const current = runwayRef.current;
      if (current.phase === "transitioning") return;

      setRunway((previous) => ({
        ...previous,
        phase: "dragging",
        dragOffsetPx: dx,
        lastVelocityX: velocityX,
        revealedIndexes: addRevealedIndex(
          previous.revealedIndexes,
          resolveDragRevealedIndex(previous.panelIndexes, dx),
        ),
      }));
    },
    [swipeEnabled],
  );

  const onCommit = useCallback(
    (direction: SwipeDirection, metadata: SwipeGestureMetadata) => {
      if (!swipeEnabled) return;
      const current = runwayRef.current;
      if (current.phase === "transitioning") return;

      // Asked before the runway animates, so a refused guard leaves no half-played transition.
      // This site calls `confirmNavigation` itself rather than using `useGuardedNavigate`, which
      // would prompt the user a second time after this check.
      if (!confirmNavigation()) return;

      const targetIndex = resolveSwipeTarget(current.centerIndex, direction);
      addLog("debug", "[SwipeNav] transition-start", {
        reason: "swipe",
        from: TAB_ROUTES[current.centerIndex].label,
        to: TAB_ROUTES[targetIndex].label,
        direction,
        wrapAround: didWrapAround(current.centerIndex, targetIndex, direction),
        ...metadata,
      });

      setRunway({
        phase: "transitioning",
        centerIndex: current.centerIndex,
        panelIndexes: buildRunwayPanelIndexes(current.centerIndex, targetIndex),
        dragOffsetPx: current.dragOffsetPx,
        targetIndex,
        transitionDirection: direction,
        lastVelocityX: metadata.velocityX,
        revealedIndexes: addRevealedIndex(addRevealedIndex(current.revealedIndexes, current.centerIndex), targetIndex),
      });
      navigate(TAB_ROUTES[targetIndex].path);
    },
    [navigate, swipeEnabled],
  );

  const onCancel = useCallback(
    (metadata: SwipeGestureMetadata) => {
      if (!swipeEnabled) return;
      const current = runwayRef.current;
      if (current.phase === "transitioning") return;

      addLog("debug", "[SwipeNav] transition-start", {
        reason: "cancel",
        from: TAB_ROUTES[current.centerIndex].label,
        to: TAB_ROUTES[current.centerIndex].label,
        direction: 0,
        ...metadata,
      });

      setRunway({
        phase: "transitioning",
        centerIndex: current.centerIndex,
        panelIndexes: current.panelIndexes,
        dragOffsetPx: current.dragOffsetPx,
        targetIndex: current.centerIndex,
        transitionDirection: 0,
        lastVelocityX: metadata.velocityX,
        revealedIndexes: addRevealedIndex(current.revealedIndexes, current.centerIndex),
      });
    },
    [swipeEnabled],
  );

  useSwipeGesture(containerRef, {
    enabled: swipeEnabled,
    onProgress,
    onCommit,
    onCancel,
    onActiveChange: (active) => {
      pointerActiveRef.current = active;
    },
  });

  const transform = useMemo(() => {
    if (runway.phase === "dragging") {
      return `translateX(calc(${-(100 / 3)}% + ${runway.dragOffsetPx}px))`;
    }
    if (runway.phase === "transitioning") {
      return `translateX(${resolveRunwayTranslatePercent(runway.transitionDirection)}%)`;
    }
    return `translateX(${-(100 / 3)}%)`;
  }, [runway.dragOffsetPx, runway.phase, runway.transitionDirection]);

  const trackStyle: React.CSSProperties = {
    width: "300%",
    transform,
    transition:
      runway.phase === "transitioning"
        ? `transform ${transitionConfig.durationMs}ms ${transitionConfig.easing}`
        : undefined,
    willChange: runway.phase === "idle" ? "auto" : "transform",
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen overflow-hidden bg-background"
      style={{ height: "calc(100dvh - var(--app-tab-bar-reserved-height))", touchAction: "pan-y pinch-zoom" }}
      inert={interstitialActive ? "" : undefined}
      data-testid="swipe-navigation-container"
      data-swipe-enabled={swipeEnabled ? "true" : "false"}
      data-swipe-motion-mode={runtimeMotionMode}
      data-swipe-effects={transitionConfig.reducedEffects ? "reduced" : "standard"}
      data-interstitial-active={interstitialActive ? "true" : "false"}
    >
      <div
        className="flex h-full"
        style={trackStyle}
        onTransitionEnd={handleTransitionEnd}
        data-testid="swipe-navigation-runway"
        data-runway-index={runway.phase === "transitioning" ? runway.targetIndex : runway.centerIndex}
        data-runway-phase={runway.phase}
      >
        {runway.panelIndexes.map((pageIndex, panelPosition) => {
          const Component = SLOT_COMPONENTS[pageIndex];
          const isActive =
            runway.phase === "transitioning" ? pageIndex === runway.targetIndex : pageIndex === routeIndex;
          const testProbeActive =
            import.meta.env.VITE_ENABLE_TEST_PROBES === "1" ||
            (typeof window !== "undefined" &&
              (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled);
          const renderPlaceholderOnly =
            !isActive && (runway.phase === "idle" || testProbeActive || !runway.revealedIndexes.includes(pageIndex));

          // Idle inactive slots are placeholders; a gesture also mounts the
          // panels it revealed. HARD12-022: the departing page stays mounted all
          // transition and the preview shows its real content, so pages holding
          // state across the overlap defend themselves per effect (BUG-040 wake
          // lock, HARD12-006 volume session, HARD12-020 machine execution).
          //
          // HARD27-038: a gesture moves one way, so the panel opposite the
          // centre is off screen throughout and mounting its hook tree was pure
          // cost during the animation. Revealed panels are never dropped before
          // the runway settles, so a reversed drag reveals the other neighbour
          // instead of churning mounts.
          if (renderPlaceholderOnly) {
            return (
              <div
                key={pageIndex}
                className="relative h-full overflow-hidden"
                style={{ width: "33.333333%", flexShrink: 0 }}
                aria-hidden={true}
                inert=""
                data-testid={`swipe-slot-${TAB_ROUTES[pageIndex].label.toLowerCase()}`}
                data-route-index={pageIndex}
                data-slot-active="false"
                data-panel-position={panelPosition}
              />
            );
          }

          return (
            <div
              key={pageIndex}
              className="relative h-full overflow-hidden"
              style={{ width: "33.333333%", flexShrink: 0 }}
              aria-hidden={!isActive}
              inert={isActive ? undefined : ""}
              data-testid={`swipe-slot-${TAB_ROUTES[pageIndex].label.toLowerCase()}`}
              data-route-index={pageIndex}
              data-slot-active={isActive ? "true" : "false"}
              data-panel-position={panelPosition}
            >
              <PageErrorBoundary active={isActive}>
                <Suspense fallback={<SlotLoadingFallback />}>
                  <ScreenActivityProvider active={isActive}>
                    <AppChromeModeProvider mode="sticky">
                      <Component />
                    </AppChromeModeProvider>
                  </ScreenActivityProvider>
                </Suspense>
              </PageErrorBoundary>
            </div>
          );
        })}
      </div>
    </div>
  );
}
