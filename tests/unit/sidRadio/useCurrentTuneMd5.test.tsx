/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCurrentTuneMd5 } from "@/pages/playFiles/hooks/useCurrentTuneMd5";
import type { PlaylistItem } from "@/pages/playFiles/types";
import type { SongLengthResolution } from "@/lib/songlengths/songlengthTypes";

const resolveHvscSonglengthDuration =
  vi.fn<(query: { virtualPath?: string | null }) => Promise<SongLengthResolution>>();

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
  resolveHvscSonglengthDuration: (query: { virtualPath?: string | null }) => resolveHvscSonglengthDuration(query),
}));

const BYTES = new Uint8Array([0x50, 0x53, 0x49, 0x44, 1, 2, 3, 4, 5, 6, 7, 8]);
const BYTES_MD5 = "45ebe97718ddb90cebe78645429f7385";
const LISTED_MD5 = "9a19494df43000000000000000000000";

const sidItem = (): PlaylistItem =>
  ({
    id: "s1",
    category: "sid",
    label: "Tune.sid",
    path: "/x/Tune.sid",
    request: {
      source: "hvsc",
      path: "/x/Tune.sid",
      file: { name: "Tune.sid", arrayBuffer: async () => BYTES.buffer.slice(0) },
    },
  }) as PlaylistItem;

const listed = (matchedPath: string, matchedMd5: string): SongLengthResolution => ({
  durationSeconds: 60,
  strategy: "full-path",
  matchedPath,
  matchedMd5,
});

describe("useCurrentTuneMd5", () => {
  beforeEach(() => {
    resolveHvscSonglengthDuration.mockReset();
    resolveHvscSonglengthDuration.mockResolvedValue({ durationSeconds: null, strategy: "not-found" });
  });

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

  it("uses the MD5 an HVSC release lists for the tune's path rather than the hash of its bytes", async () => {
    resolveHvscSonglengthDuration.mockResolvedValue(listed("/x/Tune.sid", LISTED_MD5));
    const item = sidItem();
    const { result } = renderHook(() => useCurrentTuneMd5(item, true));
    await waitFor(() => expect(result.current).toBe(LISTED_MD5));
    expect(resolveHvscSonglengthDuration).toHaveBeenCalledWith({ virtualPath: "/x/Tune.sid" });
  });

  it("resolves an HVSC tune from its listed MD5 before playback has attached its bytes", async () => {
    resolveHvscSonglengthDuration.mockResolvedValue(listed("/x/Tune.sid", LISTED_MD5));
    const noBytesYet = { ...sidItem(), request: { source: "hvsc", path: "/x/Tune.sid" } } as PlaylistItem;
    const { result } = renderHook(() => useCurrentTuneMd5(noBytesYet, true));
    await waitFor(() => expect(result.current).toBe(LISTED_MD5));
  });

  it("hashes the bytes when the listed entry matched a different path by file name", async () => {
    resolveHvscSonglengthDuration.mockResolvedValue({
      ...listed("/y/Tune.sid", LISTED_MD5),
      strategy: "filename-unique",
    });
    const item = sidItem();
    const { result } = renderHook(() => useCurrentTuneMd5(item, true));
    await waitFor(() => expect(result.current).toBe(BYTES_MD5));
  });

  it("hashes the bytes when the songlengths lookup fails", async () => {
    resolveHvscSonglengthDuration.mockRejectedValue(new Error("songlengths unreadable"));
    const item = sidItem();
    const { result } = renderHook(() => useCurrentTuneMd5(item, true));
    await waitFor(() => expect(result.current).toBe(BYTES_MD5));
  });
});
