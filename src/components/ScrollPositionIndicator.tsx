/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeScrollIndicatorThumb } from "@/lib/scroll/scrollIndicatorGeometry";
import { usePageActivity } from "@/hooks/usePageActivity";

/** Hold after the last scroll frame, before the shared CSS opacity fade begins. */
export const SCROLL_INDICATOR_IDLE_MS = 840;

const EDGE_INSET_PX = 2;
const TRACK_INSET_PX = 4;
const THUMB_WIDTH_PX = 3;
/** While a scroll goes on, how often the track is re-measured in case the content grew. */
const REMEASURE_MS = 250;
/** Outlasts the fade-out, after which the scroll-driven animation is removed until the next scroll. */
const FADE_OUT_MS = 250;

const SURFACE_SELECTOR = "[data-app-surface]";

/**
 * Where the browser can drive an animation from a scroll position, the thumb travels on the
 * compositor and the main thread only shows and hides it. Moving it from script instead re-layered
 * the page on every frame: about 3 ms of main-thread work per frame at 6x CPU throttling.
 */
const supportsScrollTimeline = () =>
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("timeline-scope", "--a") &&
  CSS.supports("animation-timeline", "--a");

let timelineSequence = 0;
const timelinesByHost = new Map<HTMLElement, Set<string>>();

const setHostTimeline = (host: HTMLElement, name: string, present: boolean) => {
  const names = timelinesByHost.get(host) ?? new Set<string>();
  if (present) names.add(name);
  else names.delete(name);
  if (names.size === 0) {
    timelinesByHost.delete(host);
    host.style.removeProperty("timeline-scope");
    return;
  }
  timelinesByHost.set(host, names);
  host.style.setProperty("timeline-scope", [...names].join(", "));
};

/**
 * A thin, proportional thumb at the right edge of a scroll container, shown while it scrolls and
 * faded out shortly after. It is drawn in a portal, so it adds nothing to the container's layout,
 * and nothing about it is rendered by React after it mounts.
 *
 * Inside a sheet or dialog it is drawn in that surface, so it shares its stacking order; for a page
 * it is drawn in the document body, below every surface.
 */
