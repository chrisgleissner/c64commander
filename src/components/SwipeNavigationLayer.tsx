/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useSwipeGesture, type SwipeDirection, type SwipeGestureMetadata } from "@/hooks/useSwipeGesture";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { addLog } from "@/lib/logging";
import { TAB_ROUTES, resolveSwipeTarget, tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { AppChromeModeProvider } from "@/components/layout/AppChromeContext";
import {
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
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

const HomeSlot = () => <HomePage />;
const PlaySlot = () => <PlayFilesPage />;
const DisksSlot = () => <DisksPage />;
const ConfigSlot = () => <ConfigBrowserPage />;
const DocsSlot = () => <DocsPage />;

const SettingsSlot = () => {
  const location = useLocation();
  if (location.pathname === "/settings/open-source-licenses") {
    return (
      <Suspense fallback={null}>
        <OpenSourceLicensesPage />
      </Suspense>
    );
  }
  return <SettingsPage />;
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

const resolveTransitionConfig = (profile: string, runtimeMotionMode: RuntimeMotionMode, velocityX: number) => {
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
    reducedEffects: runtimeMotionMode === "reduced" || profile === "compact",
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
  const runwayRef = useRef(runway);
  runwayRef.current = runway;

  const containerRef = useRef<HTMLDivElement | null>(null);

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
      dragOffsetPx: current.phase === "dragging" ? current.dragOffsetPx : 0,
      targetIndex: routeIndex,
      transitionDirection: direction,
      lastVelocityX: current.lastVelocityX,
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

  // Fallback: force idle if transitionend never fires (e.g. headless CSS engine
  // on CI does not always deliver the event reliably). The timeout is generous
  // enough to cover both normal (~280ms) and test-probe (1200ms) durations.
  useEffect(() => {
    if (runway.phase !== "transitioning") return;
    const timer = setTimeout(() => {
      const current = runwayRef.current;
      if (current.phase !== "transitioning") return;
      addLog("warn", "[SwipeNav] transition-end-fallback", {
        to: TAB_ROUTES[current.targetIndex].label,
      });
      setRunway(buildIdleState(current.targetIndex));
    }, 3000);
    return () => clearTimeout(timer);
  }, [runway.phase, runway.targetIndex]);

  const onProgress = useCallback((dx: number, velocityX: number) => {
    const current = runwayRef.current;
    if (current.phase === "transitioning") return;

    setRunway((previous) => ({
      ...previous,
      phase: "dragging",
      dragOffsetPx: dx,
      lastVelocityX: velocityX,
    }));
  }, []);

  const onCommit = useCallback(
    (direction: SwipeDirection, metadata: SwipeGestureMetadata) => {
      const current = runwayRef.current;
      if (current.phase === "transitioning") return;

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
      });
      navigate(TAB_ROUTES[targetIndex].path);
    },
    [navigate],
  );

  const onCancel = useCallback((metadata: SwipeGestureMetadata) => {
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
    });
  }, []);

  useSwipeGesture(containerRef, { onProgress, onCommit, onCancel });

  const runtimeMotionMode = readRuntimeMotionMode();
  const transitionConfig = resolveTransitionConfig(profile, runtimeMotionMode, runway.lastVelocityX);

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
      className="relative w-screen overflow-hidden"
      style={{ height: "calc(100dvh - var(--app-tab-bar-reserved-height))", touchAction: "pan-y pinch-zoom" }}
      inert={interstitialActive ? "" : undefined}
      data-testid="swipe-navigation-container"
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
          const renderPlaceholderOnly = !isActive && (runway.phase === "idle" || testProbeActive);

          // Render idle inactive slots as placeholders so selectors only see the
          // active page. During transitions we still mount adjacent pages unless
          // deterministic probe mode is enabled.
          if (renderPlaceholderOnly) {
            return (
              <div
                key={`${panelPosition}-${pageIndex}`}
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
              key={`${panelPosition}-${pageIndex}`}
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

class PageErrorBoundary extends React.Component<{ children: React.ReactNode; active: boolean }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { children: React.ReactNode; active: boolean }) {
    if (!previousProps.active && this.props.active && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addLog("error", "[SwipeNav] page render error", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (!this.props.active) return null;

    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6 py-10">
        <div className="max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow">
          <p className="text-sm font-semibold text-foreground">{t("app.error.title", "Something went wrong")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("app.error.retry", "Please try reloading the app.")}</p>
        </div>
      </div>
    );
  }
}
