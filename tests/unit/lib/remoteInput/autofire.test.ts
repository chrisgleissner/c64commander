/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { autofireCycle, DEFAULT_AUTOFIRE_RATE_HZ } from "@/lib/remoteInput/autofire";

describe("autofireCycle", () => {
  it("leaves the held set untouched when autofire is disabled", () => {
    const heldSet = new Set<"fire">(["fire"]);
    const result = autofireCycle(heldSet, { enabled: false, rateHz: 10, startedAtMs: 0 }, 50);
    expect(result).toBe(heldSet);
  });

  it("leaves the held set untouched when fire is not held (autofire never presses fire on its own)", () => {
    const heldSet = new Set<"up">(["up"]);
    const result = autofireCycle(heldSet, { enabled: true, rateHz: 10, startedAtMs: 0 }, 50);
    expect(result).toBe(heldSet);
  });

  it("keeps fire pressed during the first half of each cycle", () => {
    // 10 Hz -> 100ms period -> first half is [0, 50)ms.
    const heldSet = new Set<"fire" | "up">(["fire", "up"]);
    const result = autofireCycle(heldSet, { enabled: true, rateHz: 10, startedAtMs: 0 }, 25);
    expect(result.has("fire")).toBe(true);
    expect(result.has("up")).toBe(true);
  });

  it("releases fire during the second half of each cycle", () => {
    const heldSet = new Set<"fire" | "up">(["fire", "up"]);
    const result = autofireCycle(heldSet, { enabled: true, rateHz: 10, startedAtMs: 0 }, 75);
    expect(result.has("fire")).toBe(false);
    expect(result.has("up")).toBe(true);
  });

  it("cycles on/off across period boundaries, not just once", () => {
    const heldSet = new Set<"fire">(["fire"]);
    const config = { enabled: true, rateHz: DEFAULT_AUTOFIRE_RATE_HZ, startedAtMs: 1000 };
    const periodMs = 1000 / DEFAULT_AUTOFIRE_RATE_HZ;

    expect(autofireCycle(heldSet, config, 1000 + periodMs * 2 + 1).has("fire")).toBe(true);
    expect(autofireCycle(heldSet, config, 1000 + periodMs * 2 + periodMs / 2 + 1).has("fire")).toBe(false);
  });

  it("does not mutate the input set", () => {
    const heldSet = new Set<"fire">(["fire"]);
    autofireCycle(heldSet, { enabled: true, rateHz: 10, startedAtMs: 0 }, 75);
    expect(heldSet.has("fire")).toBe(true);
  });
});
