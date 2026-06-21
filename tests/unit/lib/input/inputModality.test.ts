/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInputModality,
  resetInputModality,
  setInputModality,
  subscribeInputModality,
} from "@/lib/input/inputModality";

describe("inputModality", () => {
  afterEach(() => resetInputModality());

  it("defaults to pointer", () => {
    expect(getInputModality()).toBe("pointer");
  });

  it("notifies subscribers only on a real change (value-equality bail)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInputModality(listener);

    // No-op: already pointer.
    setInputModality("pointer");
    expect(listener).not.toHaveBeenCalled();

    setInputModality("key-navigation");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith("key-navigation");
    expect(getInputModality()).toBe("key-navigation");

    // Repeated same value must not re-notify (prevents highlight re-apply storms).
    setInputModality("key-navigation");
    expect(listener).toHaveBeenCalledTimes(1);

    setInputModality("pointer");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setInputModality("key-navigation");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reset returns to pointer without clearing subscribers", () => {
    const listener = vi.fn();
    subscribeInputModality(listener);
    setInputModality("key-navigation");
    expect(listener).toHaveBeenCalledTimes(1);

    resetInputModality();
    expect(getInputModality()).toBe("pointer");

    // Subscriber survives reset (a mounted provider keeps working).
    setInputModality("key-navigation");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
