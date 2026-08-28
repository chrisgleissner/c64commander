/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { confirmNavigation } from "@/lib/navigation/navigationGuards";
import { requestSectionOpen } from "@/lib/ui/collapsibleSectionStore";
import { requestConfigItemFocus } from "@/lib/search/configDeepLink";
import type { SearchTarget } from "@/lib/search/types";

/** How long the resolver waits for an anchor to appear before it gives up (spec.md section 5.12). */
export const ANCHOR_WAIT_CEILING_MS = 2_000;
/** How long the landing outline stays on the element that was searched for. */
export const LANDING_HIGHLIGHT_MS = 1_200;

export type NavigateResult = "landed" | "blocked" | "not-found" | "handled";

export interface NavigateOptions {
  /** react-router's navigate, narrowed to what the resolver needs. */
  navigate: (path: string) => void;
  currentPath: string;
  /** Named so the failure toast can say what could not be reached. */
  label: string;
  onToast: (message: string) => void;
  /** Resolves an `action` target. Supplied by the caller, because the map needs app services. */
  runAction?: (handlerId: string) => void | Promise<void>;
}

/**
 * Wait for an element matching `selector`, bounded.
 *
 * A MutationObserver rather than polling: navigating, mounting a lazy page and expanding a card are
 * all DOM writes, so the observer fires on the commit that actually produces the anchor instead of
 * on a timer that is either too eager or too slow.
 */
export const waitForElement = (selector: string, ceilingMs = ANCHOR_WAIT_CEILING_MS): Promise<HTMLElement | null> => {
  if (typeof document === "undefined") return Promise.resolve(null);
  const found = document.querySelector<HTMLElement>(selector);
  if (found) return Promise.resolve(found);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (element: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) finish(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(document.querySelector<HTMLElement>(selector)), ceilingMs);
  });
};

/**
 * The landing highlight, drawn as an attribute the stylesheet turns into an outline and a shadow.
 * Never a border and never a size change: the element must not move under the finger that is about
 * to touch it.
 */
export const markLanded = (element: HTMLElement): void => {
  element.setAttribute("data-search-landed", "true");
  setTimeout(() => element.removeAttribute("data-search-landed"), LANDING_HIGHLIGHT_MS);
};

const focusAnchor = (element: HTMLElement): void => {
  element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  markLanded(element);
  // So the next key press acts on the thing that was searched for. A non-focusable anchor takes a
  // temporary tabindex rather than being left unreachable from the keypad.
  const focusable = element.matches("a[href], button, input, select, textarea, [tabindex]")
    ? element
    : (element.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]") ?? element);
  if (focusable === element && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  focusable.focus({ preventScroll: true });
};

const testIdSelector = (testId: string) => `[data-testid="${CSS.escape(testId)}"]`;

/** Cards are addressed by scope and id, not by testid, which callers override freely. */
const sectionSelector = (scope: string, id: string) =>
  `[data-section-scope="${CSS.escape(scope)}"][data-section-id="${CSS.escape(id)}"]`;

/**
 * The one resolver. Search results, the Home quick actions and the tour all go through it, so a
 * target that can be reached from one can be reached from all three.
 */
export const navigateToSearchTarget = async (
  target: SearchTarget,
  options: NavigateOptions,
): Promise<NavigateResult> => {
  // A guarded page may refuse — an HVSC import in progress, for one — and the caller keeps its
  // overlay open so the user can see why.
  if (!confirmNavigation()) return "blocked";

  if (target.kind === "action") {
    await options.runAction?.(target.handlerId);
    return "handled";
  }

  if (target.kind === "configItem") {
    if (options.currentPath !== "/config") options.navigate("/config");
    requestConfigItemFocus(target.category, target.itemName);
    const anchor = await waitForElement(
      `[data-config-item="${CSS.escape(target.itemName)}"][data-config-category="${CSS.escape(target.category)}"]`,
    );
    if (!anchor) {
      options.onToast(`Could not reach ${options.label}`);
      return "not-found";
    }
    focusAnchor(anchor);
    return "landed";
  }

  if (target.path !== options.currentPath) options.navigate(target.path);

  if (target.kind === "route") {
    // A route has no anchor of its own; arriving is the whole result.
    return "landed";
  }

  const sectionId = target.kind === "section" ? target.id : target.sectionId;
  const section = await waitForElement(sectionSelector(target.scope, sectionId));
  if (!section) {
    options.onToast(`Could not reach ${options.label}`);
    return "not-found";
  }

  if (target.kind === "section") {
    requestSectionOpen(target.scope, target.id);
    focusAnchor(section);
    return "landed";
  }

  requestSectionOpen(target.scope, target.sectionId);
  const control = await waitForElement(testIdSelector(target.testId));
  if (!control) {
    options.onToast(`Could not reach ${options.label}`);
    return "not-found";
  }
  focusAnchor(control);
  return "landed";
};
