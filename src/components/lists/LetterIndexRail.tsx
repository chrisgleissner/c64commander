/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useInputProfile } from "@/hooks/useInputProfile";
import { isEditableTarget } from "@/lib/input/eventTargets";
import { digitForAction, resolveSemanticAction } from "@/lib/input/keyEvent";
import { setInputModality } from "@/lib/input/inputModality";
import { observeElementSize } from "@/lib/ui/sharedResizeObserver";
import {
  INITIAL_LETTER_KEY_STATE,
  buildLetterIndex,
  isLetterRailEligible,
  letterAtRailFraction,
  letterForTitle,
  railFractionForLetter,
  railSlots,
  resolveDigitLetter,
  resolveTypedLetter,
  type LetterIndex,
  type LetterIndexEntry,
  type LetterIndexSource,
  type LetterKeyState,
} from "@/lib/lists/letterIndex";

/** How long the letter bubble stays after the finger lifts or the last letter key. */
export const LETTER_BUBBLE_IDLE_MS = 700;

/** Frames to wait for a virtualised row to render after a jump before giving up on focusing it. */
const ROW_RENDER_FRAMES = 30;

const ROW_TITLE_SELECTOR = '[data-row-title="true"]';

const rowSelectorFor = (id: string) =>
  `[data-row-id="${typeof CSS !== "undefined" && "escape" in CSS ? CSS.escape(id) : id.replace(/"/g, '\\"')}"]`;

export type LetterRailModel = {
  /** What the rail indexes, in list order: the whole list when a source supplies it, else the loaded rows. */
  readonly entries: readonly LetterIndexEntry[];
  readonly index: LetterIndex;
  /** Where each loaded row sits in the rendered list, headers included. */
  readonly listIndexById: ReadonlyMap<string, number>;
  readonly ensureLoaded?: (count: number) => void;
  readonly eligible: boolean;
  readonly scroller: HTMLElement | null;
  readonly setScroller: (element: HTMLElement | Window | null) => void;
};

/** The rail's entries, letters, and whether the list is long enough to be worth indexing. */
export const useLetterRailModel = (
  listItems: readonly { id: string; title: string; variant?: string }[],
  estimatedItemHeightPx: number,
  source?: LetterIndexSource,
): LetterRailModel => {
  const [scroller, setScrollerElement] = useState<HTMLElement | null>(null);
  const setScroller = useCallback(
    (element: HTMLElement | Window | null) => setScrollerElement(element instanceof HTMLElement ? element : null),
    [],
  );
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    if (!scroller) return undefined;
    setViewportHeight(scroller.clientHeight);
    return observeElementSize(scroller, () => setViewportHeight(scroller.clientHeight));
  }, [scroller]);

  const loaded = useMemo(() => {
    const entries: LetterIndexEntry[] = [];
    const listIndexById = new Map<string, number>();
    listItems.forEach((item, listIndex) => {
      if (item.variant === "header") return;
      entries.push({ id: item.id, title: item.title });
      listIndexById.set(item.id, listIndex);
    });
    return { entries, listIndexById };
  }, [listItems]);
  const entries = useMemo(() => source?.getEntries() ?? loaded.entries, [loaded.entries, source]);
  const index = useMemo(() => buildLetterIndex(entries.map((entry) => entry.title)), [entries]);
  const eligible = isLetterRailEligible(index, entries.length, estimatedItemHeightPx, viewportHeight);
  return {
    entries,
    index,
    listIndexById: loaded.listIndexById,
    ensureLoaded: source?.ensureLoaded,
    eligible,
    scroller,
    setScroller,
  };
};

/** Focuses the title of a row once the virtualised list has rendered it, so OK plays that row. */
export const focusRowTitleWhenRendered = (scroller: HTMLElement, id: string, framesLeft = ROW_RENDER_FRAMES) => {
  const title = scroller.querySelector<HTMLElement>(`${rowSelectorFor(id)} ${ROW_TITLE_SELECTOR}`);
  if (title) {
    title.focus({ preventScroll: true });
    return;
  }
  if (framesLeft > 0) requestAnimationFrame(() => focusRowTitleWhenRendered(scroller, id, framesLeft - 1));
};

