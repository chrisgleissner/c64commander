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
});
