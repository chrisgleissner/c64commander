import { describe, expect, it } from "vitest";
import {
  LEGACY_PLAYLIST_MAX_BYTES,
  LEGACY_PLAYLIST_MAX_ITEMS,
  shouldPersistLegacyPlaylistBlob,
} from "@/pages/playFiles/hooks/playbackPersistenceBudget";

describe("playbackPersistenceBudget", () => {
  it("allows persistence when payload is within item and size budgets", () => {
    const playlist = new Array(LEGACY_PLAYLIST_MAX_ITEMS).fill({});
    expect(
      shouldPersistLegacyPlaylistBlob(
        playlist as any,
        LEGACY_PLAYLIST_MAX_BYTES,
      ),
    ).toBe(true);
  });

  it("blocks persistence when playlist item count exceeds budget", () => {
    const playlist = new Array(LEGACY_PLAYLIST_MAX_ITEMS + 1).fill({});
    expect(shouldPersistLegacyPlaylistBlob(playlist as any, 1024)).toBe(false);
  });

  it("blocks persistence when payload bytes exceed budget", () => {
    const playlist = new Array(10).fill({});
    expect(
      shouldPersistLegacyPlaylistBlob(
        playlist as any,
        LEGACY_PLAYLIST_MAX_BYTES + 1,
      ),
    ).toBe(false);
  });
});
