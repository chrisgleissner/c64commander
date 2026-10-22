/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { nextVolumeKey } from "../../../tools/hil/merge_gate.mjs";

const VOLUME_UP = 24;
const VOLUME_DOWN = 25;

describe("merge gate volume stepping", () => {
  it("accepts a muted phone that is already at media index 0 when the target is 0", () => {
    expect(nextVolumeKey({ muted: true, index: 0 }, 0)).toBeNull();
  });

  it("never presses volume up toward a target of 0", () => {
    expect(nextVolumeKey({ muted: true, index: 3 }, 0)).toBe(VOLUME_DOWN);
    expect(nextVolumeKey({ muted: false, index: 3 }, 0)).toBe(VOLUME_DOWN);
  });

  it("does not accept a muted phone for a non-zero target", () => {
    expect(nextVolumeKey({ muted: true, index: 5 }, 5)).toBe(VOLUME_UP);
  });

  it("steps toward the target from either side and stops on it", () => {
    expect(nextVolumeKey({ muted: false, index: 2 }, 5)).toBe(VOLUME_UP);
    expect(nextVolumeKey({ muted: false, index: 8 }, 5)).toBe(VOLUME_DOWN);
    expect(nextVolumeKey({ muted: false, index: 5 }, 5)).toBeNull();
  });
});
