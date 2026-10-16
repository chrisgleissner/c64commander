/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getInputModality } from "@/lib/input/inputModality";

type ListFilterFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
};

export const ListFilterField = ({
  value,
  onChange,
  placeholder,
  testId,
  inputRef,
  className,
}: ListFilterFieldProps) => (
  <div className={cn("relative", className)}>
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    <Input
      ref={inputRef}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="pl-9 pr-9 h-9"
      data-testid={testId}
    />
    {value && (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange("")}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
        aria-label="Clear filter"
      >
        <X className="h-4 w-4" />
      </Button>
    )}
  </div>
);

/** The scroller the list moves in, and an element inside it that should not move when the filter collapses. */
export type ListFilterScrollAnchor = { anchor: HTMLElement; scroller: HTMLElement };

/** The part of the screen the filtered list occupies: entering or scrolling it means the filter is done. */
export type ListFilterRegion = {
  /** Focus arriving in here after the filter collapses it; this is how the keypad enters the list. */
  focusRegion: () => HTMLElement | null;
  scrollAnchor: () => ListFilterScrollAnchor | null;
};

/** Scrolling by less than this is a finger resting on the list, not a reader moving through it. */
export const AUTO_COLLAPSE_SCROLL_PX = 24;
/** A scroll this long after the last finger movement or wheel event is momentum, still the reader's own. */
const USER_SCROLL_INTENT_MS = 1000;

/** The element that scrolls `element`, which on a page that scrolls as a whole is the document's. */
export const nearestScroller = (element: HTMLElement): HTMLElement => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
};

const scrollEventTarget = (scroller: HTMLElement): HTMLElement | Window =>
  scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;

type AnchorSnapshot = { anchor: HTMLElement; scroller: HTMLElement; top: number };

type KeepListStillProps = {
  expanded: boolean;
  autoCollapsed: boolean;
  resolveAnchor: () => ListFilterScrollAnchor | null;
  children: React.ReactNode;
};

/**
 * Collapsing the filter by itself must not move the list the reader is looking at. The list's
 * position is read immediately before React removes the filter's rows and restored by scrolling
 * immediately after, before the browser paints. Only a class component can read the layout at that
 * point, which is the reason this is one.
 */
class KeepListStillOnAutoCollapse extends React.Component<KeepListStillProps> {
  getSnapshotBeforeUpdate(previous: KeepListStillProps): AnchorSnapshot | null {
    if (!previous.expanded || this.props.expanded || !this.props.autoCollapsed) return null;
    const resolved = this.props.resolveAnchor();
    if (!resolved) return null;
    return { ...resolved, top: resolved.anchor.getBoundingClientRect().top };
  }

  componentDidUpdate(_previous: KeepListStillProps, _state: unknown, snapshot: AnchorSnapshot | null) {
    if (!snapshot) return;
    const moved = snapshot.anchor.getBoundingClientRect().top - snapshot.top;
    if (Math.abs(moved) < 0.5) return;
    scrollEventTarget(snapshot.scroller).scrollBy({ top: moved, behavior: "instant" });
  }

  render() {
    return this.props.children;
  }
}

type CollapsibleListFilterProps = ListFilterFieldProps & {
  /** Controls that narrow the list beyond the text, such as type checkboxes. */
  header?: React.ReactNode;
  /** What `header` currently restricts the list to, or null when it restricts nothing. */
  headerSummary?: string | null;
  toggleTestId: string;
  region: ListFilterRegion;
};

