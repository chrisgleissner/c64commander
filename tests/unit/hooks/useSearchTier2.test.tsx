/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hvscRef = vi.hoisted(() => ({
  current: { hits: [] as { virtualPath: string; title: string; author?: string; folder: string }[] },
}));
vi.mock("@/pages/playFiles/hooks/useHvscArchiveSearch", () => ({
  useHvscArchiveSearch: () => ({
    ...hvscRef.current,
    setQuery: vi.fn(),
    isSearching: false,
    indexUnavailable: false,
  }),
}));

const diskRef = vi.hoisted(() => ({ current: { disks: [] as { id: string; name: string; path: string }[] } }));
vi.mock("@/lib/disks/diskStore", () => ({
  SHARED_DISK_LIBRARY_ID: "shared",
  loadDiskLibrary: () => diskRef.current,
}));

vi.mock("@/hooks/useC64Connection", () => ({ useConnectionRoutingEpoch: () => 1 }));

import { useSearchTier2 } from "@/hooks/useSearchTier2";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const renderTier2 = (query: string) => renderHook(() => useSearchTier2(query, true), { wrapper });

describe("useSearchTier2", () => {
  beforeEach(() => {
    hvscRef.current = { hits: [] };
    diskRef.current = { disks: [] };
  });

  /*
   * A music result names one tune out of tens of thousands. It used to target a bare /play, so
   * activating it opened the page and lost which tune had been asked for.
   */
  it("carries the tune's own title into the target it navigates to", async () => {
    hvscRef.current = {
      hits: [{ virtualPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", title: "Commando", folder: "Hubbard_Rob" }],
    };
    const { result } = renderTier2("commando");
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.entries[0].target).toEqual({
      kind: "route",
      path: "/play?find=1&q=Commando",
    });
  });

  it("escapes a title that would otherwise change the parameters it is carried in", async () => {
    hvscRef.current = { hits: [{ virtualPath: "/a.sid", title: "Rock & Roll?x=1", folder: "x" }] };
    const { result } = renderTier2("rock");
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    const path = (result.current.entries[0].target as { path: string }).path;
    expect(new URLSearchParams(path.split("?")[1]).get("q")).toBe("Rock & Roll?x=1");
  });

  it("matches disks on their name and says where each one is", async () => {
    diskRef.current = {
      disks: [
        { id: "d1", name: "Turrican II", path: "/Usb0/games/turrican2.d64" },
        { id: "d2", name: "Elite", path: "/Usb0/games/elite.d64" },
      ],
    };
    const { result } = renderTier2("turrican");
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    expect(result.current.entries[0].titleDefault).toBe("Turrican II");
    expect(result.current.entries[0].subtitleDefault).toBe("/Usb0/games/turrican2.d64");
  });

  // Spec section 5.9: one source must not be able to flood the list.
  it("caps the local sources at a hundred rows", async () => {
    diskRef.current = {
      disks: Array.from({ length: 250 }, (_, index) => ({
        id: `d${index}`,
        name: `Disk ${index}`,
        path: `/Usb0/disk${index}.d64`,
      })),
    };
    const { result } = renderTier2("disk");
    await waitFor(() => expect(result.current.entries.length).toBe(100));
  });

  it("holds the local sources back until the typing settles", () => {
    diskRef.current = { disks: [{ id: "d1", name: "Elite", path: "/Usb0/elite.d64" }] };
    const { result } = renderTier2("elite");
    // Synchronously after the first render, the debounce has not elapsed.
    expect(result.current.entries).toEqual([]);
  });
});
