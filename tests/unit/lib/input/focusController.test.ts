/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { FocusController, type FocusItem } from "@/lib/input/focusController";

const item = (id: string, order: number, overrides: Partial<FocusItem> = {}): FocusItem => ({
  id,
  order,
  activate: overrides.activate ?? vi.fn(),
  disabled: overrides.disabled,
  group: overrides.group,
  parentId: overrides.parentId,
});

describe("FocusController", () => {
  it("selects the first enabled item on registration", () => {
    const controller = new FocusController();
    controller.register(item("a", 0));
    controller.register(item("b", 1));
    expect(controller.current()?.id).toBe("a");
  });

  it("focuses next/previous with wrap-around", () => {
    const controller = new FocusController();
    controller.register(item("a", 0));
    controller.register(item("b", 1));
    controller.register(item("c", 2));

    expect(controller.focusNext()?.id).toBe("b");
    expect(controller.focusNext()?.id).toBe("c");
    expect(controller.focusNext()?.id).toBe("a"); // wrap forward
    expect(controller.focusPrevious()?.id).toBe("c"); // wrap backward
  });

  it("skips disabled items during navigation", () => {
    const controller = new FocusController();
    controller.register(item("a", 0));
    controller.register(item("b", 1, { disabled: true }));
    controller.register(item("c", 2));

    expect(controller.current()?.id).toBe("a");
    expect(controller.focusNext()?.id).toBe("c"); // skips disabled b
    expect(controller.focusNext()?.id).toBe("a"); // wraps, still skipping b
  });

  it("orders by `order` then registration sequence regardless of insert order", () => {
    const controller = new FocusController();
    controller.register(item("c", 2));
    controller.register(item("a", 0));
    controller.register(item("b", 0)); // ties with a -> registration order keeps a first
    expect(controller.list().map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("activates the current item and not a disabled one", () => {
    const controller = new FocusController();
    const activateA = vi.fn();
    const activateB = vi.fn();
    controller.register(item("a", 0, { activate: activateA }));
    controller.register(item("b", 1, { disabled: true, activate: activateB }));

    expect(controller.setCurrent("a")).toBe(true);
    expect(controller.activateCurrent()).toBe(true);
    expect(activateA).toHaveBeenCalledTimes(1);

    expect(controller.setCurrent("b")).toBe(true);
    expect(controller.activateCurrent()).toBe(false);
    expect(activateB).not.toHaveBeenCalled();
  });

  it("setCurrent rejects unknown ids", () => {
    const controller = new FocusController();
    controller.register(item("a", 0));
    expect(controller.setCurrent("nope")).toBe(false);
    expect(controller.current()?.id).toBe("a");
  });

  it("unregister clears current and falls back to the first enabled item", () => {
    const controller = new FocusController();
    controller.register(item("a", 0));
    controller.register(item("b", 1));
    expect(controller.setCurrent("a")).toBe(true);
    controller.unregister("a");
    expect(controller.current()?.id).toBe("b");
  });

  it("returns null from navigation when there are no enabled items", () => {
    const controller = new FocusController();
    controller.register(item("a", 0, { disabled: true }));
    expect(controller.current()).toBeNull();
    expect(controller.focusNext()).toBeNull();
    expect(controller.activateCurrent()).toBe(false);
  });

  it("descends into enabled children and climbs back to the parent scope", () => {
    const controller = new FocusController();
    controller.register(item("card-a", 0));
    controller.register(item("card-b", 1));
    controller.register(item("card-a-primary", 0, { parentId: "card-a" }));
    controller.register(item("card-a-secondary", 1, { parentId: "card-a" }));
    controller.register(item("card-b-primary", 0, { parentId: "card-b" }));

    expect(controller.current()?.id).toBe("card-a");
    expect(controller.currentHasEnabledChildren()).toBe(true);
    expect(controller.focusFirstChild()?.id).toBe("card-a-primary");
    expect(controller.currentScopeParentId()).toBe("card-a");
    expect(controller.focusNext()?.id).toBe("card-a-secondary");
    expect(controller.focusNext()?.id).toBe("card-a-primary");
    expect(controller.focusParent()?.id).toBe("card-a");
    expect(controller.currentScopeParentId()).toBeNull();
    expect(controller.focusNext()?.id).toBe("card-b");
  });

  it("does not descend into a parent with only disabled children", () => {
    const controller = new FocusController();
    controller.register(item("card", 0));
    controller.register(item("disabled-child", 0, { parentId: "card", disabled: true }));

    expect(controller.current()?.id).toBe("card");
    expect(controller.currentHasEnabledChildren()).toBe(false);
    expect(controller.focusFirstChild()).toBeNull();
    expect(controller.current()?.id).toBe("card");
  });

  it("does not auto-select a child item as the initial current", () => {
    const controller = new FocusController();
    controller.register(item("child", 0, { parentId: "card" }));
    expect(controller.current()).toBeNull();

    controller.register(item("card", 0));
    expect(controller.current()?.id).toBe("card");
  });

  it("clear() removes all items and resets the active scope", () => {
    const controller = new FocusController();
    controller.register(item("card", 0));
    controller.register(item("card-child", 0, { parentId: "card" }));
    controller.focusFirstChild();
    expect(controller.currentScopeParentId()).toBe("card");

    controller.clear();

    expect(controller.current()).toBeNull();
    expect(controller.currentScopeParentId()).toBeNull();
    expect(controller.focusFirstChild()).toBeNull();
    expect(controller.focusNext()).toBeNull();
  });

  it("unregistering the active scope parent returns focus to the root ring", () => {
    const controller = new FocusController();
    controller.register(item("card-a", 0));
    controller.register(item("card-b", 1));
    controller.register(item("card-a-child", 0, { parentId: "card-a" }));
    controller.focusFirstChild();
    expect(controller.currentScopeParentId()).toBe("card-a");

    controller.unregister("card-a");

    expect(controller.currentScopeParentId()).toBeNull();
    expect(controller.current()?.id).toBe("card-b");
  });

  it("focusParent falls back to the root ring when the scope parent is missing", () => {
    const controller = new FocusController();
    controller.register(item("root", 0));
    controller.register(item("orphan", 1, { parentId: "ghost" }));

    expect(controller.setCurrent("orphan")).toBe(true);
    expect(controller.currentScopeParentId()).toBe("ghost");

    const parent = controller.focusParent();

    expect(parent?.id).toBe("root");
    expect(controller.currentScopeParentId()).toBeNull();
    expect(controller.current()?.id).toBe("root");
  });
});

describe("FocusController.setItems — DOM-order batch population", () => {
  it("traverses in the given array (DOM) order regardless of `order`", () => {
    const controller = new FocusController();
    // `order` values are deliberately reversed; DOM order (array position) wins.
    controller.setItems([item("first", 99), item("second", 5), item("third", 1)]);
    expect(controller.list().map((entry) => entry.id)).toEqual(["first", "second", "third"]);
    expect(controller.current()?.id).toBe("first");
    expect(controller.focusNext()?.id).toBe("second");
    expect(controller.focusNext()?.id).toBe("third");
  });

  it("preserves `current` across a re-scan when its id is still present", () => {
    const controller = new FocusController();
    controller.setItems([item("a", 0), item("b", 0), item("c", 0)]);
    expect(controller.focusNext()?.id).toBe("b");
    // A DOM mutation re-scans: b survives, so selection stays on b.
    controller.setItems([item("a", 0), item("b", 0), item("c", 0), item("d", 0)]);
    expect(controller.current()?.id).toBe("b");
  });

  it("re-derives `current` to the first enabled item when the prior selection vanished", () => {
    const controller = new FocusController();
    controller.setItems([item("a", 0), item("b", 0)]);
    expect(controller.focusNext()?.id).toBe("b");
    controller.setItems([item("a", 0), item("c", 0)]); // b gone
    expect(controller.current()?.id).toBe("a");
  });

  it("keeps a nested scope when the parent survives, and exits it when it vanishes", () => {
    const controller = new FocusController();
    controller.setItems([item("card", 0), item("child", 0, { parentId: "card" })]);
    controller.focusFirstChild();
    expect(controller.currentScopeParentId()).toBe("card");
    // card persists across the re-scan → still inside it.
    controller.setItems([item("card", 0), item("child", 0, { parentId: "card" })]);
    expect(controller.currentScopeParentId()).toBe("card");
    // card removed → scope resets to root.
    controller.setItems([item("other", 0)]);
    expect(controller.currentScopeParentId()).toBeNull();
    expect(controller.current()?.id).toBe("other");
  });

  it("exposes enabled children and group-ness for the OK descend/activate decision", () => {
    const controller = new FocusController();
    controller.setItems([
      item("group", 0),
      item("g-leaf-1", 0, { parentId: "group" }),
      item("g-leaf-2", 0, { parentId: "group", disabled: true }),
      item("leaf", 0),
    ]);
    expect(controller.hasEnabledChildren("group")).toBe(true);
    expect(controller.enabledChildrenOf("group").map((entry) => entry.id)).toEqual(["g-leaf-1"]);
    expect(controller.hasEnabledChildren("leaf")).toBe(false);
    expect(controller.enabledChildrenOf("leaf")).toEqual([]);
  });
});
