/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolvePendingSkipIndices, type PendingUserSkip } from "@/pages/playFiles/pendingUserSkip";
import type { PlaylistItem } from "@/pages/playFiles/types";
const playlist = ["current", "next"].map((id) => ({ id }) as PlaylistItem);
const pending = { originIndex: 2, targetIndex: 3, resolvers: [] } as unknown as PendingUserSkip;
describe("pending skip identity", () => {
  it("rebases both indices after history eviction and detects a removed target", () => {
    expect(resolvePendingSkipIndices(playlist, { ...pending, originItemId: "current", targetItemId: "next" })).toEqual({
      originIndex: 0,
      targetIndex: 1,
    });
    expect(
      resolvePendingSkipIndices(playlist, { ...pending, originItemId: "evicted", targetItemId: "removed" }),
    ).toEqual({ originIndex: -1, targetIndex: -1 });
  });
  it("keeps explicit end-of-playlist and index-only requests when no IDs were captured", () => {
    expect(resolvePendingSkipIndices(playlist, pending)).toEqual({ originIndex: 2, targetIndex: 3 });
    expect(resolvePendingSkipIndices(playlist, { ...pending, targetIndex: null })).toEqual({
      originIndex: 2,
      targetIndex: null,
    });
  });
});
