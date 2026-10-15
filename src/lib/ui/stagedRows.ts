/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createElement, useCallback, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";

/**
 * Builds a long list of rows over several tasks instead of one. A config card's rows each carry a
 * select, a slider or a field, and opening every card on the keypad handset built 458 of them in one
 * task of almost a second, during which no key was handled. The first rows of the lists rendered for
 * one commit are built at once, shared across lists so that opening every card does not multiply them.
 * The allowance lasts until the commit, not for a task: React renders a page in 5 ms slices with a task
 * boundary between them, and a per-task allowance was renewed for every slice. Rows near the screen,
 * or above it, are built before the next paint. The rest are built after it, in document order, a few
 * per task.
 */
const INITIAL_ROWS_PER_COMMIT = 12;

/** How far below the viewport a pending list still counts as on screen, in viewport heights. */
const NEAR_VIEWPORT = 1.5;

/** Rows added before the paint while a list's unbuilt end is on screen. */
const NEAR_STEP = 6;

/**
 * At most this many rows are added before one paint for being near the screen, across all lists. A
 * card that is opening is still animating from zero height, so every list in it reads as on screen
 * however many rows it is given: opening every card built every row before the paint without a cap.
 */
const NEAR_ROWS_PER_TASK = 24;

/**
 * The script time one background task may spend building rows. A task builds at least a few: each
 * task ends in a layout of the whole page, which costs the same for one row as for eight.
 */
const TASK_BUDGET_MS = 16;
const MIN_ROWS_PER_TASK = 6;
const MAX_ROWS_PER_TASK = 32;

type StagedList = {
  marker: HTMLElement | null;
  count: number;
  remaining: number;
  grow: (rows: number) => void;
};

let enabled = true;
let initialRowsLeft = INITIAL_ROWS_PER_COMMIT;
let nearRowsLeft = NEAR_ROWS_PER_TASK;
let nearBudgetResetScheduled = false;
let msPerRowEstimate = 2;
let drainScheduled = false;
let draining = false;
let scrollCheckScheduled = false;
let watchingScroll = false;

const pending = new Set<StagedList>();
const settleCallbacks: Array<() => void> = [];

/** Build every row at once. For tests that assert on a list's content right after rendering it. */
export const setStagedRowsEnabled = (value: boolean) => {
  enabled = value;
};

const resetNearBudgetAfterThisTask = () => {
  if (nearBudgetResetScheduled) return;
  nearBudgetResetScheduled = true;
  queueMicrotask(() => {
    nearRowsLeft = NEAR_ROWS_PER_TASK;
    nearBudgetResetScheduled = false;
  });
};

const claimInitialRows = (wanted: number): number => {
  const granted = Math.min(wanted, initialRowsLeft);
  initialRowsLeft -= granted;
  return granted;
};

const claimNearRows = (): number => {
  resetNearBudgetAfterThisTask();
  const granted = Math.min(NEAR_STEP, nearRowsLeft);
  nearRowsLeft -= granted;
  return granted;
};

const growNear = (list: StagedList) => {
  const rows = claimNearRows();
  if (rows > 0) list.grow(rows);
};

const afterNextPaint = (run: () => void) => {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(run, 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(run, 0));
};

/** Above the screen counts as near: an unbuilt list there moves everything the reader is looking at. */
const isAboveScreen = (marker: HTMLElement) => marker.getBoundingClientRect().top < 0;
const isNearScreen = (marker: HTMLElement) =>
  typeof window === "undefined" || marker.getBoundingClientRect().top < window.innerHeight * NEAR_VIEWPORT;

