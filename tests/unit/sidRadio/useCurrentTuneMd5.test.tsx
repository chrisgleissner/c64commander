/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCurrentTuneMd5 } from "@/pages/playFiles/hooks/useCurrentTuneMd5";
import type { PlaylistItem } from "@/pages/playFiles/types";

const sidItem = (): PlaylistItem => {
  const bytes = new Uint8Array([0x50, 0x53, 0x49, 0x44, 1, 2, 3, 4, 5, 6, 7, 8]);
  return {
    id: "s1",
    category: "sid",
    label: "Tune.sid",
    path: "/x/Tune.sid",
    request: {
      source: "hvsc",
      path: "/x/Tune.sid",
      file: { name: "Tune.sid", arrayBuffer: async () => bytes.buffer.slice(0) },
    },
  } as PlaylistItem;
};

describe("useCurrentTuneMd5", () => {
  it("computes the current SID's full MD5 when enabled", async () => {
    const item = sidItem();
    const { result } = renderHook(() => useCurrentTuneMd5(item, true));
    await waitFor(() => expect(result.current).toMatch(/^[0-9a-f]{32}$/));
  });

  it("returns null when disabled", () => {
    const item = sidItem();
    const { result } = renderHook(() => useCurrentTuneMd5(item, false));
    expect(result.current).toBeNull();
  });

  it("returns null for a non-SID item", () => {
    const prg = { ...sidItem(), category: "prg" } as PlaylistItem;
    const { result } = renderHook(() => useCurrentTuneMd5(prg, true));
    expect(result.current).toBeNull();
  });

  it("returns null when the item has no local bytes", () => {
    const noFile = { ...sidItem(), request: { source: "ultimate", path: "/x/Tune.sid" } } as PlaylistItem;
    const { result } = renderHook(() => useCurrentTuneMd5(noFile, true));
    expect(result.current).toBeNull();
  });
});
