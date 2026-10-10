/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useSwipeGesture, type SwipeDirection, type SwipeGestureMetadata } from "@/hooks/useSwipeGesture";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { addLog } from "@/lib/logging";
import { TAB_ROUTES, resolveSwipeTarget, tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { confirmNavigation } from "@/lib/navigation/navigationGuards";
import { APP_SETTINGS_KEYS, loadEnableSwipeNavigation } from "@/lib/config/appSettings";
import { useTourActive } from "@/hooks/useTourActive";
import {
  addRevealedIndex,
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
  resolveDragRevealedIndex,
  resolveNavigationDirection,
  rememberCachedPage,
  resolveRunwayTranslatePercent,
  type RunwayPanelIndexes,
} from "@/lib/navigation/swipeNavigationModel";
import { subscribePageReset } from "@/lib/navigation/pageReset";
import { forgetPagePosition } from "@/lib/navigation/pagePositions";
import { PageSlotBody } from "@/components/swipeNavigation/PageSlotBody";
import { useSettingsPageStaleness } from "@/components/swipeNavigation/useSettingsPageStaleness";
import { rememberedSlotAppBarHeight } from "@/lib/navigation/slotAppBarHeights";

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

type TestProbeWindow = Window & { __c64uTestProbeEnabled?: boolean; __c64uCacheVisitedPages?: boolean };

const isTestProbeActive = () =>
  import.meta.env.VITE_ENABLE_TEST_PROBES === "1" ||
  (typeof window !== "undefined" && Boolean((window as TestProbeWindow).__c64uTestProbeEnabled));

/*
 * Test probes rebuild each page on every visit, so a test id names exactly one element in the document. A spec that
 * tests the page cache opts back in.
 */
/* Without `content-visibility` (a WebView before Chrome 85) a hidden kept page is hidden and made inert instead. */
const skipsHiddenContent = () =>
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("content-visibility", "hidden");

const cachesVisitedPages = () =>
  !isTestProbeActive() ||
  (typeof window !== "undefined" && Boolean((window as TestProbeWindow).__c64uCacheVisitedPages));

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
  const [pageGenerations, setPageGenerations] = useState<Readonly<Record<number, number>>>({});
  const [cachePages] = useState(cachesVisitedPages);
  const [hiddenContentSkipped] = useState(skipsHiddenContent);
  const hiddenSlotStyle: React.CSSProperties = hiddenContentSkipped
    ? { contentVisibility: "hidden" }
    : { visibility: "hidden" };
  const [cachedPages, setCachedPages] = useState<readonly number[]>(() => (cachePages ? [routeIndex] : []));
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

  useEffect(
    () =>
      subscribePageReset((tabIndex) => {
        forgetPagePosition(tabIndex);
        setPageGenerations((generations) => ({ ...generations, [tabIndex]: (generations[tabIndex] ?? 0) + 1 }));
      }),
    [],
  );

  useEffect(() => {
    if (cachePages) setCachedPages((cached) => rememberCachedPage(cached, routeIndex));
  }, [cachePages, routeIndex]);

  useSettingsPageStaleness(cachePages, routeIndex, setPageGenerations);

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
      // Clip the transformed runway: hidden overflow still lets focus/scrollIntoView
      // move the page horizontally between choosing a control and activating it.
      className="relative w-screen overflow-hidden overflow-clip bg-background"
      style={{
        height: "calc(100dvh - var(--app-tab-bar-reserved-height) - var(--app-toast-reserved-height, 0px))",
        touchAction: "pan-y pinch-zoom",
      }}
      inert={interstitialActive}
      data-testid="swipe-navigation-container"
      data-swipe-enabled={swipeEnabled ? "true" : "false"}
      data-swipe-motion-mode={runtimeMotionMode}
      data-swipe-effects={transitionConfig.reducedEffects ? "reduced" : "standard"}
      data-interstitial-active={interstitialActive ? "true" : "false"}
    >
      <div
        className="relative h-full"
        style={trackStyle}
        onTransitionEnd={handleTransitionEnd}
        data-testid="swipe-navigation-runway"
        data-runway-index={runway.phase === "transitioning" ? runway.targetIndex : runway.centerIndex}
        data-runway-phase={runway.phase}
      >
        {/* Slots stay in tab order whichever panels the runway shows, so a cached page is never moved in the
            document: moving it would rebuild its layout and lose its scroll position. */}
        {TAB_ROUTES.map((_, pageIndex) => {
          const panelPosition = runway.panelIndexes.indexOf(pageIndex);
          const inRunway = panelPosition >= 0;
          const cached = cachedPages.includes(pageIndex);
          if (!inRunway && !cached) return null;
          const label = TAB_ROUTES[pageIndex].label.toLowerCase();
          const key = `${pageIndex}:${pageGenerations[pageIndex] ?? 0}`;
          const isActive =
            runway.phase === "transitioning" ? pageIndex === runway.targetIndex : pageIndex === routeIndex;
          // HARD12-022: the departing page stays shown all transition and the preview shows its real content, so
          // pages holding state across the overlap defend themselves per effect (BUG-040 wake lock, HARD12-006
          // volume session, HARD12-020 machine execution). HARD27-038: a gesture shows only the panels it revealed.
          const shown =
            isActive ||
            (inRunway && runway.phase !== "idle" && !isTestProbeActive() && runway.revealedIndexes.includes(pageIndex));
          // A hidden kept page is parked left of the runway, where no transform ever brings it into view, and its
          // content is skipped: not styled, laid out, painted, hit or focused until it is shown again.
          const slotStyle = {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${((inRunway ? panelPosition : -1) * 100) / 3}%`,
            width: "33.333333%",
            "--app-bar-height": rememberedSlotAppBarHeight(pageIndex),
            ...(shown ? {} : hiddenSlotStyle),
          } as React.CSSProperties;

          if (!shown && !cached) {
            return (
              <div
                key={key}
                className="relative h-full overflow-hidden overflow-clip"
                style={slotStyle}
                aria-hidden={true}
                inert
                data-testid={`swipe-slot-${label}`}
                data-route-index={pageIndex}
                data-slot-active="false"
                data-panel-position={panelPosition}
              />
            );
          }

          return (
            <div
              key={key}
              // `overflow-clip` where supported: a hidden box can still be scrolled by a
              // scrollIntoView, which slid the page header up under the status bar.
              className="relative h-full overflow-hidden overflow-clip"
              style={slotStyle}
              aria-hidden={!isActive}
              // A kept page is not made inert when it is hidden: toggling `inert` restyles the whole page, 117 ms for
              // Config on a Pixel 4. Skipped content cannot be focused or hit, and the transition cover below
              // stops a departing page from taking a tap.
              inert={!isActive && (!cachePages || !hiddenContentSkipped)}
              // Only the active slot carries this id, so exactly one `page-*` id exists at a
              // time and it names the tab on screen. Maestro matches `id:` against the HTML id
              // attribute, and the tab-bar labels it would otherwise assert on render outside
              // the page and are present whichever tab is selected.
              id={isActive ? `page-${label}` : undefined}
              data-testid={`swipe-slot-${label}`}
              data-route-index={pageIndex}
              data-slot-active={isActive ? "true" : "false"}
              data-slot-cached={shown ? undefined : "true"}
              data-panel-position={panelPosition}
            >
              {/* A kept page keeps its DOM, state and effects while hidden. Work that stopped when a page unmounted
                  follows its screen activity (`usePageActivity`), so a hidden page neither polls nor listens. */}
              <PageSlotBody pageIndex={pageIndex} isActive={isActive} cached={cachePages} />
            </div>
          );
        })}
        {cachePages && runway.phase === "transitioning" && runway.targetIndex !== runway.centerIndex ? (
          // Kept pages are not made inert (see the slot above), so the page sliding out is covered for the
          // length of the slide instead, as inert covered it before.
          <div
            aria-hidden={true}
            className="absolute inset-y-0"
            style={{
              left: `${(runway.panelIndexes.indexOf(runway.centerIndex) * 100) / 3}%`,
              width: "33.333333%",
              zIndex: 1,
            }}
            data-testid="swipe-departing-page-cover"
          />
        ) : null}
      </div>
    </div>
  );
}
