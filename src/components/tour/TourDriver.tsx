/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { useC64Connection } from "@/hooks/useC64Connection";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { captionPlacement, scrimRects, unionRect, type Rect } from "@/lib/tour/spotlight";
import { TOUR_STEPS, tourStepIndex } from "@/lib/tour/steps";
import {
  TOUR_ACTIVE_ATTRIBUTE,
  loadTourState,
  saveTourState,
  shouldOfferTourOnLaunch,
  subscribeTourStart,
  type TourStartRequest,
} from "@/lib/tour/tourState";

/**
 * The first-run tour driver (spec.md section 8).
 *
 * It starts only once every startup interstitial has been dismissed and the app has settled on
 * Home: the splash and fade, automatic discovery, and the simulated-device offer all run first, and
 * a tour that began under one of them would spotlight a page nobody could see.
 *
 * While it runs it sets an attribute on <html>. Swipe navigation reads that and disables itself — a
 * swipe that changed the page under a spotlight would leave the spotlight pointing at nothing — and
 * Home reads it to pin its arrangement.
 */

/** How long after the last interstitial closes before the tour is offered. */
const SETTLE_MS = 900;

const measureAnchors = (testIds: readonly string[]): Rect[] => {
  if (typeof document === "undefined") return [];
  return testIds
    .map((testId) => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`))
    .filter((element): element is HTMLElement => element !== null)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
};

export const TourDriver = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const interstitialActive = useInterstitialActive();
  const { status } = useC64Connection();

  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [hole, setHole] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const ranWithoutDeviceRef = useRef(false);
  const offeredRef = useRef(false);

  const step = TOUR_STEPS[stepIndex];

  const start = useCallback((request: TourStartRequest = {}) => {
    ranWithoutDeviceRef.current = false;
    setStepIndex(tourStepIndex(request.fromStepId ?? null));
    setRunning(true);
  }, []);

  useEffect(() => subscribeTourStart(start), [start]);

  // First launch, strictly after every interstitial (section 8.1).
  useEffect(() => {
    if (running || offeredRef.current || interstitialActive) return undefined;
    if (!shouldOfferTourOnLaunch(loadTourState())) return undefined;
    const timer = setTimeout(() => {
      offeredRef.current = true;
      if (window.location.pathname !== "/") navigate("/");
      start();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [interstitialActive, navigate, running, start]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!running) {
      document.documentElement.removeAttribute(TOUR_ACTIVE_ATTRIBUTE);
      return undefined;
    }
    document.documentElement.setAttribute(TOUR_ACTIVE_ATTRIBUTE, "true");
    return () => document.documentElement.removeAttribute(TOUR_ACTIVE_ATTRIBUTE);
  }, [running]);

  // Read from a ref rather than a dependency: the path changes as a RESULT of this effect, and
  // depending on it would re-run the resolver on its own navigation.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // Navigate and open, through the same resolver search and the Home tiles use.
  useEffect(() => {
    if (!running || !step) return;
    if (!step.anchor) {
      setHole(null);
      return;
    }
    const { path, scope, sectionId, testIds } = step.anchor;
    void navigateToSearchTarget(
      scope && sectionId ? { kind: "control", path, scope, sectionId, testId: testIds[0] } : { kind: "route", path },
      {
        navigate: (next) => navigate(next),
        currentPath: pathnameRef.current,
        label: step.title,
        // A step whose anchors never appear degrades to the caption alone, so the toast the
        // resolver would raise for search is deliberately swallowed here.
        onToast: () => undefined,
      },
    );
    if (!status.isConnected && step.requiresDevice) ranWithoutDeviceRef.current = true;
  }, [running, step, navigate, status.isConnected]);

  // Re-measured on scroll, resize and orientation change, so the hole cannot drift off its anchor.
  useEffect(() => {
    if (!running || !step?.anchor) return undefined;
    const remeasure = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setHole(unionRect(measureAnchors(step.anchor?.testIds ?? [])));
    };
    remeasure();
    // The anchor is reached asynchronously, so measure again once it has had time to arrive.
    const settle = setTimeout(remeasure, 600);
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure);
    };
  }, [running, step]);

  const finish = useCallback(
    (outcome: "completed" | "skipped") => {
      const state = loadTourState();
      saveTourState({
        ...state,
        completedAt: outcome === "completed" ? Date.now() : state.completedAt,
        skippedAt: outcome === "skipped" ? Date.now() : state.skippedAt,
        lastStepId: TOUR_STEPS[stepIndex]?.id ?? null,
        deviceStepsPending: state.deviceStepsPending || ranWithoutDeviceRef.current,
      });
      setRunning(false);
      setHole(null);
    },
    [stepIndex],
  );

  const next = useCallback(() => {
    setStepIndex((current) => {
      if (current + 1 >= TOUR_STEPS.length) {
        // Deferred out of the updater: finish() writes storage and sets state of its own.
        queueMicrotask(() => finish("completed"));
        return current;
      }
      return current + 1;
    });
  }, [finish]);

  const back = useCallback(() => setStepIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    if (!running) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // The tour owns the keys while it is up. Left and Right are Back and Next, OK is Next, and
      // the Back key skips, which is the same "Back goes out" rule the rest of the app follows.
      const handled: Record<string, () => void> = {
        ArrowLeft: back,
        ArrowRight: next,
        Enter: next,
        " ": next,
        Escape: () => finish("skipped"),
      };
      const action = handled[event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [back, finish, next, running]);

  if (!running || !step) return null;

  const pieces = scrimRects(hole, viewport);
  const placement = captionPlacement(hole, viewport.height);

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tour: ${step.title}`}
      data-testid="tour-overlay"
      data-tour-step={step.id}
      data-tour-degraded={hole === null ? "true" : undefined}
    >
      {pieces.map((piece, index) => (
        <div
          key={index}
          className="absolute bg-background/85"
          style={{ top: piece.top, left: piece.left, width: piece.width, height: piece.height }}
          data-testid="tour-scrim"
        />
      ))}
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-panel"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            outline: "2px solid hsl(var(--ring))",
          }}
          data-testid="tour-spotlight"
        />
      ) : null}

      <div
        className="absolute inset-x-0 space-y-2 border-border bg-card p-4 shadow-elev-2"
        style={placement === "bottom" ? { bottom: 0, borderTopWidth: 1 } : { top: 0, borderBottomWidth: 1 }}
        data-testid="tour-caption"
        data-placement={placement}
      >
        <p className="text-xs text-muted-foreground" data-testid="tour-progress">
          Step {stepIndex + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="text-base font-semibold">{step.title}</h2>
        <p className="text-sm text-muted-foreground">{step.body}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => finish("skipped")} className="min-h-11" data-testid="tour-skip">
            Skip
          </Button>
          <Button
            variant="outline"
            onClick={back}
            disabled={stepIndex === 0}
            className="min-h-11"
            data-testid="tour-back"
          >
            Back
          </Button>
          <Button onClick={next} className="min-h-11" data-testid="tour-next">
            {stepIndex + 1 === TOUR_STEPS.length ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
};
