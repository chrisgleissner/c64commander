/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/**
 * Lets a page draw at once and fill in behind the first paint. Rendering a page with every card open
 * in one task kept it off screen and unresponsive until the last card was built: on a Pixel 4,
 * switching to Config took 2.3 s and Settings 2.0 s. A card that starts on screen, or within half a
 * screen below it, is built before the first paint, so nothing visible arrives late; the rest are
 * built one per task after it, in page order, so a tap or a key is handled between them.
 */
const IMMEDIATE_MOUNTS_PER_TASK = 2;

/** How far below the viewport a card still counts as on screen, in viewport heights. */
const NEAR_VIEWPORT = 1.5;

const isNearViewport = (element: Element) =>
  typeof window === "undefined" || element.getBoundingClientRect().top < window.innerHeight * NEAR_VIEWPORT;

let enabled = true;
let immediateMountsThisTask = 0;
let taskEndScheduled = false;
type WaitingMount = { mount: () => void; anchor: RefObject<Element | null> };

const waiting: WaitingMount[] = [];
let drainScheduled = false;

/** Mount everything at once. For tests that assert on a page's content right after rendering it. */
export const setProgressiveMountEnabled = (value: boolean) => {
  enabled = value;
};

const claimImmediateMount = (): boolean => {
  if (!enabled) return true;
  if (!taskEndScheduled) {
    taskEndScheduled = true;
    queueMicrotask(() => {
      immediateMountsThisTask = 0;
      taskEndScheduled = false;
    });
  }
  if (immediateMountsThisTask >= IMMEDIATE_MOUNTS_PER_TASK) return false;
  immediateMountsThisTask += 1;
  return true;
};

const afterNextPaint = (run: () => void) => {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(run, 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(run, 0));
};

let scrollCheckScheduled = false;

/** A card scrolled toward the screen before its turn is built at once, so the reader never meets a gap. */
const mountWhatScrolledNear = () => {
  scrollCheckScheduled = false;
  for (const entry of [...waiting]) {
    if (entry.anchor.current && isNearViewport(entry.anchor.current)) {
      waiting.splice(waiting.indexOf(entry), 1);
      entry.mount();
    }
  }
  if (waiting.length === 0) stopWatchingScroll();
};

const onScroll = () => {
  if (scrollCheckScheduled) return;
  scrollCheckScheduled = true;
  requestAnimationFrame(mountWhatScrolledNear);
};

let watchingScroll = false;

const startWatchingScroll = () => {
  if (watchingScroll || typeof document === "undefined" || typeof requestAnimationFrame !== "function") return;
  watchingScroll = true;
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
};

const stopWatchingScroll = () => {
  if (!watchingScroll) return;
  watchingScroll = false;
  document.removeEventListener("scroll", onScroll, { capture: true });
};

const mountNext = () => {
  drainScheduled = false;
  waiting.shift()?.mount();
  if (waiting.length > 0) {
    drainScheduled = true;
    setTimeout(mountNext, 0);
  } else {
    stopWatchingScroll();
  }
};

const queueMount = (entry: WaitingMount): (() => void) => {
  waiting.push(entry);
  startWatchingScroll();
  if (!drainScheduled) {
    drainScheduled = true;
    afterNextPaint(mountNext);
  }
  return () => {
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
    if (waiting.length === 0) stopWatchingScroll();
  };
};

/**
 * Builds every waiting card now. A navigation key calls this before the focus ring reads the page:
 * a card's own labelled sections are ring stops once its body is built, so a key pressed while cards
 * were still waiting took a different path through the page. Returns whether anything was built.
 */
export const mountAllWaiting = (): boolean => {
  if (waiting.length === 0) return false;
  const entries = waiting.splice(0);
  stopWatchingScroll();
  flushSync(() => entries.forEach((entry) => entry.mount()));
  return true;
};

/**
 * Whether content that is wanted from the first render may be mounted yet. `anchor` is the element
 * the content belongs to, measured before the first paint. Content that becomes wanted later, such as
 * a card the user opens, is mounted at once.
 */
export const useProgressiveMount = (wanted: boolean, anchor: RefObject<Element | null>): boolean => {
  const [mounted, setMounted] = useState(() => !wanted || claimImmediateMount());
  useLayoutEffect(() => {
    if (!mounted && wanted && anchor.current && isNearViewport(anchor.current)) setMounted(true);
  }, [anchor, mounted, wanted]);
  useEffect(() => {
    if (mounted) return undefined;
    if (!wanted) {
      setMounted(true);
      return undefined;
    }
    return queueMount({ mount: () => setMounted(true), anchor });
  }, [anchor, mounted, wanted]);
  return mounted;
};