export function ScrollPositionIndicator({
  target,
  showOnPageEntry = false,
}: {
  target: HTMLElement | null;
  showOnPageEntry?: boolean;
}) {
  const pageActive = usePageActivity();
  const active = showOnPageEntry ? pageActive : undefined;
  const indicatorRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(target ? (target.closest<HTMLElement>(SURFACE_SELECTOR) ?? document.body) : null);
  }, [target]);

  useEffect(() => {
    const indicator = indicatorRef.current;
    const thumb = thumbRef.current;
    if (!target || !host || !indicator || !thumb || active === false) return undefined;
    const inSurface = host !== document.body;
    const timeline = supportsScrollTimeline() ? `--scroll-position-${(timelineSequence += 1)}` : null;
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let untrackTimer: ReturnType<typeof setTimeout> | undefined;
    let lastScrollAt = 0;
    let lastMeasureAt = 0;
    let shown = false;
    let entryPending = active === true;
    let entryObserver: MutationObserver | undefined;
    const written = new Map<string, string>();

    const write = (property: string, value: string) => {
      if (written.get(property) === value) return;
      written.set(property, value);
      thumb.style.setProperty(property, value);
    };
    // The animation exists only while the thumb can be seen: an idle one never finishes, and
    // anything that waits for the page's animations to settle would wait on it forever.
    const setShown = (next: boolean) => {
      if (shown === next) return;
      shown = next;
      indicator.dataset.visible = next ? "true" : "false";
      clearTimeout(untrackTimer);
      if (next) thumb.dataset.tracking = "true";
      else untrackTimer = setTimeout(() => (thumb.dataset.tracking = "false"), FADE_OUT_MS);
    };
    const hideWhenIdle = () => {
      const idleFor = performance.now() - lastScrollAt;
      hideTimer =
        idleFor >= SCROLL_INDICATOR_IDLE_MS ? undefined : setTimeout(hideWhenIdle, SCROLL_INDICATOR_IDLE_MS - idleFor);
      if (hideTimer === undefined) setShown(false);
    };

    const draw = () => {
      frame = 0;
      lastMeasureAt = performance.now();
      const thumbGeometry = computeScrollIndicatorThumb(
        { scrollTop: target.scrollTop, scrollHeight: target.scrollHeight, clientHeight: target.clientHeight },
        target.clientHeight - 2 * TRACK_INSET_PX,
      );
      if (!thumbGeometry.visible) {
        setShown(false);
        return;
      }
      const rect = target.getBoundingClientRect();
      const origin = inSurface ? host.getBoundingClientRect() : null;
      const left =
        rect.left + target.clientLeft + target.clientWidth - EDGE_INSET_PX - THUMB_WIDTH_PX - (origin?.left ?? 0);
      const trackTop = rect.top + target.clientTop + TRACK_INSET_PX - (origin?.top ?? 0);
      write("height", `${thumbGeometry.thumbHeight}px`);
      if (timeline) {
        const travel = target.clientHeight - 2 * TRACK_INSET_PX - thumbGeometry.thumbHeight;
        write("--scroll-indicator-x", `${left}px`);
        write("--scroll-indicator-from", `${trackTop}px`);
        write("--scroll-indicator-to", `${trackTop + travel}px`);
      } else {
        write("transform", `translate3d(${left}px, ${trackTop + thumbGeometry.thumbOffset}px, 0)`);
      }
      setShown(true);
      hideTimer ??= setTimeout(hideWhenIdle, SCROLL_INDICATOR_IDLE_MS);
    };

    const onScroll = () => {
      if (entryPending) return;
      lastScrollAt = performance.now();
      const needsDraw = !timeline || !shown || lastScrollAt - lastMeasureAt > REMEASURE_MS;
      if (needsDraw && frame === 0) frame = requestAnimationFrame(draw);
    };

    if (timeline) {
      target.style.setProperty("scroll-timeline", `${timeline} block`);
      setHostTimeline(host, timeline, true);
      thumb.dataset.mode = "timeline";
      write("--scroll-indicator-timeline", timeline);
    }
    target.addEventListener("scroll", onScroll, { passive: true });
    if (entryPending) {
      // Measure once the page is actually presented, not while its slide places it off screen or
      // the launch cover hides it. Observe only these two phase attributes, then disconnect;
      // page entry needs no polling, per-frame JavaScript or ongoing observer.
      const runway = target.closest<HTMLElement>("[data-runway-phase]");
      const shell = target.closest<HTMLElement>("[data-launch-phase]");
      const showEntry = () => {
        if (runway && runway.dataset.runwayPhase !== "idle") return;
        if (shell && shell.dataset.launchPhase !== "app-ready") return;
        entryObserver?.disconnect();
        entryPending = false;
        onScroll();
      };
      entryObserver = new MutationObserver(showEntry);
      if (runway) entryObserver.observe(runway, { attributes: true, attributeFilter: ["data-runway-phase"] });
      if (shell) entryObserver.observe(shell, { attributes: true, attributeFilter: ["data-launch-phase"] });
      showEntry();
    }
    return () => {
      entryObserver?.disconnect();
      target.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
      clearTimeout(untrackTimer);
      indicator.dataset.visible = "false";
      thumb.dataset.tracking = "false";
      if (timeline) {
        target.style.removeProperty("scroll-timeline");
        setHostTimeline(host, timeline, false);
      }
    };
  }, [target, host, active]);

  if (!host) return null;
  return createPortal(
    <div
      ref={indicatorRef}
      className="scroll-position-indicator"
      hidden={active === false}
      data-host={host === document.body ? "page" : "surface"}
      data-visible="false"
      data-testid="scroll-position-indicator"
      aria-hidden="true"
    >
      <div ref={thumbRef} className="scroll-position-thumb" data-mode="frame" data-tracking="false" />
    </div>,
    host,
  );
}
