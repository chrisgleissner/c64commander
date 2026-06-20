/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * DOM scope resolution + interactive-element discovery for the keypad focus ring.
 *
 * Reachability is "complete by construction" (CONFIRMED DECISION 1): instead of
 * every CTA opting in with {@link useFocusItem}, the provider scans the live DOM
 * of the ACTIVE SCOPE and builds the ring from whatever interactive elements it
 * finds, in DOM order. `useFocusItem`/`useFocusGroup` become optional refinement
 * (explicit id / order / grouping / custom activation / opt-out), not the
 * mechanism for basic reachability.
 *
 * This module is the DOM-aware-but-stateless half: given a `Document`/scope it
 * answers "which element is the active scope?" and "which interactive elements
 * live in it, in order?". The stateful engine (MutationObserver, tabindex shims,
 * `setItems`) lives in {@link FocusDiscoveryEngine}; the pure navigation logic in
 * {@link FocusController}. Everything here works in jsdom so it is unit-testable.
 */

/** Marks a subtree as off-limits to the focus ring (skipped during discovery). */
export const SKIP_ATTR = "data-key-nav-skip";

/** Declares an element a focus group (its discovered descendants become children). Value is an optional id. */
export const GROUP_ATTR = "data-focus-group";

/**
 * Names a focus scope region. `page` is an explicit page-content root (optional —
 * discovery falls back to `document.body`); `tabbar` is the persistent bottom tab
 * bar, discovered as its own scope appended AFTER page content and excluded from
 * the page scan so its tabs always sort last.
 */
export const SCOPE_ATTR = "data-focus-scope";

/**
 * Controls whose Left/Right keys belong to the control (value step / segment /
 * tab / radio) rather than the global ring. The capture-phase listener checks
 * the focused element against this so a slider's value step is never pre-empted
 * by sibling navigation (HAZARD: capture runs before the widget's bubble handler).
 */
export const HORIZONTAL_OWNER_SELECTOR =
  "[role='slider'],[role='tablist'],[role='radiogroup'],[data-key-nav-horizontal]";

/** Open Radix-style overlays that own the keyboard while focus is inside them. */
export const OVERLAY_SELECTOR =
  "[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox'],[data-radix-popper-content-wrapper]";

/**
 * The interactive elements the ring can land on. Mirrors the native
 * focusable/interactive set plus ARIA widget roles and the slider thumb; excludes
 * are applied separately ({@link isFocusVisible}/{@link isFocusDisabled}/skip).
 *
 * `input[type=file]` is excluded: a file input is operated through its styled
 * trigger button/label (it pops the native picker on click) and is conventionally
 * a visually-hidden element, so it is never a meaningful ring stop on its own.
 */
export const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden']):not([type='file'])",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='option']",
  "[role='slider']",
  "[role='spinbutton']",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(",");

const TABBAR_SELECTOR = `[${SCOPE_ATTR}='tabbar']`;

/**
 * Visible to the focus ring. Walks ancestors for `hidden` / `aria-hidden` /
 * `inert` / `display:none` / `visibility:hidden`. Deliberately does NOT use
 * `offsetParent`/`getBoundingClientRect` as the gate: `offsetParent` is null for
 * legitimately-visible `position:fixed` elements (false negative) and is unusable
 * in jsdom — the ancestor walk is both correct in a real browser and testable.
 */
export const isFocusVisible = (element: Element): boolean => {
  let node: Element | null = element;
  const view = element.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null);
  while (node && node instanceof HTMLElement) {
    if (node.hasAttribute("hidden")) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.hasAttribute("inert")) return false;
    if (view) {
      const style = view.getComputedStyle(node);
      if (style.display === "none") return false;
      if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    node = node.parentElement;
  }
  return true;
};

/** Disabled for the ring: the `disabled` property/attribute or `aria-disabled="true"`. */
export const isFocusDisabled = (element: Element): boolean => {
  if ("disabled" in element && (element as { disabled?: boolean }).disabled === true) return true;
  if (element.hasAttribute("disabled")) return true;
  return element.getAttribute("aria-disabled") === "true";
};

/** Within a `data-key-nav-skip` subtree (bounded at `scope`). */
export const isSkipped = (element: Element, scope: Element): boolean => {
  let node: Element | null = element;
  while (node && node !== scope.parentElement) {
    if (node.hasAttribute(SKIP_ATTR)) return true;
    node = node.parentElement;
  }
  return false;
};

/** True when the browser can focus the element without a `tabindex` shim. */
export const isNativelyFocusable = (element: Element): boolean => {
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A") return element.hasAttribute("href");
  if (element instanceof HTMLElement) {
    if (element.isContentEditable) return true;
    if (element.tabIndex >= 0) return true;
  }
  return element.getAttribute("tabindex") !== null && element.getAttribute("tabindex") !== "-1";
};