type LetterIndexRailProps = {
  model: LetterRailModel;
  /** Scrolls the list so the item at this position in the full list, headers included, is at the top. */
  scrollToListIndex: (listIndex: number) => void;
  /** Letter and digit keys pressed inside this element jump; text fields and menus keep their keys. */
  keyScope: HTMLElement | null;
  /** Places the rail's 44 px touch strip; it runs to the screen edge, past the list's own padding. */
  className?: string;
  /** Moves the letters off the screen edge so they line up inside the list's card. */
  letterColumnClassName?: string;
};

/**
 * A letter index at the right edge of a long list. Dragging along it, or pressing a letter key or a
 * keypad digit (multi-tap, as in a keypad phone's contact list), scrolls the list to the first item
 * of that letter and focuses that item's title, so OK plays it. The rail sits in a lane the list
 * leaves free for it, so it is always visible and never covers a row.
 */
export function LetterIndexRail({
  model,
  scrollToListIndex,
  keyScope,
  className,
  letterColumnClassName,
}: LetterIndexRailProps) {
  const { entries, index, listIndexById, ensureLoaded, scroller } = model;
  const railRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [railHeight, setRailHeight] = useState(0);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const activeLetterRef = useRef<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyStateRef = useRef<LetterKeyState>(INITIAL_LETTER_KEY_STATE);
  const pendingRef = useRef<{ id: string; select: boolean } | null>(null);
  const landedIdRef = useRef<string | null>(null);
  const keymap = useInputProfile("keypad");

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    setRailHeight(rail.clientHeight);
    return observeElementSize(rail, () => setRailHeight(rail.clientHeight));
  }, []);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const slots = useMemo(() => railSlots(index.letters, railHeight), [index.letters, railHeight]);

  const showBubble = useCallback((letter: string, fraction: number) => {
    const rail = railRef.current;
    const bubble = bubbleRef.current;
    if (!rail || !bubble) return;
    clearTimeout(hideTimerRef.current);
    const half = bubble.offsetHeight / 2;
    const centre = Math.min(Math.max(fraction * rail.clientHeight, half), rail.clientHeight - half);
    bubble.style.transform = `translateY(${centre - half}px)`;
    // Written directly so the letter stays in the bubble while it fades out.
    bubble.textContent = letter;
    bubble.dataset.visible = "true";
    if (activeLetterRef.current !== letter) {
      activeLetterRef.current = letter;
      setActiveLetter(letter);
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (bubbleRef.current) bubbleRef.current.dataset.visible = "false";
      activeLetterRef.current = null;
      setActiveLetter(null);
    }, LETTER_BUBBLE_IDLE_MS);
  }, []);

  // Selecting moves focus, which the dialog's focus trap and the keypad ring both react to, so a
  // drag selects only where the finger lifts, not at every letter it passes.
  const landOn = useCallback(
    (id: string, select: boolean) => {
      const listIndex = listIndexById.get(id);
      if (listIndex === undefined) return false;
      scrollToListIndex(listIndex);
      landedIdRef.current = id;
      if (select && scroller) focusRowTitleWhenRendered(scroller, id);
      return true;
    },
    [listIndexById, scrollToListIndex, scroller],
  );

  const jumpTo = useCallback(
    (letter: string, select: boolean) => {
      const position = index.firstIndexByLetter.get(letter);
      const target = position === undefined ? undefined : entries[position];
      if (!target || position === undefined) return;
      pendingRef.current = null;
      if (landOn(target.id, select) || !ensureLoaded) return;
      pendingRef.current = { id: target.id, select };
      // Loading rebuilds every row up to the letter, which can take a few frames; the bubble shows first.
      requestAnimationFrame(() => startTransition(() => ensureLoaded(position + 1)));
    },
    [ensureLoaded, entries, index, landOn],
  );

  const selectLanded = useCallback(() => {
    if (pendingRef.current) pendingRef.current = { ...pendingRef.current, select: true };
    else if (landedIdRef.current && scroller) focusRowTitleWhenRendered(scroller, landedIdRef.current);
  }, [scroller]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && landOn(pending.id, pending.select)) pendingRef.current = null;
  }, [landOn]);

  // Letters are read against the rail as it was when the finger went down. A jump can fold the
  // sheet's filter and so make the rail taller mid-drag, which would otherwise move every letter
  // under a finger that has not moved.
  const touchRectRef = useRef<DOMRect | null>(null);
  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const mapped = touchRectRef.current ?? rect;
    const fraction = mapped.height > 0 ? (event.clientY - mapped.top) / mapped.height : 0;
    const letter = letterAtRailFraction(index.letters, fraction);
    if (!letter) return;
    const changed = letter !== activeLetterRef.current;
    const fingerFraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    showBubble(letter, Math.min(Math.max(fingerFraction, 0), 1));
    if (changed || event.type === "pointerdown") jumpTo(letter, false);
  };

  useEffect(() => {
    if (!keyScope) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof Element) || !keyScope.contains(target) || isEditableTarget(target)) return;
      if (target.closest('[role="menu"],[role="listbox"]')) return;
      const action = resolveSemanticAction(keymap, event);
      const digit =
        (action === null ? null : digitForAction(action)) ?? (/^\d$/.test(event.key) ? Number(event.key) : null);
      let letter: string | null;
      if (digit !== null) {
        const resolved = resolveDigitLetter(
          keyStateRef.current,
          digit,
          performance.now(),
          keymap.timing.multiTapTimeoutMs,
          index.letters,
        );
        keyStateRef.current = resolved.state;
        letter = resolved.letter;
      } else {
        letter = resolveTypedLetter(event.key, index.letters);
        keyStateRef.current = INITIAL_LETTER_KEY_STATE;
      }
      if (!letter) return;
      event.preventDefault();
      setInputModality("key-navigation");
      showBubble(letter, railFractionForLetter(index.letters, letter));
      jumpTo(letter, true);
      scheduleHide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index.letters, jumpTo, keyScope, keymap, scheduleHide, showBubble]);

  useEffect(() => {
    const rail = railRef.current;
    if (!scroller || !rail) return undefined;
    const letterById = new Map(entries.map((entry) => [entry.id, letterForTitle(entry.title)]));
    let frame = 0;
    let shown: string | null = null;
    const mark = () => {
      frame = 0;
      const rect = scroller.getBoundingClientRect();
      const row = document.elementFromPoint?.(rect.left + 8, rect.top + 4)?.closest("[data-row-id]");
      const letter = row ? (letterById.get(row.getAttribute("data-row-id") ?? "") ?? null) : null;
      if (!letter || letter === shown) return;
      rail.querySelector(`[data-current="true"]`)?.setAttribute("data-current", "false");
      rail.querySelector(`[data-letter="${letter}"]`)?.setAttribute("data-current", "true");
      shown = letter;
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(mark);
    };
    mark();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [entries, scroller, slots]);

  return (
    <div
      ref={railRef}
      className={cn("absolute right-0 w-11 touch-none select-none", className)}
      data-testid="alphabet-rail"
      aria-hidden="true"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        clearTimeout(hideTimerRef.current);
        touchRectRef.current = event.currentTarget.getBoundingClientRect();
        handlePointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) handlePointer(event);
      }}
      onPointerUp={() => {
        touchRectRef.current = null;
        selectLanded();
        scheduleHide();
      }}
      onPointerCancel={() => {
        touchRectRef.current = null;
        scheduleHide();
      }}
    >
      <div className={cn("flex h-full flex-col items-center", letterColumnClassName)}>
        {slots.map((slot, position) =>
          slot.kind === "letter" ? (
            <span
              key={slot.letter}
              data-letter={slot.letter}
              data-current="false"
              className={cn(
                "flex min-h-0 flex-1 items-center justify-center rounded-sm px-1 text-xs font-semibold leading-none",
                "text-muted-foreground data-[current=true]:text-foreground",
                activeLetter === slot.letter &&
                  "bg-primary text-primary-foreground data-[current=true]:text-primary-foreground",
              )}
            >
              {slot.letter}
            </span>
          ) : (
            <span
              key={`gap-${position}`}
              className="flex min-h-0 flex-1 items-center justify-center text-xs leading-none text-muted-foreground"
            >
              •
            </span>
          ),
        )}
      </div>
      <div
        ref={bubbleRef}
        className="letter-index-bubble pointer-events-none absolute right-full top-0 flex h-14 w-14 items-center justify-center rounded-panel border-2 border-primary bg-background text-3xl font-bold text-primary shadow-elev-2"
        data-testid="alphabet-badge"
        data-visible="false"
      />
    </div>
  );
}
