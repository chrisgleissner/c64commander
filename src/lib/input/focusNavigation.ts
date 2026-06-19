/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Semantic-action → navigation dispatch for keypad-only (D-pad + center) use.
 *
 * {@link FocusController} owns the ordered registry — "what's next / previous /
 * activate". This layer sits on top and turns a {@link SemanticAction} into the
 * right operation, and implements the deterministic `back` chain a keypad-first
 * device needs:
 *
 *   close popup → leave menu → leave field → navigate back
 *
 * It stays DOM-free and timer-free so it can be unit-tested in isolation; a thin
 * React adapter feeds normalized key events in and wires the {@link NavigationOutcome}
 * out (e.g. `element.focus()` on a move, `router.back()` when the chain is
 * exhausted). Horizontal d-pad and soft keys are intentionally returned as
 * `ignored` here so the *focused widget* (slider/toggle/select, or a context
 * soft-key handler) can own them without the global controller stealing them.
 */

import { FocusController, type FocusItem } from "./focusController";
import type { SemanticAction } from "./keyEvent";

/**
 * A dismissible overlay (modal/dialog/sheet/dropdown or an in-page menu). Pushed
 * when shown and popped by `back`/`escape`; the topmost is always dismissed
 * first, so nested overlays unwind in LIFO order (popup over menu → popup goes
 * first, matching "close popup → leave menu").
 */
export interface DismissibleLayer {
  readonly id: string;
  /** Distinguishes a modal/dialog (`popup`) from an in-page `menu`. */
  readonly kind: "popup" | "menu";
  /** Invoked when `back`/`escape`/`closeMenu` dismisses this layer. */
  readonly dismiss: () => void;
}

/** What a single {@link NavigationController.dispatch} call resolved to. */
export type NavigationOutcome =
  | { readonly type: "focusMoved"; readonly item: FocusItem }
  | { readonly type: "activated"; readonly item: FocusItem }
  | { readonly type: "layerDismissed"; readonly layer: DismissibleLayer }
  | { readonly type: "fieldDisengaged" }
  | { readonly type: "navigatedBack" }
  | { readonly type: "ignored" };

export interface NavigationCallbacks {
  /** Called when navigation settles on an item (adapter does `element.focus()`). */
  readonly onFocus?: (item: FocusItem) => void;
  /** Called when an item is activated (in addition to the item's own `activate`). */
  readonly onActivate?: (item: FocusItem) => void;
  /** Called when an engaged text field should disengage (adapter does `element.blur()`). */
  readonly onFieldDisengage?: () => void;
  /** Called when the `back` chain is exhausted (adapter does `router.back()`). */
  readonly onNavigateBack?: () => void;
}

export interface NavigationControllerOptions {
  /** Reuse an existing registry; a fresh {@link FocusController} is created otherwise. */
  readonly focus?: FocusController;
  readonly callbacks?: NavigationCallbacks;
}

const FOCUS_NEXT_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>(["dpadDown", "nextField"]);
const FOCUS_PREVIOUS_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>(["dpadUp", "previousField"]);
const ACTIVATE_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>(["center", "enter", "activate"]);
const BACK_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>(["back", "escape"]);

/**
 * Drives keyboard-only navigation over a {@link FocusController}, plus a stack of
 * dismissible overlays and an "engaged field" flag, so `back` always has a
 * single deterministic meaning regardless of which screen is showing.
 */
export class NavigationController {
  readonly focus: FocusController;
  private readonly callbacks: NavigationCallbacks;
  private layers: DismissibleLayer[] = [];
  private fieldEngaged = false;

  constructor(options: NavigationControllerOptions = {}) {
    this.focus = options.focus ?? new FocusController();
    this.callbacks = options.callbacks ?? {};
  }

  /** Registers (or replaces, by id) an overlay; it becomes the topmost layer. */
  pushLayer(layer: DismissibleLayer): void {
    this.layers = this.layers.filter((entry) => entry.id !== layer.id);
    this.layers.push(layer);
  }

  /** Removes an overlay that closed by other means (no `dismiss` is fired). */
  removeLayer(id: string): void {
    this.layers = this.layers.filter((entry) => entry.id !== id);
  }

  /** The overlay `back` would dismiss next, or `null` when none are open. */
  topLayer(): DismissibleLayer | null {
    return this.layers.length > 0 ? this.layers[this.layers.length - 1] : null;
  }

  /** The current overlay depth (number of open dismissible layers). */
  get layerDepth(): number {
    return this.layers.length;
  }

  /** Marks a text field as engaged (editing) so `back` disengages it first. */
  setFieldEngaged(engaged: boolean): void {
    this.fieldEngaged = engaged;
  }

  /** Whether a text field is currently engaged. */
  get isFieldEngaged(): boolean {
    return this.fieldEngaged;
  }

  /** Applies a semantic action and returns what it resolved to. */
  dispatch(action: SemanticAction): NavigationOutcome {
    if (FOCUS_NEXT_ACTIONS.has(action)) {
      return this.move(() => this.focus.focusNext());
    }
    if (FOCUS_PREVIOUS_ACTIONS.has(action)) {
      return this.move(() => this.focus.focusPrevious());
    }
    if (ACTIVATE_ACTIONS.has(action)) {
      return this.activate();
    }
    if (BACK_ACTIONS.has(action)) {
      return this.back();
    }
    if (action === "closeMenu") {
      return this.closeTopMenu();
    }
    // Horizontal d-pad, soft keys, digits, and openMenu are owned elsewhere
    // (focused widget / T9 composer / context handlers), not by global nav.
    return { type: "ignored" };
  }

  private move(step: () => FocusItem | null): NavigationOutcome {
    const item = step();
    if (item === null) return { type: "ignored" };
    this.callbacks.onFocus?.(item);
    return { type: "focusMoved", item };
  }

  private activate(): NavigationOutcome {
    const item = this.focus.current();
    if (!this.focus.activateCurrent() || item === null) return { type: "ignored" };
    this.callbacks.onActivate?.(item);
    return { type: "activated", item };
  }

  /** The deterministic `back` chain: close popup → leave menu → leave field → navigate back. */
  private back(): NavigationOutcome {
    const top = this.topLayer();
    if (top) {
      this.removeLayer(top.id);
      top.dismiss();
      return { type: "layerDismissed", layer: top };
    }
    if (this.fieldEngaged) {
      this.fieldEngaged = false;
      this.callbacks.onFieldDisengage?.();
      return { type: "fieldDisengaged" };
    }
    this.callbacks.onNavigateBack?.();
    return { type: "navigatedBack" };
  }

  /** `closeMenu` dismisses the topmost `menu`-kind layer only, leaving popups alone. */
  private closeTopMenu(): NavigationOutcome {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (layer.kind === "menu") {
        this.layers.splice(i, 1);
        layer.dismiss();
        return { type: "layerDismissed", layer };
      }
    }
    return { type: "ignored" };
  }
}
