/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolvePlaybackSyncDecision } from "@/pages/playFiles/playbackMixerSync";

describe("resolvePlaybackSyncDecision", () => {
  it("defers stale remote state while a newer local intent is still fresh", () => {
    expect(
      resolvePlaybackSyncDecision({ index: 5, muted: false, setAtMs: 1_000 }, { index: 2, muted: false }, 2_000),
    ).toBe("defer");
  });

  it("clears the pending intent when the remote state catches up", () => {
    expect(
      resolvePlaybackSyncDecision({ index: 5, muted: true, setAtMs: 1_000 }, { index: 5, muted: true }, 1_500),
    ).toBe("clear");
  });

  it("releases the defer after the hold window expires", () => {
    expect(
      resolvePlaybackSyncDecision({ index: 5, muted: false, setAtMs: 1_000 }, { index: 2, muted: false }, 4_000),
    ).toBe("clear");
  });
});
