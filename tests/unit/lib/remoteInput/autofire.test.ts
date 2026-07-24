/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAutofirePhase,
  AUTOFIRE_VISIBILITY_CHANGE_EVENT,
  DEFAULT_AUTOFIRE_RATE_HZ,
  DEFAULT_SHOW_AUTOFIRE_BUTTON,
  loadShowAutofireButton,
  saveShowAutofireButton,
} from "@/lib/remoteInput/autofire";

describe("applyAutofirePhase", () => {
  it("leaves the held set untouched when autofire is disabled, even during the off phase", () => {
    const heldSet = new Set<"fire">(["fire"]);
    const result = applyAutofirePhase(heldSet, false, false);
    expect(result).toBe(heldSet);
  });

  it("leaves the held set untouched when fire is not held (autofire never presses fire on its own)", () => {
    const heldSet = new Set<"up">(["up"]);
    const result = applyAutofirePhase(heldSet, true, false);
    expect(result).toBe(heldSet);
  });

  it("keeps fire pressed during the on phase", () => {
    const heldSet = new Set<"fire" | "up">(["fire", "up"]);
    const result = applyAutofirePhase(heldSet, true, true);
    expect(result.has("fire")).toBe(true);
    expect(result.has("up")).toBe(true);
    expect(result).toBe(heldSet);
  });

  it("releases fire during the off phase, leaving other held inputs untouched", () => {
    const heldSet = new Set<"fire" | "up">(["fire", "up"]);
    const result = applyAutofirePhase(heldSet, true, false);
    expect(result.has("fire")).toBe(false);
    expect(result.has("up")).toBe(true);
  });

  it("does not mutate the input set", () => {
    const heldSet = new Set<"fire">(["fire"]);
    applyAutofirePhase(heldSet, true, false);
    expect(heldSet.has("fire")).toBe(true);
  });

  it("defaults to 5 fires per second", () => {
    expect(DEFAULT_AUTOFIRE_RATE_HZ).toBe(5);
  });
});

describe("show-autofire-button preference", () => {
  const KEY = "c64u_remote_input_show_autofire";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => localStorage.clear());

  it("defaults to hidden (false) when nothing is stored", () => {
    expect(DEFAULT_SHOW_AUTOFIRE_BUTTON).toBe(false);
    expect(loadShowAutofireButton()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("returns the default for an unset key rather than coercing an empty read to true", () => {
    localStorage.removeItem(KEY);
    expect(loadShowAutofireButton()).toBe(DEFAULT_SHOW_AUTOFIRE_BUTTON);
  });

  it('persists "1" for shown and "0" for hidden, and round-trips through load', () => {
    saveShowAutofireButton(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(loadShowAutofireButton()).toBe(true);

    saveShowAutofireButton(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(loadShowAutofireButton()).toBe(false);
  });

  it('treats any non-"1" stored value as hidden (strict parse)', () => {
    localStorage.setItem(KEY, "yes");
    expect(loadShowAutofireButton()).toBe(false);
    localStorage.setItem(KEY, "0");
    expect(loadShowAutofireButton()).toBe(false);
    localStorage.setItem(KEY, "1");
    expect(loadShowAutofireButton()).toBe(true);
  });

  it("dispatches the visibility-change event on save so a live session can hot-swap", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    saveShowAutofireButton(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: AUTOFIRE_VISIBILITY_CHANGE_EVENT }));
  });
});