const inDocumentOrder = (lists: StagedList[]) =>
  lists.sort((a, b) => {
    if (!a.marker || !b.marker) return 0;
    return a.marker.compareDocumentPosition(b.marker) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

const runSettleCallbacks = () => {
  if (pending.size > 0) return;
  for (const callback of settleCallbacks.splice(0)) callback();
};

/** Whether `node` is inside a list that still has rows to build. */
export const isInsidePendingList = (node: Node): boolean => {
  for (const list of pending) {
    if (list.marker?.parentElement?.contains(node)) return true;
  }
  return false;
};

/**
 * Runs `callback` once no list is still being built. The focus ring rescans the page after every DOM
 * change, and a rescan of a page with every card open costs more than a batch of rows does: rescanning
 * between batches made building the rows slower than building them all at once.
 */
export const afterStagedRowsSettle = (callback: () => void): void => {
  if (pending.size === 0) {
    callback();
    return;
  }
  settleCallbacks.push(callback);
};

const drain = () => {
  drainScheduled = false;
  const lists = inDocumentOrder([...pending]);
  if (lists.length === 0) return;
  let rowsLeft = Math.max(
    MIN_ROWS_PER_TASK,
    Math.min(MAX_ROWS_PER_TASK, Math.round(TASK_BUDGET_MS / msPerRowEstimate)),
  );
  const started = performance.now();
  let granted = 0;
  draining = true;
  try {
    flushSync(() => {
      for (const list of lists) {
        if (rowsLeft === 0) break;
        const rows = Math.min(list.remaining, rowsLeft);
        list.grow(rows);
        rowsLeft -= rows;
        granted += rows;
      }
    });
  } finally {
    draining = false;
  }
  if (granted > 0) msPerRowEstimate = (msPerRowEstimate + (performance.now() - started) / granted) / 2;
  scheduleDrain(false);
};

const scheduleDrain = (afterPaint: boolean) => {
  if (drainScheduled || pending.size === 0) return;
  drainScheduled = true;
  if (afterPaint) afterNextPaint(drain);
  else setTimeout(drain, 0);
};

/** A list scrolled toward the screen before its turn is built at once, so the reader never meets a gap. */
const buildWhatScrolledNear = () => {
  scrollCheckScheduled = false;
  const near = [...pending].filter((list) => list.marker && isNearScreen(list.marker));
  if (near.length > 0) flushSync(() => near.forEach(growNear));
};

const onScroll = () => {
  if (scrollCheckScheduled || typeof requestAnimationFrame !== "function") return;
  scrollCheckScheduled = true;
  requestAnimationFrame(buildWhatScrolledNear);
};

const watchScroll = (watch: boolean) => {
  if (watch === watchingScroll || typeof document === "undefined") return;
  watchingScroll = watch;
  if (watch) {
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
  } else {
    document.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onScroll);
  }
};

const register = (list: StagedList) => {
  pending.add(list);
  watchScroll(true);
  scheduleDrain(true);
};

const unregister = (list: StagedList) => {
  if (!pending.delete(list) || pending.size > 0) return;
  watchScroll(false);
  afterNextPaint(runSettleCallbacks);
};

/**
 * Builds every remaining row of the lists inside `scope` now, or of every list without one. A
 * navigation key calls this before the focus ring reads the card it is in, so the ring never stops
 * at the last row that happened to be built. Returns whether anything was built.
 */
export const completeStagedRows = (scope?: Element): boolean => {
  const lists = [...pending].filter((list) => !scope || (list.marker !== null && scope.contains(list.marker)));
  if (lists.length === 0) return false;
  flushSync(() => lists.forEach((list) => list.grow(Number.POSITIVE_INFINITY)));
  return true;
};

export type StagedRows = {
  /** How many of the list's rows to render, from the top. */
  count: number;
  /** Render after the rendered rows. It marks where the unbuilt rows start, and whether the list is on the page. */
  marker: ReactElement | null;
};

/**
 * How many of `total` rows a list renders now. `demandedIndex` is a row that must be rendered at once,
 * such as the one a search result is about to land on; -1 for none.
 */
export const useStagedRows = (total: number, demandedIndex = -1): StagedRows => {
  const initialRef = useRef<number | null>(null);
  if (initialRef.current === null && total > 0) {
    initialRef.current = enabled ? claimInitialRows(total) : Number.POSITIVE_INFINITY;
  }
  const [grown, setGrown] = useState(0);
  const count = Math.min(total, Math.max(initialRef.current ?? 0, grown, demandedIndex + 1));
  // The ref is read by the effect; the state re-runs it when the marker arrives later, as it does
  // when the card holding the list is opened without the list's owner rendering again.
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [markerElement, setMarkerElement] = useState<HTMLDivElement | null>(null);
  const attachMarker = useCallback((element: HTMLDivElement | null) => {
    markerRef.current = element;
    setMarkerElement(element);
  }, []);
  const listRef = useRef<StagedList | null>(null);
  if (listRef.current === null) {
    const created: StagedList = {
      marker: null,
      count: 0,
      remaining: 0,
      grow: (rows) => setGrown((current) => Math.max(current, created.count) + rows),
    };
    listRef.current = created;
  }
  const list = listRef.current;

  // Every claim of a render is made before its commit, so the next render starts with a full allowance.
  useLayoutEffect(() => {
    initialRowsLeft = INITIAL_ROWS_PER_COMMIT;
  });

  useLayoutEffect(() => {
    list.marker = markerRef.current;
    list.count = count;
    list.remaining = total - count;
    if (!list.marker) {
      // Not on the page: its card is closed. It starts over when it is shown again; a card that keeps
      // the list's owner mounted while closed would otherwise show every row it had built at once.
      unregister(list);
      initialRef.current = null;
      setGrown(0);
      return;
    }
    if (list.remaining <= 0) {
      unregister(list);
      return;
    }
    register(list);
    // The drain builds in document order anyway; measuring here would lay out the page once per task.
    if (draining) return;
    if (isAboveScreen(list.marker)) list.grow(Number.POSITIVE_INFINITY);
    else if (isNearScreen(list.marker)) growNear(list);
  }, [count, list, total, markerElement]);

  useLayoutEffect(() => () => unregister(list), [list]);

  const marker = enabled
    ? createElement("div", {
        ref: attachMarker,
        "aria-hidden": true,
        "data-staged-rows-pending": count < total ? "true" : undefined,
        style: { borderTopWidth: 0 },
      })
    : null;
  return { count, marker };
};

export const resetStagedRowsForTests = () => {
  pending.clear();
  settleCallbacks.splice(0);
  initialRowsLeft = INITIAL_ROWS_PER_COMMIT;
  nearRowsLeft = NEAR_ROWS_PER_TASK;
  nearBudgetResetScheduled = false;
  msPerRowEstimate = 2;
  drainScheduled = false;
  scrollCheckScheduled = false;
  watchScroll(false);
};
