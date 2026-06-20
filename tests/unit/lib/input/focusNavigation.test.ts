/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { FocusController, type FocusItem } from "@/lib/input/focusController";
import { NavigationController, type DismissibleLayer, type NavigationCallbacks } from "@/lib/input/focusNavigation";

const item = (id: string, order: number, overrides: Partial<FocusItem> = {}): FocusItem => ({
  id,
  order,
  activate: overrides.activate ?? vi.fn(),
  disabled: overrides.disabled,
  group: overrides.group,
  parentId: overrides.parentId,
});

const layer = (id: string, kind: DismissibleLayer["kind"], dismiss = vi.fn()): DismissibleLayer => ({
  id,
  kind,
  dismiss,
});

const withItems = (callbacks?: NavigationCallbacks): NavigationController => {
  const controller = new NavigationController({ callbacks });
  controller.focus.register(item("a", 0));
  controller.focus.register(item("b", 1));
  controller.focus.register(item("c", 2));
  return controller;
};

describe("NavigationController — focus traversal", () => {
  it("dpadDown and nextField both move to the next enabled item and fire onFocus", () => {
    const onFocus = vi.fn();
    const nav = withItems({ onFocus });

    expect(nav.dispatch("dpadDown")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "b" }) });
    expect(nav.dispatch("nextField")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "c" }) });
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus.mock.calls.map((c) => (c[0] as FocusItem).id)).toEqual(["b", "c"]);
  });

  it("dpadUp and previousField move to the previous item with wrap-around", () => {
    const nav = withItems();
    // current is "a"; previous wraps to "c".
    expect(nav.dispatch("dpadUp")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "c" }) });
    expect(nav.dispatch("previousField")).toEqual({
      type: "focusMoved",
      item: expect.objectContaining({ id: "b" }),
    });
  });

  it("returns `ignored` (no onFocus) when there are no enabled items to move to", () => {
    const onFocus = vi.fn();
    const nav = new NavigationController({ callbacks: { onFocus } });
    nav.focus.register(item("only", 0, { disabled: true }));

    expect(nav.dispatch("dpadDown")).toEqual({ type: "ignored" });
    expect(nav.dispatch("previousField")).toEqual({ type: "ignored" });
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("dpadRight descends into child CTAs and dpadLeft climbs back to the parent", () => {
    const onFocus = vi.fn();
    const nav = new NavigationController({ callbacks: { onFocus } });
    nav.focus.register(item("card", 0));
    nav.focus.register(item("after", 1));
    nav.focus.register(item("primary", 0, { parentId: "card" }));
    nav.focus.register(item("secondary", 1, { parentId: "card" }));

    expect(nav.dispatch("dpadRight")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "primary" }) });
    expect(nav.dispatch("dpadDown")).toEqual({
      type: "focusMoved",
      item: expect.objectContaining({ id: "secondary" }),
    });
    expect(nav.dispatch("dpadLeft")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "card" }) });
    expect(nav.dispatch("dpadDown")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "after" }) });
    expect(onFocus.mock.calls.map((call) => (call[0] as FocusItem).id)).toEqual([
      "primary",
      "secondary",
      "card",
      "after",
    ]);
  });

  it("reuses a provided FocusController instance", () => {
    const focus = new FocusController();
    focus.register(item("x", 0));
    const nav = new NavigationController({ focus });
    expect(nav.focus).toBe(focus);
    expect(nav.focus.current()?.id).toBe("x");
  });
});

