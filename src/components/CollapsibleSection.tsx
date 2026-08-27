/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";

import { FittedText } from "@/components/ui/FittedText";
import { cn } from "@/lib/utils";
import {
  SECTION_DESCRIPTIONS_KEY,
  announceSectionOpened,
  loadShowSectionDescriptions,
  subscribeSectionsBulk,
  readSectionStates,
  writeSectionState,
} from "@/lib/ui/collapsibleSectionStore";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

export interface CollapsibleSectionProps {
  /** Which page this section belongs to (e.g. "home", "settings", "docs"). Namespaces
   * the persisted open/closed state so two pages can each use the id "video" without
   * reading or writing each other's memory. */
  scope: string;
  id: string;
  title: string;
  /** Alternative wordings for `title`, longest first, for a title that would otherwise be
   * truncated in a narrow header. The longest that fits is drawn; the accessible name stays
   * `title`. Omit for a title that always fits. */
  titleVariants?: readonly string[];
  /** One line saying what is inside, so the page can be read without opening anything.
   * Omit for a page (like Docs) whose card titles already say enough on their own. */
  summary?: string;
  icon: LucideIcon;
  /** Opened on a first visit to this scope, overriding the profile's own default. Set it only
   * where a section is deliberately secondary (closed on a roomy screen) or deliberately the point
   * of the page (open on a small one) - see each call site for which it is. Left unset, the
   * display profile decides: closed on the smallest screen, open where there is room. */
  defaultOpen?: boolean;
  /** Shown beside the title - a count, a state, or a warning that must be visible while closed. */
  badge?: ReactNode;
  /** Forwarded to the toggle button, for a caller that registers the header with the keypad
   * focus engine (`useFocusItem`). */
  headerRef?: Ref<HTMLButtonElement>;
  /** Rendered beside the toggle, outside it (e.g. a "Reset" button) - stays reachable
   * without opening the section, matching what these sections did before they were
   * collapsible. */
  actions?: ReactNode;
  /** Draw the icon without its tinted tile. For a card whose header already carries controls, the
   * tile is decoration that costs the title about 46 CSS px of the row. */
  plainIcon?: boolean;
  /** Extra classes on the card root, for a caller that has to place the card itself. */
  className?: string;
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
  /** Fires whenever the open state changes, including the restore from persisted state on
   * mount and a close forced by the compact profile's one-open-at-a-time rule. Use this,
   * not `onToggle`, for a caller that mirrors the open state (e.g. to gate a lazy fetch on
   * it): `onToggle` only covers the user's own clicks, so a card restored open would leave
   * the mirror reading closed. */
  onOpenChange?: (open: boolean) => void;
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
  titleVariants,
  summary,
  icon: Icon,
  defaultOpen,
  badge,
  headerRef,
  actions,
  plainIcon = false,
  className,
  testId,
  toggleTestId,
  bodyId,
  sectionLabel,
  onOpenChange,
  onToggle,
  onToggleClick,
  children,
}: CollapsibleSectionProps) => {
  const { profile } = useDisplayProfile();
  // Drives the tighter padding and type below. It no longer closes anything: see the note where
  // the accordion effect used to be.
  const compact = profile === "compact";

  /*
   * Closed on every profile, for now.
   *
   * Opening sections by default on the roomier profiles is wanted — on a phone or a tablet there is
   * room to read down the page, and having to open each section to see what a page holds is
   * friction the cards were meant to remove. It is not switched on here because of what it does to
   * keypad navigation: a card is a scope the ring enters with OK, and on a page whose cards are
   * already open that same OK collapses them instead. Four of the Settings keypad-ring tests fail
   * on it, and the fix belongs with the ring rather than with the default. Until then, the Quick
   * menu's "Expand all sections" is how a reader opens a page in one action.
   */
  const resolvedDefaultOpen = defaultOpen ?? false;

  // Read once, during the first render, not from an effect. From an effect the card renders
  // closed and then opens on the next commit, and a caller mirroring the open state (see
  // `onOpenChange`) sees a false "closed" in between — the Config page's Audio Mixer card treats
  // exactly that as "the card was closed" and undoes an active Solo.
  const [open, setOpen] = useState(() => {
    // Only override the default if THIS id was explicitly toggled before. An id the user never
    // touched keeps the default regardless of what else in the scope was opened or closed
    // (see the store's own comment).
    const stored = readSectionStates(scope);
    return stored.has(id) ? (stored.get(id) ?? resolvedDefaultOpen) : resolvedDefaultOpen;
  });

  /*
   * Expand all / Collapse all, from the Quick menu.
   *
   * A bulk open deliberately does not announce itself, which is what suspends the compact
   * profile's one-card-at-a-time rule for it: that rule exists to keep the list of titles on
   * screen around whatever is open, and a reader who asked for every section is overriding it on
   * purpose. The choice is persisted like any other, so it survives leaving the page.
   */
  useEffect(
    () =>
      subscribeSectionsBulk((nextOpen) => {
        setOpen((current) => {
          if (current === nextOpen) return current;
          writeSectionState(scope, id, nextOpen);
          return nextOpen;
        });
      }),
    [scope, id],
  );
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

  /*
   * How many cards are open is the reader's choice, on every profile.
   *
   * The compact profile used to force one at a time: a 320x427 screen has 218 CSS px of
   * scrollable height, and with every card free to stay open Settings measured 2796 px of
   * scroll. Closing the siblings kept the list of titles on screen around whatever was open.
   *
   * It is gone because it took the choice away. A reader who wants two cards side by side to
   * compare them, or every card open to read straight down the page, could not have it: opening
   * the second closed the first, and the state was persisted so the closure outlived the visit.
   * Long pages are what scrolling is for. `announceSectionOpened` still fires, so anything else
   * that wants to know a card opened still hears it.
   */

  // Mirrors `open` out to a caller that needs it, from an effect so every path that changes
  // it is covered — the user's click, the restore on mount, and the accordion close.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

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
      className={cn("overflow-hidden rounded-panel border border-border bg-card", className)}
      data-testid={testId ?? `${scope}-section-${id}`}
      data-open={open ? "true" : "false"}
      data-section-label={sectionLabel ?? title}
    >
      <div className="flex items-center gap-3 pr-1">
        {/* The clickable toggle stops at the chevron; `actions` sits as a sibling rather
            than inside this button, because an interactive control (e.g. a Reset button)
            cannot nest inside another button without breaking the DOM and the a11y tree. */}
        <button
          type="button"
          ref={headerRef}
          onClick={toggle}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-between text-left",
            // Compact trims the header's own padding and gaps. Tuned for a 393 px screen, the
            // original px-4/py-3/gap-3 spent about 12 CSS px per card that a 320x427 screen with
            // 218 px of scrollable height cannot spare — roughly one extra card on screen.
            // min-h-11 is the 44px touch floor. The compact profile trims padding and drops the icon
            // tile, but it must not take the row below the floor: the target handset's touchscreen
            // is off by default, not absent, and this app also runs on small touch phones.
            //
            // The other profiles keep the tile but no longer let it set the row height. A closed
            // card is one line of text, and Settings stacks eleven of them; at py-3 around a
            // p-2 tile each closed card cost 67.5 CSS px on the phone profile against 27 px of
            // actual text. py-2 around a p-1.5 tile holds the row at 54 px, still above the 44 px
            // touch floor, and gives back most of a screen over the length of the page.
            compact ? "min-h-11 gap-2 px-3 py-1.5" : "min-h-11 gap-2.5 px-4 py-2",
          )}
          // The accessibility tree exposes the HTML id, not data-testid, so this is what
          // makes the header addressable from outside the browser.
          id={resolvedToggleTestId}
          data-testid={resolvedToggleTestId}
          aria-expanded={open}
          aria-controls={resolvedBodyId}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            {/*
              Compact drops the tile around the icon and keeps the icon itself. The tile was a 30 px
              box in a 47 px row, so it — not the title — set the height of every closed card, and a
              320x427 screen has 218 px of scrollable height to spend. The icon still carries the
              scanning cue; the box around it was decoration.
            */}
            <span className={cn(compact || plainIcon ? "shrink-0" : "rounded-lg bg-primary/10 p-1.5")}>
              <Icon
                className={cn("text-primary", compact || plainIcon ? "h-[1.125rem] w-[1.125rem]" : "h-5 w-5")}
                aria-hidden
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
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
                {/*
                  `flex-1` when the title has alternative wordings, so it fills the row rather than
                  shrinking to its own text. `FittedText` measures the width it has been given, and
                  in a shrink-to-fit box that is whatever the current wording needs — which makes
                  the measurement a feedback loop: once a shorter wording is chosen the box shrinks
                  to it and the longer one never fits again. Two identical drive cards side by side
                  ended up reading "A" and "Drive B".
                */}
                <h2 className={cn("min-w-0 truncate font-medium", titleVariants?.length ? "flex-1" : undefined)}>
                  {titleVariants && titleVariants.length > 0 ? (
                    <FittedText variants={titleVariants} label={title} />
                  ) : (
                    title
                  )}
                </h2>
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
                    showSummary ? (compact ? "text-sm" : "text-xs") : "sr-only",
                  )}
                >
                  {summary}
                </span>
              ) : null}
            </span>
          </span>
        </button>
        {actions}
        {/*
          Fixed order across every card: title, then any actions, then the chevron hard against the
          right edge. The chevron used to sit inside the toggle button, which put `actions` to its
          RIGHT and moved the chevron's horizontal position from card to card depending on whether
          that card had an action. A control that moves is a control you have to look for, and on a
          card with a destructive action (Home's "Reset" on Drives) the two ended up adjacent.
          `gap-3` keeps a deliberate separation between the action and the chevron.

          The chevron is its own button so it can sit outside the toggle — an interactive control
          cannot nest inside another button. It is kept out of the accessibility tree and out of the
          tab order, so it adds no second "expand" node for a screen reader or the keypad ring: it
          is a second touch target for the same action the header row already exposes.
        */}
        <button
          type="button"
          onClick={toggle}
          tabIndex={-1}
          aria-hidden="true"
          // A real touch target, so 44x44 and not just 44 tall.
          className="flex size-11 shrink-0 items-center justify-center"
          // Deliberately NOT prefixed with the toggle's testid: callers select every header on a
          // page with a prefix match (`^home-section-toggle-`), and a chevron caught by that
          // selector is clicked as if it were another header — which closes the card the real
          // header just opened.
          data-testid={`${scope}-section-chevron-${id}`}
        >
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          </motion.span>
        </button>
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
            <div className={cn("border-t border-border", compact ? "space-y-3 px-3 py-3" : "space-y-4 px-4 py-4")}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
};
