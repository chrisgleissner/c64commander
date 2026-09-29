/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { PanelBottomClose, PanelBottomOpen, PanelTopClose, PanelTopOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useC64Connection } from "@/hooks/useC64Connection";
import { dismissAllToasts } from "@/hooks/use-toast";
import { isHvscInstalled } from "@/lib/hvsc/hvscStateStore";
import { ANCHOR_WAIT_CEILING_MS, navigateToSearchTarget, waitForElement } from "@/lib/search/navigate";
import {
  captionPlacement,
  scrimRects,
  spotlightScrollDelta,
  unionRect,
  type CaptionPlacement,
  type Rect,
  type SpotlightFrame,
} from "@/lib/tour/spotlight";
import { isDeviceBackKey, resolveInputProfile, resolveSemanticAction } from "@/lib/input";
import { TOUR_STEPS, stepBody, tourStepIndex } from "@/lib/tour/steps";
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
 *
 * The guide shows the app; the app is not operable underneath it. The root is inert and hidden from
 * assistive technology, so a tap in the spotlight, TalkBack and the keypad all agree that the guide's
 * own buttons are the only controls on screen.
 */

const anchorElements = (testIds: readonly string[]): HTMLElement[] =>
  testIds
    .map((testId) => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`))
    .filter((element): element is HTMLElement => element !== null);

const measureAnchors = (testIds: readonly string[]): Rect[] => {
  if (typeof document === "undefined") return [];
  return anchorElements(testIds)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
};

const scrollContainerOf = (element: HTMLElement): HTMLElement | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
};

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

const readInset = (name: string): number => {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
};

/** Takes the app out of reach while the guide is up, and returns what puts it back as it was. */
const isolateApp = (): (() => void) | undefined => {
  const root = document.getElementById("root");
  if (!root) return undefined;
  const previousHidden = root.getAttribute("aria-hidden");
  const wasInert = root.hasAttribute("inert");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  return () => {
    if (previousHidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", previousHidden);
    if (!wasInert) root.removeAttribute("inert");
  };
};

export interface TourDriverProps {
  /** Where to start. A new object per request, so a second request restarts the walk. */
  readonly request: TourStartRequest;
  readonly onFinished: () => void;
}

export const TourDriver = ({ request, onFinished }: TourDriverProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useC64Connection();

  const [stepIndex, setStepIndex] = useState(() => tourStepIndex(request.fromStepId ?? null));
  const [captionElement, setCaptionElement] = useState<HTMLDivElement | null>(null);
  const [captionHeight, setCaptionHeight] = useState(0);
  /*
   * "read" shows the explanation; "look" folds the caption to its title and buttons so more of the
   * app shows. The user chooses, with a button or Up and Down, and the choice holds until changed:
   * nothing here folds the caption on a timer or unfolds it because a key was pressed.
   */
  const [mode, setMode] = useState<"read" | "look">("read");
  /*
   * The run's bounds. A full tour is every step; the offer Home makes after a first connection is
   * the steps that needed a machine and stops there, rather than carrying on through the rest and
   * repeating what has already been seen. The progress line counts within the range.
   */
  const firstIndex = tourStepIndex(request.fromStepId ?? null);
  const lastIndex = request.throughStepId === undefined ? TOUR_STEPS.length - 1 : tourStepIndex(request.throughStepId);
  const stepCount = Math.max(1, lastIndex - firstIndex + 1);
  const [hole, setHole] = useState<Rect | null>(null);
  /** Bumped when the resolver settles, so the spotlight re-measures a slow anchor. */
  const [anchorResolved, setAnchorResolved] = useState(0);
  const [anchorSettled, setAnchorSettled] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const ranWithoutDeviceRef = useRef(false);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [hvscInstalled] = useState(isHvscInstalled);

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

  // aria-modal alone does not take the page out of Android's accessibility tree, so TalkBack could
  // reach controls under the caption. Toasts live inside the app, so they go with it.
  useEffect(() => {
    dismissAllToasts();
    return isolateApp();
  }, []);

  // Focus goes into the guide, so TalkBack and the keypad start on its primary action, and comes
  // back to wherever it was when the guide closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Read from a ref rather than a dependency: the path changes as a RESULT of this effect, and
  // depending on it would re-run the resolver on its own navigation.
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  /*
   * Whether the step ran with no machine, recorded without re-running the step.
   *
   * `status.isConnected` used to be a dependency of the effect below, so a single dropout and
   * reconnect mid-tour re-ran that step's navigation, section open, scroll and focus with no user
   * input at all — on a bench where the machine drops out under load, which is most of them.
   */
  const isConnectedRef = useRef(status.isConnected);
  isConnectedRef.current = status.isConnected;
  useEffect(() => {
    if (step?.requiresDevice && !status.isConnected) ranWithoutDeviceRef.current = true;
  }, [step, status.isConnected]);

  useEffect(() => {
    nextButtonRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  // Navigate and open, through the same resolver search and the Home tiles use.
  useEffect(() => {
    setAnchorSettled(false);
    if (!step) return;
    if (!step.anchor) {
      setHole(null);
      setAnchorSettled(true);
      return;
    }
    const stepChange = new AbortController();
    const { path, scope, sectionId, testIds } = step.anchor;
    const isControl = Boolean(scope && sectionId);
    void navigateToSearchTarget(
      isControl && scope && sectionId
        ? { kind: "control", path, scope, sectionId, testId: testIds[0] }
        : { kind: "route", path },
      {
        navigate: (next) => navigate(next),
        currentPath: pathnameRef.current,
        label: step.title,
        // A step whose anchors never appear degrades to the caption alone, so the toast the
        // resolver would raise for search is deliberately swallowed here.
        onToast: () => undefined,
        signal: stepChange.signal,
        scrollBehavior: "instant",
      },
    )
      // A route target resolves as soon as the path changes, before the page it leads to has
      // mounted, so the anchor is waited for here as well, within the same ceiling.
      .then(() =>
        isControl
          ? null
          : waitForElement(`[data-testid="${CSS.escape(testIds[0])}"]`, ANCHOR_WAIT_CEILING_MS, stepChange.signal),
      )
      .then(() => {
        // The resolver waits up to two seconds for the anchor. Measuring on a shorter fixed delay
        // decided a slow step had failed while the element was still on its way, so it is measured
        // again here, once the resolver knows the answer either way.
        if (stepChange.signal.aborted) return;
        // Measured here, in the same update that settles the step: settled with the previous hole
        // still null, a late anchor showed the "not available" text for a frame.
        setHole(unionRect(measureAnchors(testIds)));
        setAnchorResolved((count) => count + 1);
        setAnchorSettled(true);
      });
    if (!isConnectedRef.current && step.requiresDevice) ranWithoutDeviceRef.current = true;
    return () => stepChange.abort();
  }, [step, navigate]);

  /*
   * Re-measured on scroll, resize and orientation change, so the hole cannot drift off its anchor.
   *
   * It runs for a step with no anchor too. The viewport starts at 0 by 0 and this is its only
   * writer, so returning early left the scrim a single empty rectangle: the opening step, the one
   * step that points at nothing, dimmed none of the app behind its caption.
   */
  useEffect(() => {
    // Every scroll anywhere on the page lands here, so nothing is set that has not changed.
    const remeasure = () => {
      setViewport((previous) =>
        previous.width === window.innerWidth && previous.height === window.innerHeight
          ? previous
          : { width: window.innerWidth, height: window.innerHeight },
      );
      const top = readInset("--safe-area-inset-top");
      const bottom = readInset("--safe-area-inset-bottom");
      setInsets((previous) => (previous.top === top && previous.bottom === bottom ? previous : { top, bottom }));
      const next = step?.anchor ? unionRect(measureAnchors(step.anchor.testIds)) : null;
      setHole((previous) => (sameRect(previous, next) ? previous : next));
    };
    remeasure();
    // Measured again on a short delay for the common case, where the anchor is already mounted and
    // only the page's own layout has to land. The slow case is covered by anchorResolved.
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
  }, [step, anchorResolved]);

  const frame: SpotlightFrame = {
    viewportHeight: viewport.height,
    captionHeight,
    insetTop: insets.top,
    insetBottom: insets.bottom,
  };
  /*
   * The edge the caption sits on is decided once the anchor has landed, and then held for the step.
   * Recomputed from every re-measure, a tall anchor scrolled into one band could fit the other band
   * better and send the caption, and the scroll after it, back and forth.
   */
  const [pinnedPlacement, setPinnedPlacement] = useState<CaptionPlacement | null>(null);
  useEffect(() => setPinnedPlacement(null), [stepIndex, mode, viewport.height, captionHeight]);
  const placement = pinnedPlacement ?? captionPlacement(hole, frame);

  const frameRef = useRef(frame);
  frameRef.current = frame;

  /*
   * Moves the anchor into the part of the screen the caption leaves free and returns the edge the
   * caption then belongs on. The resolver scrolls the anchor to the middle of the screen, which is
   * exactly where a caption covering the bottom two thirds put it out of sight.
   *
   * The edge is decided from where the anchor ended up, not from where it was asked to go: a
   * container already at its end scrolls less than asked, and the caption then belongs on whichever
   * edge covers less of what is left.
   */
  const alignAnchor = useCallback(
    (held: CaptionPlacement | null): CaptionPlacement | null => {
      if (!step?.anchor) return null;
      const [first] = anchorElements(step.anchor.testIds);
      const container = first ? scrollContainerOf(first) : null;
      const containerRect = container?.getBoundingClientRect();
      const clipped: SpotlightFrame = containerRect
        ? { ...frameRef.current, clip: { top: containerRect.top, bottom: containerRect.bottom } }
        : frameRef.current;
      const measured = unionRect(measureAnchors(step.anchor.testIds));
      const delta = spotlightScrollDelta(measured, held ?? captionPlacement(measured, clipped), clipped);
      if (delta !== 0) container?.scrollBy({ top: delta, behavior: "instant" });
      const landed = unionRect(measureAnchors(step.anchor.testIds));
      setHole(landed);
      return held ?? captionPlacement(landed, clipped);
    },
    [step],
  );

  useLayoutEffect(() => {
    if (pinnedPlacement !== null || !anchorSettled || !step?.anchor || captionHeight <= 0) return;
    setPinnedPlacement(alignAnchor(null));
  });

  /*
   * Aligned again twice while the page finishes laying out. Opening a Home section animates its
   * height, and the card being described moved 70 px after the first alignment, back under the
   * caption. Bounded, and with the edge held, so it cannot chase itself.
   */
  useEffect(() => {
    if (pinnedPlacement === null) return undefined;
    const timers = [450, 900].map((delay) => setTimeout(() => alignAnchor(pinnedPlacement), delay));
    return () => timers.forEach(clearTimeout);
  }, [alignAnchor, pinnedPlacement]);

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

  const toggleMode = useCallback(() => setMode((current) => (current === "read" ? "look" : "read")), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * The guide owns the keys while it is up. Left and Right are Back and Next, OK presses the
       * guide button that has focus (Next unless the user moved it), Up and Down fold and unfold the
       * caption, and the Back key skips — the same "Back goes out" rule the rest of the app follows.
       *
       * Resolved through the keymap, not off `event.key`. A keypad handset's D-pad emits
       * `code: "DpadLeft"` with `key: "Unidentified"`, so comparing key names left the tour
       * undrivable on the one kind of hardware that has no pointer to fall back on. The device
       * Back button resolves to no action at all and is asked for by name.
       */
      const semantic = resolveSemanticAction(resolveInputProfile("keypad"), event);
      const activateFocused = () => {
        const focused = document.activeElement;
        if (focused instanceof HTMLButtonElement && captionElement?.contains(focused)) focused.click();
        else next();
      };
      const handled: Partial<Record<string, () => void>> = {
        dpadLeft: back,
        dpadRight: next,
        dpadUp: toggleMode,
        dpadDown: toggleMode,
        enter: activateFocused,
        center: activateFocused,
        activate: activateFocused,
        escape: () => finish("skipped"),
        back: () => finish("skipped"),
      };
      const action =
        event.key === " "
          ? activateFocused
          : isDeviceBackKey(event)
            ? () => finish("skipped")
            : handled[semantic ?? ""];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      // A held key repeats. Acting on the repeats walked straight through the tour and, on the last
      // step, completed it: one press is one step.
      if (event.repeat) return;
      action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [back, captionElement, finish, next, toggleMode]);

  /*
   * Measured rather than estimated: the panel's height depends on the step's own wording, the text
   * size the user has chosen and the system inset, none of which this component can predict. It
   * keys off the ELEMENT, not the step, because a ref is still null when an effect keyed on the step
   * first runs.
   */
  useEffect(() => {
    if (captionElement === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setCaptionHeight(captionElement.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(captionElement);
    return () => observer.disconnect();
  }, [captionElement]);

  if (!step) return null;

  const pieces = scrimRects(hole, viewport);
  const degraded = hole === null && step.anchor !== undefined;
  const body =
    degraded && anchorSettled && status.isConnected && step.unavailableBody
      ? step.unavailableBody
      : stepBody(step, { hvscInstalled });
  const reading = mode === "read";
  const stepNumber = stepIndex - firstIndex + 1;
  // A panel folding toward the edge the caption sits on, or opening from it.
  const FoldIcon =
    placement === "bottom" ? (reading ? PanelBottomClose : PanelBottomOpen) : reading ? PanelTopClose : PanelTopOpen;

  // On the body, like every other dialog. Mounted inside the app shell, the overlay never reached
  // Android's accessibility view of a page that had already been read, so Maestro could not find Skip.
  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-caption-title"
      aria-describedby={reading ? "tour-caption-body" : undefined}
      data-testid="tour-overlay"
      data-tour-step={step.id}
      data-tour-degraded={hole === null ? "true" : undefined}
    >
      {/* Focus stays on Next as the user walks on, so nothing would otherwise be read out: the new
          step is announced here. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="tour-announcement">
        {`Step ${stepNumber} of ${stepCount}. ${step.title}. ${body}`}
      </p>
      {pieces.map((piece, index) => (
        <div
          key={index}
          className="absolute bg-background/60"
          style={{ top: piece.top, left: piece.left, width: piece.width, height: piece.height }}
          data-testid="tour-scrim"
        />
      ))}
      {hole ? (
        <div
          className="absolute rounded-panel"
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
        ref={setCaptionElement}
        className="absolute inset-x-0 space-y-1 border-border bg-card px-4 py-3 shadow-elev-2"
        style={{
          // In landscape the system navigation bar runs down one side, over the Next button.
          paddingLeft: "calc(1rem + var(--safe-area-inset-left, 0px))",
          paddingRight: "calc(1rem + var(--safe-area-inset-right, 0px))",
          ...(placement === "bottom"
            ? {
                bottom: 0,
                borderTopWidth: 1,
                paddingBottom: "calc(0.75rem + var(--safe-area-inset-bottom, 0px))",
              }
            : {
                top: 0,
                borderBottomWidth: 1,
                paddingTop: "calc(0.75rem + var(--safe-area-inset-top, 0px))",
              }),
        }}
        data-testid="tour-caption"
        data-placement={placement}
        data-mode={mode}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="tour-caption-title" className="min-w-0 text-base font-semibold">
            {step.title}
          </h2>
          <p
            className="shrink-0 text-xs text-muted-foreground"
            data-testid="tour-progress"
            data-step={stepNumber}
            data-step-count={stepCount}
          >
            <span aria-hidden="true">
              {stepNumber}/{stepCount}
            </span>
            <span className="sr-only">
              Step {stepNumber} of {stepCount}
            </span>
          </p>
        </div>
        {reading ? (
          <p id="tour-caption-body" className="text-sm text-muted-foreground" data-testid="tour-body">
            {body}
          </p>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMode}
            aria-pressed={!reading}
            aria-label={reading ? "Hide the text and show more of the app" : "Show the text again"}
            title={reading ? "Hide the text" : "Show the text"}
            className="size-11 shrink-0"
            data-testid="tour-toggle-text"
          >
            <FoldIcon className="h-6 w-6" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            onClick={() => finish("skipped")}
            className="ml-auto min-h-11"
            data-testid="tour-skip"
          >
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
          <Button ref={nextButtonRef} onClick={next} className="min-h-11" data-testid="tour-next">
            {stepIndex === lastIndex ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TourDriver;
