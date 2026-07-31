/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the ♥/✕ surfaces do when the durable store cannot be read.
 *
 * Hydration is best-effort — a rating that cannot be loaded is not a reason to break the player — but
 * it must not fail silently either, or a store that never loads looks exactly like a user who never
 * rated anything.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadRankings = vi.fn();

vi.mock("@/lib/sidRadio/rankingStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sidRadio/rankingStore")>("@/lib/sidRadio/rankingStore");
  return { ...actual, loadRankings };
});

const addErrorLog = vi.fn();
vi.mock("@/lib/logging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logging")>("@/lib/logging");
  return { ...actual, addErrorLog };
});

beforeEach(() => {
  loadRankings.mockReset();
  addErrorLog.mockReset();
  loadRankings.mockRejectedValue(new Error("indexeddb unavailable"));
});

describe("a ratings store that cannot be read", () => {
  it("leaves the now-playing affordance usable and logs why it is unrated", async () => {
    const { useNowPlayingRanking } = await import("@/lib/sidRadio/useNowPlayingRanking");

    const { result } = renderHook(() => useNowPlayingRanking("0123456789abcdef0123456789abcdef"));

    await waitFor(() => expect(addErrorLog).toHaveBeenCalledWith("Failed to hydrate SID rankings", expect.anything()));
    expect(result.current.isLiked).toBe(false);
  });

  it("leaves the liked-tune count at zero and logs why", async () => {
    const { useLikedTuneCount } = await import("@/lib/sidRadio/useLikedTuneCount");

    const { result } = renderHook(() => useLikedTuneCount());

    await waitFor(() =>
      expect(addErrorLog).toHaveBeenCalledWith(
        "Failed to hydrate SID rankings for the liked-tune count",
        expect.anything(),
      ),
    );
    expect(result.current).toBe(0);
  });
});
