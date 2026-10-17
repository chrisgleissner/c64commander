/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { setInputModality } from "@/lib/input/inputModality";
import { restoreRingFocus, type RingFocusSource } from "@/lib/input/restoreRingFocus";

const ringStandingOn = (element: HTMLElement | null, id = "stop"): RingFocusSource => ({
  controller: { focus: { current: () => (element ? { id } : null) } },
  engine: { flushPendingRefresh: vi.fn(), elementForId: (requested) => (requested === id ? element : null) },
});

const mountButton = (): HTMLButtonElement => {
  const button = document.createElement("button");
  document.body.appendChild(button);
  return button;
};

afterEach(() => {
  document.body.innerHTML = "";
  setInputModality("pointer");
});

describe("restoreRingFocus", () => {
  it("focuses the ring's current stop when focus has dropped to the body", () => {
    setInputModality("key-navigation");
    const stop = mountButton();
    const ring = ringStandingOn(stop);

    expect(restoreRingFocus(ring)).toBe(true);

    expect(document.activeElement).toBe(stop);
    expect(ring.engine.flushPendingRefresh).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone when something already holds it", () => {
    setInputModality("key-navigation");
    const stop = mountButton();
    const other = mountButton();
    other.focus();

    expect(restoreRingFocus(ringStandingOn(stop))).toBe(false);

    expect(document.activeElement).toBe(other);
  });

  it("does nothing while the user is on the pointer, which shows no highlight", () => {
    setInputModality("pointer");
    const stop = mountButton();

    expect(restoreRingFocus(ringStandingOn(stop))).toBe(false);

    expect(document.activeElement).toBe(document.body);
  });

  it("does nothing when the ring has no current stop or its element is gone", () => {
    setInputModality("key-navigation");
    const detached = document.createElement("button");

    expect(restoreRingFocus(ringStandingOn(null))).toBe(false);
    expect(restoreRingFocus(ringStandingOn(detached))).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