export const describeListFilter = (text: string, headerSummary: string | null | undefined): string | null => {
  const parts = [text.trim() ? `“${text.trim()}”` : null, headerSummary ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

/**
 * A list filter that folds into one row when the reader moves on to the list, so the list gets the
 * screen. It folds when the list is scrolled by touch or wheel, or when focus enters the list, which
 * is how the keypad moves there. It never folds while its text field has focus. Folded, the row
 * still says what the filter is doing, so an active filter is never out of sight.
 */
export const CollapsibleListFilter = ({
  value,
  onChange,
  placeholder,
  testId,
  header,
  headerSummary,
  toggleTestId,
  region,
}: CollapsibleListFilterProps) => {
  const [state, setState] = useState<{ expanded: boolean; auto: boolean }>({ expanded: false, auto: false });
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef(region);
  regionRef.current = region;
  const contentId = useId();
  const summary = describeListFilter(value, headerSummary);

  const collapseAutomatically = useCallback(() => {
    if (document.activeElement && document.activeElement === inputRef.current) return;
    setState((previous) => (previous.expanded ? { expanded: false, auto: true } : previous));
  }, []);

  useEffect(() => {
    if (!state.expanded) return undefined;
    const handleFocusIn = (event: FocusEvent) => {
      const focusRegion = regionRef.current.focusRegion();
      const panel = panelRef.current;
      if (!focusRegion || !panel || !(event.target instanceof Node) || !focusRegion.contains(event.target)) return;
      const pastTheFilter = panel.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (pastTheFilter && !panel.contains(event.target)) collapseAutomatically();
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [collapseAutomatically, state.expanded]);

  // `region` changes when a virtualised list mounts its scroller, which can be after the filter unfolds.
  useEffect(() => {
    if (!state.expanded) return undefined;
    const scroller = region.scrollAnchor()?.scroller;
    if (!scroller) return undefined;
    const target = scrollEventTarget(scroller);
    let baseline = scroller.scrollTop;
    let lastIntentAt = Number.NEGATIVE_INFINITY;
    const markIntent = () => {
      lastIntentAt = performance.now();
    };
    // Scrolls nobody asked for - the keypad ring bringing a control into view, a virtual list
    // correcting its estimate, a list shortened by the filter itself - move the baseline instead.
    const handleScroll = () => {
      const position = scroller.scrollTop;
      const byReader = getInputModality() === "pointer" && performance.now() - lastIntentAt < USER_SCROLL_INTENT_MS;
      if (!byReader) {
        baseline = position;
        return;
      }
      if (Math.abs(position - baseline) < AUTO_COLLAPSE_SCROLL_PX) return;
      // The list can only be held still if it can scroll back by the height the filter gives up.
      const released = (panelRef.current?.offsetHeight ?? 0) - (toggleRef.current?.offsetHeight ?? 0);
      if (position < released) return;
      collapseAutomatically();
    };
    // A finger that moves or a wheel that turns, not a tap: a tap on a type filter can shorten the
    // list and clamp the scroll position, and that must not fold the filter under the finger.
    const intentEvents = ["touchmove", "wheel"] as const;
    intentEvents.forEach((name) => target.addEventListener(name, markIntent, { passive: true }));
    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      intentEvents.forEach((name) => target.removeEventListener(name, markIntent));
      target.removeEventListener("scroll", handleScroll);
    };
  }, [collapseAutomatically, region, state.expanded]);

  const toggleLabel = state.expanded ? "Hide filter" : summary ? `Filter: ${summary}` : "Filter files";

  return (
    <KeepListStillOnAutoCollapse
      expanded={state.expanded}
      autoCollapsed={state.auto}
      resolveAnchor={() => regionRef.current.scrollAnchor()}
    >
      <div
        ref={panelRef}
        id={contentId}
        className="space-y-1"
        data-testid={`${toggleTestId}-panel`}
        data-expanded={state.expanded ? "true" : "false"}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* First in the DOM so the keypad steps from it into the field, though it is drawn last. */}
          <Button
            ref={toggleRef}
            variant="outline"
            size="sm"
            aria-expanded={state.expanded}
            aria-controls={contentId}
            aria-label={toggleLabel}
            onClick={() => setState((previous) => ({ expanded: !previous.expanded, auto: false }))}
            className={cn(
              "order-last min-w-0 whitespace-normal text-left",
              state.expanded ? "w-11 shrink-0 px-0" : "flex-1 justify-start",
              !state.expanded && summary ? "border-primary/60 bg-primary/10" : null,
            )}
            data-testid={toggleTestId}
            data-filter-active={summary ? "true" : "false"}
          >
            {state.expanded ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <>
                <Search aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid={`${toggleTestId}-summary`}>
                  {toggleLabel}
                </span>
                <ChevronDown aria-hidden="true" />
              </>
            )}
          </Button>
          {state.expanded ? (
            <ListFilterField
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              testId={testId}
              inputRef={inputRef}
              className="min-w-0 flex-1"
            />
          ) : null}
        </div>
        {state.expanded && header ? <div className="min-w-0">{header}</div> : null}
      </div>
    </KeepListStillOnAutoCollapse>
  );
};