/** True when Left/Right belong to this element's control rather than the ring. */
export const isHorizontalKeyOwner = (element: Element | null): boolean =>
  element instanceof Element && element.closest(HORIZONTAL_OWNER_SELECTOR) !== null;

const ROW_TOLERANCE_PX = 8;

/**
 * Reading-order comparator. DOM order is the basis; when both elements have a
 * real layout box (a real browser, not jsdom) it refines to visual reading order
 * — top-to-bottom across rows, left-to-right within a row — so CSS that reorders
 * relative to source still traverses the way the user sees it. With no geometry
 * (jsdom / zero-box) it is pure DOM order, keeping unit tests deterministic.
 */
export const compareFocusables = (a: Element, b: Element): number => {
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const aHasBox = ra.width > 0 || ra.height > 0;
  const bHasBox = rb.width > 0 || rb.height > 0;
  if (aHasBox && bHasBox) {
    if (Math.abs(ra.top - rb.top) > ROW_TOLERANCE_PX) return ra.top - rb.top;
    if (Math.abs(ra.left - rb.left) > 1) return ra.left - rb.left;
  }
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
};

export type ActiveScopeKind = "overlay" | "page";

export interface ActiveScope {
  readonly element: Element;
  readonly kind: ActiveScopeKind;
}

/** Whether `scope` holds at least one discoverable interactive element. */
const hasInteractive = (scope: Element): boolean => {
  const candidates = scope.querySelectorAll(INTERACTIVE_SELECTOR);
  for (const candidate of candidates) {
    if (isFocusVisible(candidate) && !isFocusDisabled(candidate) && !isSkipped(candidate, scope)) return true;
  }
  return false;
};

/**
 * The element whose interactive children the ring should currently traverse:
 *
 *   - When one or more overlays are open (dialog / alertdialog / menu / listbox /
 *     popover), the TOPMOST one that actually contains a focusable — so a stray
 *     empty tooltip-popper never traps the scope and the page behind a modal is
 *     inert. Topmost = last in DOM order (Radix portals stack mount order).
 *   - Otherwise the page-content region: an explicit `[data-focus-scope='page']`
 *     if present, else `document.body`.
 */
export const resolveActiveScope = (doc: Document): ActiveScope => {
  const overlays = Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).filter(
    (overlay) => isFocusVisible(overlay) && hasInteractive(overlay),
  );
  if (overlays.length > 0) {
    // Prefer an overlay not contained by a later one; among siblings, the last in
    // DOM order is on top.
    let top = overlays[overlays.length - 1];
    for (const overlay of overlays) {
      if (top.contains(overlay) && overlay !== top) top = overlay;
    }
    return { element: top, kind: "overlay" };
  }
  const explicitPage = doc.querySelector(`[${SCOPE_ATTR}='page']`);
  return { element: explicitPage ?? doc.body, kind: "page" };
};

export interface DiscoverOptions {
  /** Selectors whose subtrees are excluded (e.g. the TabBar when scanning the page). */
  readonly excludeSubtrees?: readonly string[];
}

/**
 * Every interactive element within `scope`, filtered (visible, enabled, not
 * skipped, not inside an excluded subtree) and sorted into reading order.
 * Deduped by element identity.
 */
export const discoverInteractiveElements = (scope: Element, options: DiscoverOptions = {}): HTMLElement[] => {
  const excluded = options.excludeSubtrees ?? [];
  const seen = new Set<Element>();
  const result: HTMLElement[] = [];
  for (const candidate of scope.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (seen.has(candidate)) continue;
    if (!isFocusVisible(candidate)) continue;
    if (isFocusDisabled(candidate)) continue;
    if (isSkipped(candidate, scope)) continue;
    if (excluded.some((selector) => candidate.closest(selector))) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  result.sort(compareFocusables);
  return result;
};

/** Selector for the persistent bottom tab bar scope (excluded from the page scan). */
export const TABBAR_SCOPE_SELECTOR = TABBAR_SELECTOR;

/**
 * The nearest ancestor group container of `element` within `groups`, bounded by
 * `scope` (never climbs out of the active scope). Used to attach a discovered
 * leaf to the card/section that owns it so "OK descends into the card".
 */
export const nearestGroupElement = (element: Element, groups: ReadonlySet<Element>, scope: Element): Element | null => {
  let node: Element | null = element.parentElement;
  while (node && node !== scope.parentElement) {
    if (groups.has(node)) return node;
    if (node === scope) break;
    node = node.parentElement;
  }
  return null;
};
