/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SECTION_DESCRIPTIONS_KEY,
  SECTION_OPENED_EVENT,
  announceSectionOpened,
  loadShowSectionDescriptions,
  readSectionStates,
  writeSectionState,
  type SectionOpenedDetail,
} from "@/lib/ui/collapsibleSectionStore";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export interface CollapsibleSectionProps {
  /** Which page this section belongs to (e.g. "home", "settings", "docs"). Namespaces
   * the persisted open/closed state so two pages can each use the id "video" without
   * reading or writing each other's memory. */
  scope: string;
  id: string;
  title: string;
  /** One line saying what is inside, so the page can be read without opening anything.
   * Omit for a page (like Docs) whose card titles already say enough on their own. */
  summary?: string;
  icon: LucideIcon;
  /** Opened on a first visit to this scope. Reserved for the section(s) most visits are
   * actually about - see each page's own call site for why a given section does or does
   * not set this. */
  defaultOpen?: boolean;
  /** Shown beside the title - a count, a state, or a warning that must be visible while closed. */
  badge?: ReactNode;
  /** Rendered beside the toggle, outside it (e.g. a "Reset" button) - stays reachable
   * without opening the section, matching what these sections did before they were
   * collapsible. */
  actions?: ReactNode;
  /** Root testid. Defaults to `${scope}-section-${id}`. */
  testId?: string;
  /** Toggle button testid/HTML id. Defaults to `${scope}-section-toggle-${id}`. */
  toggleTestId?: string;
  /** Body element HTML id, referenced by the toggle's `aria-controls`. Defaults to
   * `${scope}-section-body-${id}`. */
  bodyId?: string;
  /** `data-section-label` on the root, read by the screenshot catalog and the keypad
   * focus engine's "innermost wins" section grouping. Defaults to `title`. */
  sectionLabel?: string;
  /** Fires after every toggle, with the new open state - for callers that need their
   * own side effect (analytics, focus movement) beyond the persisted memory this
   * component already keeps on its own. */
  onToggle?: (open: boolean) => void;
  /** Fires on the toggle button's own click event, before the toggle happens - for a
   * caller that traces the click itself (e.g. `wrapUserEvent`) rather than the
   * resulting open/closed state. Most callers want `onToggle`, not this. */
  onToggleClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

/**
 * One collapsible chapter of a page: Settings, Docs and Home's own summary cards all
 * render through this. Closed, a section is one line of plain language (or just its
 * title) saying what it is; open, it is exactly what it always was. Nothing about the
 * content moves - the only thing this adds is whether it is on screen before you have
 * asked for it, and whether that choice is remembered.
 *
 * Which sections are open is remembered per scope, so a user who lives in one of them
 * on one page is not made to open it again on every visit - and touching any section on
 * a page you have not touched before does not disturb a different page's defaults.
 */
export const CollapsibleSection = ({
  scope,
  id,
  title,
  summary,
  icon: Icon,
  defaultOpen = false,
  badge,
  actions,
  testId,
  toggleTestId,
  bodyId,
  sectionLabel,
  onToggle,
  onToggleClick,
  children,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const [showSummary, setShowSummary] = useState(loadShowSectionDescriptions);

  // Off by default, and the setting is read here rather than threaded through every call site
  // because every collapsible card on every page has to answer to it at once.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const apply = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== SECTION_DESCRIPTIONS_KEY) return;
      setShowSummary((current) => {
        const next = loadShowSectionDescriptions();
        // Value-equality bail: this state is set from an effect, and re-setting an equal value
        // on every settings broadcast would re-render every card on the page for nothing.
        return next === current ? current : next;
      });
    };
    window.addEventListener("c64u-app-settings-updated", apply);
    return () => window.removeEventListener("c64u-app-settings-updated", apply);
  }, []);

  useEffect(() => {
    // Only override the initial `defaultOpen` state if THIS id was explicitly toggled
    // before. An id the user never touched must keep its own default regardless of
    // what else in the scope has been opened or closed (see the store's own comment).
    const stored = readSectionStates(scope);
    if (stored.has(id)) setOpen(stored.get(id) ?? defaultOpen);
  }, [scope, id, defaultOpen]);

  const { profile } = useDisplayProfile();
  const singleOpen = profile === "compact";
  const sectionRef = useRef<HTMLElement | null>(null);
  /** True only between a user opening this card and the reveal that follows it. */
  const openedByUserRef = useRef(false);

  /**
   * Bring a freshly-expanded section into view without pushing its own header out of it.
   *
   * Opening a card near the bottom of the list left its body below the fold, which matters more now
   * that one card is open at a time: the reader taps a title and sees nothing happen. `block:
   * "nearest"` is exactly the rule asked for — it scrolls the least amount that brings the element
   * into view, and when the element is TALLER than the scrollport it aligns the top, so the header
   * of the section just opened is never scrolled past. A section already fully visible is left
   * alone.
   *
   * Run after the height animation settles rather than on the click, because until then the body
   * still measures zero and the scroll would be computed against the collapsed box.
   */
  const revealExpanded = useCallback(() => {
    // AnimatePresence also reports the EXIT animation as complete; collapsing must not scroll.
    if (!open) return;
    // Only an explicit toggle scrolls. A `defaultOpen` card reports its open animation complete on
    // MOUNT, so without this the page scrolled itself down the moment it loaded — measured as the
    // first content block sitting 201 px above the header's bottom.
    if (!openedByUserRef.current) return;
    openedByUserRef.current = false;
    const element = sectionRef.current;
    if (!element || typeof element.scrollIntoView !== "function") return;
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open]);

  const toggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onToggleClick?.(event);
      setOpen((current) => {
        const next = !current;
        writeSectionState(scope, id, next);
        if (next) {
          openedByUserRef.current = true;
          announceSectionOpened(scope, id);
        }
        onToggle?.(next);
        return next;
      });
    },
    [scope, id, onToggle, onToggleClick],
  );

  /**
   * One card open at a time, in the compact profile only.
   *
   * A 320x427 screen has 218 CSS px of scrollable height. With every card free to stay open,
   * Settings measured 2796 px of scroll — nearly thirteen screens — and a reader part-way down it
   * can see one card's body and nothing else, with no sense of where they are in the list. Closing
   * the siblings keeps the whole list of titles on screen around whatever is open. On a taller
   * screen there is room for several bodies at once and closing them would just be obstructive, so
   * this is not applied outside compact.
   *
   * The open card is NOT re-opened when the profile changes; only an explicit toggle opens one.
   */
  useEffect(() => {
    if (!singleOpen || typeof window === "undefined") return undefined;
    const onOther = (event: Event) => {
      const detail = (event as CustomEvent<SectionOpenedDetail>).detail;
      if (!detail || detail.scope !== scope || detail.id === id) return;
      setOpen((current) => {
        if (!current) return current;
        // Persisted as well as closed, so returning to the page does not re-open every card the
        // reader has ever looked at.
        writeSectionState(scope, id, false);
        return false;
      });
    };
    window.addEventListener(SECTION_OPENED_EVENT, onOther);
    return () => window.removeEventListener(SECTION_OPENED_EVENT, onOther);
  }, [singleOpen, scope, id]);

  const resolvedToggleTestId = toggleTestId ?? `${scope}-section-toggle-${id}`;
  const resolvedBodyId = bodyId ?? `${scope}-section-body-${id}`;

  return (
    <motion.section
      ref={sectionRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      // Clear the fixed guidance bar when this section is scrolled into view. The variable is 0px
      // whenever the bar is not showing, so nothing is reserved for it then.
      style={{ scrollMarginBottom: "var(--keypad-guidance-reserved-height, 0px)" }}
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid={testId ?? `${scope}-section-${id}`}
      data-open={open ? "true" : "false"}
      data-section-label={sectionLabel ?? title}
    >
      <div className="flex items-center gap-2 pr-2">
        {/* The clickable toggle stops at the chevron; `actions` sits as a sibling rather
            than inside this button, because an interactive control (e.g. a Reset button)
            cannot nest inside another button without breaking the DOM and the a11y tree. */}
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-between text-left",
            // Compact trims the header's own padding and gaps. Tuned for a 393 px screen, the
            // original px-4/py-3/gap-3 spent about 12 CSS px per card that a 320x427 screen with
            // 218 px of scrollable height cannot spare — roughly one extra card on screen.
            // min-h-11 is the 44px touch floor. The compact profile trims padding and drops the icon
            // tile, but it must not take the row below the floor: the target handset's touchscreen
            // is off by default, not absent, and this app also runs on small touch phones.
            singleOpen ? "min-h-11 gap-2 px-3 py-1.5" : "gap-3 px-4 py-3",
          )}
          // The accessibility tree exposes the HTML id, not data-testid, so this is what
          // makes the header addressable from outside the browser.
          id={resolvedToggleTestId}
          data-testid={resolvedToggleTestId}
          aria-expanded={open}
          aria-controls={resolvedBodyId}
        >
          <span className={cn("flex min-w-0 items-center", singleOpen ? "gap-2.5" : "gap-3")}>
            {/*
              Compact drops the tile around the icon and keeps the icon itself. The tile was a 30 px
              box in a 47 px row, so it — not the title — set the height of every closed card, and a
              320x427 screen has 218 px of scrollable height to spend. The icon still carries the
              scanning cue; the box around it was decoration.
            */}
            <span className={cn(singleOpen ? "shrink-0" : "rounded-lg bg-primary/10 p-2")}>
              <Icon className={cn("text-primary", singleOpen ? "h-[1.125rem] w-[1.125rem]" : "h-5 w-5")} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              {/* Still a real heading: the section titles are how the page is navigated, by a
                  screen reader and by anyone scanning it. The badge sits beside the heading
                  rather than inside it, so the heading's accessible name stays the title alone. */}
              {/*
                Title and badge stay on one line, so every closed card is the same height.
                Without `min-w-0`/`truncate` on the heading and `shrink-0` on the badge, a long
                title next to a badge wrapped onto a second row: "Experimental Features" with its
                "7/11 on" badge measured 64 CSS px against 38 for every other card on the page.
              */}
              <span className="flex min-w-0 items-center gap-2">
                <h2 className="min-w-0 truncate font-medium">{title}</h2>
                {badge ? <span className="shrink-0">{badge}</span> : null}
              </span>
              {summary ? (
                // Wrapped, not truncated: a summary cut off mid-word tells the reader less
                // than no summary at all, and these pages are read on a narrow screen.
                //
                // When descriptions are off it becomes screen-reader-only rather than disappearing.
                // Two reasons. It is still useful to someone who cannot see the layout the setting
                // exists to protect. And the accessible NAME of this disclosure button is built from
                // its contents, so dropping the summary shortened "Diagnostics Logs, health checks…"
                // to "Diagnostics" — which then collided with the "Diagnostics" button inside the
                // section, leaving two buttons on the page with one name.
                <span
                  className={cn(
                    "leading-snug text-muted-foreground",
                    showSummary ? (singleOpen ? "text-sm" : "text-xs") : "sr-only",
                  )}
                >
                  {summary}
                </span>
              ) : null}
            </span>
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          </motion.span>
        </button>
        {actions}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={resolvedBodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onAnimationComplete={revealExpanded}
          >
            <div className={cn("border-t border-border", singleOpen ? "space-y-3 px-3 py-3" : "space-y-4 px-4 py-4")}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
};