describe("NavigationController — activation", () => {
  it("center/enter/activate activate the current item and fire onActivate", () => {
    const activate = vi.fn();
    const onActivate = vi.fn();
    const nav = new NavigationController({ callbacks: { onActivate } });
    nav.focus.register(item("go", 0, { activate }));

    expect(nav.dispatch("center")).toEqual({ type: "activated", item: expect.objectContaining({ id: "go" }) });
    expect(nav.dispatch("enter").type).toBe("activated");
    expect(nav.dispatch("activate").type).toBe("activated");
    expect(activate).toHaveBeenCalledTimes(3);
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it("does not activate a disabled current item", () => {
    const activate = vi.fn();
    const onActivate = vi.fn();
    const nav = new NavigationController({ callbacks: { onActivate } });
    nav.focus.register(item("d", 0, { disabled: true, activate }));

    expect(nav.dispatch("center")).toEqual({ type: "ignored" });
    expect(activate).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("returns `ignored` when nothing is registered", () => {
    const nav = new NavigationController();
    expect(nav.dispatch("activate")).toEqual({ type: "ignored" });
  });
});

describe("NavigationController — deterministic back chain", () => {
  it("closes the topmost overlay first (popup over menu unwinds LIFO)", () => {
    const menuDismiss = vi.fn();
    const popupDismiss = vi.fn();
    const onNavigateBack = vi.fn();
    const nav = withItems({ onNavigateBack });

    nav.pushLayer(layer("menu", "menu", menuDismiss));
    nav.pushLayer(layer("popup", "popup", popupDismiss));
    expect(nav.layerDepth).toBe(2);

    const first = nav.dispatch("back");
    expect(first.type).toBe("layerDismissed");
    expect(popupDismiss).toHaveBeenCalledTimes(1);
    expect(menuDismiss).not.toHaveBeenCalled();
    expect(nav.layerDepth).toBe(1);

    expect(nav.dispatch("escape").type).toBe("layerDismissed");
    expect(menuDismiss).toHaveBeenCalledTimes(1);
    expect(nav.layerDepth).toBe(0);
    expect(onNavigateBack).not.toHaveBeenCalled();
  });

  it("after overlays, disengages an engaged field before navigating back", () => {
    const onFieldDisengage = vi.fn();
    const onNavigateBack = vi.fn();
    const nav = withItems({ onFieldDisengage, onNavigateBack });
    nav.setFieldEngaged(true);
    expect(nav.isFieldEngaged).toBe(true);

    expect(nav.dispatch("back")).toEqual({ type: "fieldDisengaged" });
    expect(onFieldDisengage).toHaveBeenCalledTimes(1);
    expect(nav.isFieldEngaged).toBe(false);
    expect(onNavigateBack).not.toHaveBeenCalled();
  });

  it("navigates back when no overlay is open and no field is engaged", () => {
    const onNavigateBack = vi.fn();
    const nav = withItems({ onNavigateBack });
    expect(nav.dispatch("back")).toEqual({ type: "navigatedBack" });
    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("escape climbs out of a nested CTA scope but never navigates the route", () => {
    const onFocus = vi.fn();
    const onNavigateBack = vi.fn();
    const nav = new NavigationController({ callbacks: { onFocus, onNavigateBack } });
    nav.focus.register(item("card", 0));
    nav.focus.register(item("child", 0, { parentId: "card" }));

    expect(nav.dispatch("dpadRight")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "child" }) });
    expect(nav.dispatch("escape")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "card" }) });
    expect(onNavigateBack).not.toHaveBeenCalled();

    // Chain exhausted: keyboard escape resolves to `ignored` (Radix/browser owns
    // it) and must NOT call navigate(-1); only the hardware back button does.
    expect(nav.dispatch("escape")).toEqual({ type: "ignored" });
    expect(onNavigateBack).not.toHaveBeenCalled();
  });

  it("hardware back navigates the route once the back chain is exhausted", () => {
    const onNavigateBack = vi.fn();
    const nav = new NavigationController({ callbacks: { onNavigateBack } });
    nav.focus.register(item("card", 0));

    expect(nav.dispatch("back")).toEqual({ type: "navigatedBack" });
    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("navigatedBack is a no-op-safe outcome when no callback is wired", () => {
    const nav = new NavigationController();
    expect(nav.dispatch("back")).toEqual({ type: "navigatedBack" });
  });

  it("pushLayer replaces an existing layer with the same id (no duplicate dismiss)", () => {
    const firstDismiss = vi.fn();
    const secondDismiss = vi.fn();
    const nav = new NavigationController();
    nav.pushLayer(layer("dlg", "popup", firstDismiss));
    nav.pushLayer(layer("dlg", "popup", secondDismiss));
    expect(nav.layerDepth).toBe(1);

    nav.dispatch("back");
    expect(secondDismiss).toHaveBeenCalledTimes(1);
    expect(firstDismiss).not.toHaveBeenCalled();
  });

  it("removeLayer drops a self-closed overlay without firing its dismiss", () => {
    const dismiss = vi.fn();
    const onNavigateBack = vi.fn();
    const nav = new NavigationController({ callbacks: { onNavigateBack } });
    nav.pushLayer(layer("sheet", "popup", dismiss));
    nav.removeLayer("sheet");
    expect(nav.layerDepth).toBe(0);
    expect(dismiss).not.toHaveBeenCalled();

    expect(nav.dispatch("back").type).toBe("navigatedBack");
  });

  it("topLayer reports the overlay back would dismiss next", () => {
    const nav = new NavigationController();
    expect(nav.topLayer()).toBeNull();
    nav.pushLayer(layer("a", "menu"));
    nav.pushLayer(layer("b", "popup"));
    expect(nav.topLayer()?.id).toBe("b");
  });
});

describe("NavigationController — closeMenu", () => {
  it("dismisses the topmost menu and leaves popups untouched", () => {
    const menuDismiss = vi.fn();
    const popupDismiss = vi.fn();
    const nav = new NavigationController();
    nav.pushLayer(layer("menu", "menu", menuDismiss));
    nav.pushLayer(layer("popup", "popup", popupDismiss));

    const outcome = nav.dispatch("closeMenu");
    expect(outcome.type).toBe("layerDismissed");
    expect(menuDismiss).toHaveBeenCalledTimes(1);
    expect(popupDismiss).not.toHaveBeenCalled();
    expect(nav.layerDepth).toBe(1);
    expect(nav.topLayer()?.id).toBe("popup");
  });

  it("returns `ignored` when no menu is open", () => {
    const nav = new NavigationController();
    nav.pushLayer(layer("popup", "popup"));
    expect(nav.dispatch("closeMenu")).toEqual({ type: "ignored" });
    expect(nav.layerDepth).toBe(1);
  });
});

describe("NavigationController — open-layer guard (HAZARD 2)", () => {
  it("ignores vertical nav and activation while a dismissible layer is open", () => {
    const onFocus = vi.fn();
    const onActivate = vi.fn();
    const nav = withItems({ onFocus, onActivate });
    nav.pushLayer(layer("dropdown", "popup"));

    // The open layer (e.g. a Radix Select) owns Up/Down/Enter — the underlying
    // ring must NOT move underneath it.
    expect(nav.dispatch("dpadDown")).toEqual({ type: "ignored" });
    expect(nav.dispatch("dpadUp")).toEqual({ type: "ignored" });
    expect(nav.dispatch("nextField")).toEqual({ type: "ignored" });
    expect(nav.dispatch("center")).toEqual({ type: "ignored" });
    expect(nav.dispatch("enter")).toEqual({ type: "ignored" });
    expect(nav.dispatch("activate")).toEqual({ type: "ignored" });
    expect(onFocus).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("still runs the back chain so keypad back can close the open layer", () => {
    const dismiss = vi.fn();
    const onNavigateBack = vi.fn();
    const nav = withItems({ onNavigateBack });
    nav.pushLayer(layer("dropdown", "popup", dismiss));

    expect(nav.dispatch("back").type).toBe("layerDismissed");
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(nav.layerDepth).toBe(0);
    expect(onNavigateBack).not.toHaveBeenCalled();

    // With the layer gone, vertical nav resumes normally.
    expect(nav.dispatch("dpadDown")).toEqual({ type: "focusMoved", item: expect.objectContaining({ id: "b" }) });
  });
});

describe("NavigationController — actions owned elsewhere", () => {
  it.each<["dpadLeft" | "dpadRight" | "softLeft" | "softRight" | "openMenu" | "digit5"]>([
    ["dpadLeft"],
    ["dpadRight"],
    ["softLeft"],
    ["softRight"],
    ["openMenu"],
    ["digit5"],
  ])("returns `ignored` for %s so the focused widget/handler can own it", (action) => {
    const nav = withItems();
    expect(nav.dispatch(action)).toEqual({ type: "ignored" });
  });
});
