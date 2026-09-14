/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "@/pages/playFiles/types";

const removed = vi.hoisted(() => ({
  hvsc: new Set<() => void>(),
  simulated: new Set<() => void>(),
}));

vi.mock("@/lib/hvsc/hvscDemoLibraryCleanup", () => ({
  subscribeHvscDemoLibraryRemoved: (listener: () => void) => {
    removed.hvsc.add(listener);
    return () => removed.hvsc.delete(listener);
  },
}));

vi.mock("@/lib/connection/simulatedDeviceContent", () => ({
  isSimulatedDeviceOrigin: (origin: { originDeviceLastKnownUniqueId?: string } | null | undefined) =>
    Boolean(origin?.originDeviceLastKnownUniqueId?.startsWith("MOCK-")),
  subscribeSimulatedDeviceContentRemoved: (listener: () => void) => {
    removed.simulated.add(listener);
    return () => removed.simulated.delete(listener);
  },
}));

import { useDemoPlaylistCleanup } from "@/pages/playFiles/hooks/useDemoPlaylistCleanup";

const entry = (id: string, source: string, uniqueId?: string) =>
  ({
    id,
    request: { source, path: `/${id}.sid`, origin: uniqueId ? { originDeviceLastKnownUniqueId: uniqueId } : null },
  }) as unknown as PlaylistItem;

const playlist = [
  entry("hvsc-tune", "hvsc"),
  entry("demo-file", "ultimate", "MOCK-DEMO"),
  entry("real", "ultimate", "5D0464"),
];

describe("useDemoPlaylistCleanup", () => {
  it("drops the Demo Mode HVSC tunes from the open playlist when their library is removed", () => {
    const removePlaylistItemsById = vi.fn();
    renderHook(() => useDemoPlaylistCleanup(playlist, removePlaylistItemsById));

    removed.hvsc.forEach((listener) => listener());

    expect(removePlaylistItemsById).toHaveBeenCalledWith(new Set(["hvsc-tune"]));
  });

  it("drops the simulated device's files from the open playlist, and stops listening when the page closes", () => {
    const removePlaylistItemsById = vi.fn();
    const { unmount } = renderHook(() => useDemoPlaylistCleanup(playlist, removePlaylistItemsById));

    removed.simulated.forEach((listener) => listener());
    unmount();

    expect(removePlaylistItemsById).toHaveBeenCalledWith(new Set(["demo-file"]));
    expect(removed.simulated.size).toBe(0);
    expect(removed.hvsc.size).toBe(0);
  });
});
