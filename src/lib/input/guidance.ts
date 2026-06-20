/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Context guidance bar logic (CONFIRMED DECISION 3).
 *
 * The guidance bar is the keypad-first device's single most important
 * discoverability affordance: a fixed, modality-gated strip that names the
 * current scope (breadcrumb) and labels the soft keys / OK / Back for whatever
 * the ring is sitting on. This module is the DOM-aware-but-stateless half:
 *
 *   - {@link classifyFocusKind} / {@link accessibleLabelFor} / {@link hasContextMenu}
 *     read a single element (jsdom-testable) to describe the current ring item.
 *   - {@link resolveGuidanceLabels} is PURE — it turns a plain {@link GuidanceState}
 *     snapshot into the three soft-key labels + breadcrumb, with NO DOM access —
 *     so the label policy ("OK = Open on a group, Edit on a field, …") is unit
 *     tested in isolation.
 *
 * The React component ({@link import("@/components/input/KeypadGuidanceBar")})
 * assembles the {@link GuidanceState} from the controller/engine and renders the
 * result; it never decides label text itself.
 */

import type { InputModality } from "./inputModality";

/** What the current ring item is, for choosing the OK-key label. */
export type FocusKind = "group" | "button" | "link" | "field" | "select" | "switch" | "slider" | "tab" | "none";

/** A plain, DOM-free snapshot of the ring the bar needs to choose its labels. */
export interface GuidanceState {
  /** The keypad feature flag — the bar never shows when off (Prime Directive). */
  readonly enabled: boolean;
  /** The bar shows only in `key-navigation`; a pointer/touch hides it instantly. */
  readonly modality: InputModality;
  /** Whether the ring currently has a selected item at all. */
  readonly hasCurrent: boolean;
  /** Classification of the current item (group / control type). */
  readonly currentKind: FocusKind;
  /** Root→current scope labels, e.g. `["Audio Mixer", "Volume"]`. */
  readonly breadcrumb: readonly string[];
  /** True when the ring is at the top level (no parent scope to ascend to). */
  readonly atRoot: boolean;
  /** True when a text field is engaged for editing (Back disengages it first). */
  readonly fieldEngaged: boolean;
  /** True when a dismissible overlay (Select/dialog/menu) is open and owns keys. */
  readonly layerOpen: boolean;
  /** True when the current item or scope exposes a context/overflow menu. */
  readonly hasMenu: boolean;
}

/** The resolved labels for the three soft keys + the breadcrumb to render. */
export interface GuidanceLabels {
  /** Whether the bar should render at all (flag on AND key-navigation modality). */
  readonly visible: boolean;
  /** Breadcrumb segments, capped to {@link MAX_BREADCRUMB_SEGMENTS} (tail kept). */
  readonly breadcrumb: readonly string[];
  /** Left soft key — Back / Exit / Close / Done depending on the back chain. */
  readonly left: string;
  /** Center / OK key — Open / Edit / Select / Toggle / Adjust / Activate, or null. */
  readonly center: string | null;
  /** Right soft key — "Menu" when a context menu exists, else hidden (null). */
  readonly right: string | null;
}

/** OK-key label per control kind (CONFIRMED DECISION 3). */
const CENTER_LABEL_BY_KIND: Record<FocusKind, string> = {
  group: "Open",
  button: "Activate",
  link: "Open",
  field: "Edit",
  select: "Select",
  switch: "Toggle",
  slider: "Adjust",
  tab: "Switch",
  none: "",
};

/** The compact 480×640 profile only has room for the last few breadcrumb segments. */
export const MAX_BREADCRUMB_SEGMENTS = 3;

/** A context menu the ring can open for the current item / scope on `openMenu`. */
export const CONTEXT_MENU_SELECTOR = '[data-key-nav-menu],[aria-haspopup="menu"],[aria-haspopup="true"]';

/**
 * PURE: derive the soft-key labels + breadcrumb from a {@link GuidanceState}.
 *
 * The back-chain order (CONFIRMED DECISION 2) drives the left/center labels:
 * an open overlay → Close/Select; an engaged field → Done; a nested scope →
 * Exit (ascend); otherwise Back at the page root.
 */
export const resolveGuidanceLabels = (state: GuidanceState): GuidanceLabels => {
  const visible = state.enabled && state.modality === "key-navigation";
  const breadcrumb = state.breadcrumb.slice(-MAX_BREADCRUMB_SEGMENTS);

  let left: string;
  if (state.layerOpen) left = "Close";
  else if (state.fieldEngaged) left = "Done";
  else if (!state.atRoot) left = "Exit";
  else left = "Back";

  let center: string | null;
  if (state.layerOpen) center = "Select";
  else if (state.fieldEngaged) center = "Done";
  else if (!state.hasCurrent) center = null;
  else center = CENTER_LABEL_BY_KIND[state.currentKind] || "Activate";

  const right = state.hasMenu ? "Menu" : null;

  return { visible, breadcrumb, left, center, right };
};

/**
 * Classify a single element for the OK-key label. `isGroup` (a ring concept, not
 * a DOM one — it means "has enabled children") wins, so a card always reads as a
 * group; otherwise the tag/role decides. Detection order matters: a Radix Select
 * trigger is a `<button role="combobox">`, so combobox/listbox is tested before
 * the generic button fallthrough.
 */
export const classifyFocusKind = (element: Element | null, isGroup: boolean): FocusKind => {
  if (isGroup) return "group";
  if (!element) return "none";
  const role = element.getAttribute("role");
  const tag = element.tagName;
  if (role === "slider") return "slider";
  if (role === "tab") return "tab";
  if (
    role === "switch" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "menuitemcheckbox" ||
    role === "menuitemradio"
  )
    return "switch";
  if (role === "combobox" || element.getAttribute("aria-haspopup") === "listbox") return "select";
  if (tag === "SELECT") return "select";
  if (tag === "INPUT") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return "switch";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "field";
  }
  if (tag === "TEXTAREA") return "field";
  if (element instanceof HTMLElement && element.isContentEditable) return "field";
  if (tag === "A") return element.hasAttribute("href") ? "link" : "button";
  if (tag === "BUTTON" || role === "button" || role === "menuitem") return "button";
  return "button";
};

/** Collapse whitespace and cap length so a breadcrumb segment stays one short line. */
const tidyLabel = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 32 ? `${collapsed.slice(0, 31)}…` : collapsed;
};

/**
 * A short human label for the current element, for the breadcrumb tail. Prefers
 * an explicit accessible name (`aria-label`), then visible text, then
 * placeholder/title. Returns `null` when nothing readable is found.
 */
export const accessibleLabelFor = (element: Element | null): string | null => {
  if (!element) return null;
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return tidyLabel(ariaLabel);
  const text = element.textContent;
  if (text && text.trim()) return tidyLabel(text);
  const placeholder = element.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return tidyLabel(placeholder);
  const title = element.getAttribute("title");
  if (title && title.trim()) return tidyLabel(title);
  return null;
};

/** Whether `element` (or a `[data-key-nav-menu-host]` it lives in) exposes a context menu. */
export const hasContextMenu = (element: Element | null): boolean => {
  if (!element) return false;
  if (element.matches(CONTEXT_MENU_SELECTOR)) return true;
  const host = element.closest("[data-key-nav-menu-host]") ?? element;
  return host.querySelector(CONTEXT_MENU_SELECTOR) !== null;
};
