/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { DefaultStopFollower, FOLLOW_DEFAULT_STOP_MS } from "@/lib/input/defaultStopFollower";
import { FocusController } from "@/lib/input/focusController";

const setup = () => {
  const focus = new FocusController();
  focus.setItems([
    { id: "first", order: 0, activate: vi.fn() },
    { id: "second", order: 1, activate: vi.fn() },
  ]);
  const elements = new Map([
    ["first", document.createElement("button")],
    ["second", document.createElement("button")],
  ]);
  const reveal = vi.fn();
  const elementForId = (id: string) => elements.get(id) ?? null;
  return { focus, elements, reveal, elementForId };
};

describe("DefaultStopFollower", () => {
  it("reveals the default stop after each scan while armed", () => {
    const { focus, elements, reveal, elementForId } = setup();
    const follower = new DefaultStopFollower();
    follower.arm(1000);

    follower.afterScan(focus, elementForId, reveal, 1100);
    follower.afterScan(focus, elementForId, reveal, 1200);

    expect(reveal).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveBeenLastCalledWith(elements.get("first"));
  });

  it("does nothing before a tab jump arms it", () => {
    const { focus, reveal, elementForId } = setup();
    new DefaultStopFollower().afterScan(focus, elementForId, reveal, 0);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("stops once the user moves off the default stop, also if the ring later returns to a default", () => {
    const { focus, reveal, elementForId } = setup();
    const follower = new DefaultStopFollower();
    follower.arm(0);

    focus.focusNext();
    follower.afterScan(focus, elementForId, reveal, 10);
    focus.resetToDefault();
    follower.afterScan(focus, elementForId, reveal, 20);

    expect(reveal).not.toHaveBeenCalled();
  });

  it("stops when the page has had its time to settle", () => {
    const { focus, reveal, elementForId } = setup();
    const follower = new DefaultStopFollower();
    follower.arm(0);
    follower.afterScan(focus, elementForId, reveal, FOLLOW_DEFAULT_STOP_MS + 1);
    expect(reveal).not.toHaveBeenCalled();
  });
});
