/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { applyAutofirePhase, DEFAULT_AUTOFIRE_RATE_HZ } from "@/lib/remoteInput/autofire";

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
