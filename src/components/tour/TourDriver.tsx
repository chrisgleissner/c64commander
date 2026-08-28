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
import { useC64Connection } from "@/hooks/useC64Connection";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { captionPlacement, scrimRects, unionRect, type Rect } from "@/lib/tour/spotlight";
import { isDeviceBackKey, resolveInputProfile, resolveSemanticAction } from "@/lib/input";
import { TOUR_STEPS, tourStepIndex } from "@/lib/tour/steps";
import { TOUR_ACTIVE_ATTRIBUTE, loadTourState, saveTourState, type TourStartRequest } from "@/lib/tour/tourState";

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

export interface TourDriverProps {
  /** Where to start. A new object per request, so a second request restarts the walk. */
  readonly request: TourStartRequest;
  readonly onFinished: () => void;
}

/** Keypad bindings prepended to the keyboard ones, so a D-pad and a keyboard both resolve here. */
const TOUR_KEYMAP = resolveInputProfile("keypad");

export const TourDriver = ({ request, onFinished }: TourDriverProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useC64Connection();

  const [stepIndex, setStepIndex] = useState(() => tourStepIndex(request.fromStepId ?? null));
  /*
   * The run's bounds. A full tour is every step; the offer Home makes after a first connection is
   * the steps that needed a machine and stops there, rather than carrying on through the rest and
   * repeating what has already been seen. The progress line counts within the range.
   */
  const firstIndex = tourStepIndex(request.fromStepId ?? null);
  const lastIndex = request.throughStepId === undefined ? TOUR_STEPS.length - 1 : tourStepIndex(request.throughStepId);
  const stepCount = Math.max(1, lastIndex - firstIndex + 1);
  const [hole, setHole] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const ranWithoutDeviceRef = useRef(false);

  const step = TOUR_STEPS[stepIndex];

  // Restarted on a fresh request, so asking for the device chapter while the tour is up moves to it.
  useEffect(() => {
    ranWithoutDeviceRef.current = false;
    setStepIndex(tourStepIndex(request.fromStepId ?? null));
  }, [request]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.setAttribute(TOUR_ACTIVE_ATTRIBUTE, "true");
    return () => document.documentElement.removeAttribute(TOUR_ACTIVE_ATTRIBUTE);
  }, []);

  // Read from a ref rather than a dependency: the path changes as a RESULT of this effect, and
  // depending on it would re-run the resolver on its own navigation.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // Navigate and open, through the same resolver search and the Home tiles use.
  useEffect(() => {
    if (!step) return;
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
  }, [step, navigate, status.isConnected]);

  /*
   * Re-measured on scroll, resize and orientation change, so the hole cannot drift off its anchor.
   *
   * It runs for a step with no anchor too. The viewport starts at 0 by 0 and this is its only
   * writer, so returning early left the scrim a single empty rectangle: the opening step, the one
   * step that points at nothing, dimmed none of the app behind its caption.
   */
  useEffect(() => {
    const remeasure = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setHole(step?.anchor ? unionRect(measureAnchors(step.anchor.testIds)) : null);
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
  }, [step]);

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
      setHole(null);
      onFinished();
    },
    [onFinished, stepIndex],
  );

  const next = useCallback(() => {
    setStepIndex((current) => {
      if (current + 1 > lastIndex) {
        // Deferred out of the updater: finish() writes storage and sets state of its own.
        queueMicrotask(() => finish("completed"));
        return current;
      }
      return current + 1;
    });
  }, [finish, lastIndex]);

  // Clamped to the run's first step, not to zero: the device-steps offer starts partway in, and
  // going back past its start would show a step the user has already been through and read as
  // "Step 0 of 4".
  const back = useCallback(() => setStepIndex((current) => Math.max(firstIndex, current - 1)), [firstIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * The tour owns the keys while it is up. Left and Right are Back and Next, OK is Next, and
       * the Back key skips, which is the same "Back goes out" rule the rest of the app follows.
       *
       * Resolved through the keymap, not off `event.key`. A keypad handset's D-pad emits
       * `code: "DpadLeft"` with `key: "Unidentified"`, so comparing key names left the tour
       * undrivable on the one kind of hardware that has no pointer to fall back on. The device
       * Back button resolves to no action at all and is asked for by name.
       */
      const semantic = resolveSemanticAction(TOUR_KEYMAP, event);
      const handled: Partial<Record<string, () => void>> = {
        dpadLeft: back,
        dpadRight: next,
        enter: next,
        center: next,
        activate: next,
        escape: () => finish("skipped"),
        back: () => finish("skipped"),
      };
      const action =
        event.key === " " ? next : isDeviceBackKey(event) ? () => finish("skipped") : handled[semantic ?? ""];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [back, finish, next]);

  if (!step) return null;

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

      {/*
        The panel reaches the edge of the screen, and its buttons must not. On a handset with
        gesture navigation the bottom inset is the system bar: without this the Skip, Back and Next
        row was drawn underneath it, half covered and hard to hit. Padding rather than an offset, so
        the panel still meets the edge instead of leaving a strip of the page showing below it.
      */}
      <div
        className="absolute inset-x-0 space-y-2 border-border bg-card p-4 shadow-elev-2"
        style={
          placement === "bottom"
            ? { bottom: 0, borderTopWidth: 1, paddingBottom: "calc(1rem + var(--safe-area-inset-bottom, 0px))" }
            : { top: 0, borderBottomWidth: 1, paddingTop: "calc(1rem + var(--safe-area-inset-top, 0px))" }
        }
        data-testid="tour-caption"
        data-placement={placement}
      >
        <p className="text-xs text-muted-foreground" data-testid="tour-progress">
          Step {stepIndex - firstIndex + 1} of {stepCount}
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
            disabled={stepIndex === firstIndex}
            className="min-h-11"
            data-testid="tour-back"
          >
            Back
          </Button>
          <Button onClick={next} className="min-h-11" data-testid="tour-next">
            {stepIndex === lastIndex ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TourDriver;
