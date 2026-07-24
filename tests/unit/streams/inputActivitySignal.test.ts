/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetInputActivityForTests,
  lastInputActivityMs,
  notifyInputActivity,
  onInputActivity,
} from "@/lib/streams/inputActivitySignal";

describe("inputActivitySignal", () => {
  beforeEach(() => __resetInputActivityForTests());
  afterEach(() => __resetInputActivityForTests());

  it("delivers each pulse to every subscriber with the event time", () => {
    const a = vi.fn();
    const b = vi.fn();
    onInputActivity(a);
    onInputActivity(b);
    notifyInputActivity(1234);
    expect(a).toHaveBeenCalledWith(1234);
    expect(b).toHaveBeenCalledWith(1234);
    expect(lastInputActivityMs()).toBe(1234);
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onInputActivity(listener);
    notifyInputActivity(1);
    off();
    notifyInputActivity(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("tolerates a listener unsubscribing itself mid-dispatch (iterates a snapshot)", () => {
    const calls: string[] = [];
    let off2: () => void = () => {};
    onInputActivity(() => {
      calls.push("first");
      off2(); // remove the second listener while dispatching
    });
    off2 = onInputActivity(() => calls.push("second"));
    expect(() => notifyInputActivity(5)).not.toThrow();
    // The snapshot taken at dispatch start still includes the second listener for THIS pulse.
    expect(calls).toEqual(["first", "second"]);
    calls.length = 0;
    notifyInputActivity(6); // now the second listener is gone
    expect(calls).toEqual(["first"]);
  });
});
