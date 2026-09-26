/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const drivesQuery = vi.hoisted(() => ({ data: undefined as unknown, dataUpdatedAt: 0 }));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Drives: () => ({ data: drivesQuery.data, dataUpdatedAt: drivesQuery.dataUpdatedAt, refetch: vi.fn() }),
  useC64ConfigItems: () => ({ data: undefined }),
}));

vi.mock("@/lib/c64api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/c64api")>()),
  getC64API: () => ({ getDeviceHost: () => "c64u" }),
}));

import { useDriveData } from "@/pages/home/hooks/useDriveData";
import { noteDiskMountOutcome, resetUploadMountsForTests } from "@/lib/disks/uploadMountRegistry";

describe("useDriveData drivesLoading", () => {
  beforeEach(() => {
    drivesQuery.data = undefined;
  });

  it("is loading while connected and the first drives response has not arrived", () => {
    expect(renderHook(() => useDriveData(true)).result.current.drivesLoading).toBe(true);
  });

  it("stops loading once the drives response has arrived, even when it lists no drives", () => {
    drivesQuery.data = { drives: [], errors: [] };
    expect(renderHook(() => useDriveData(true)).result.current.drivesLoading).toBe(false);
  });

  it("is not loading while disconnected, since nothing is on its way", () => {
    expect(renderHook(() => useDriveData(false)).result.current.drivesLoading).toBe(false);
  });
});

describe("useDriveData mounted label", () => {
  beforeEach(() => {
    resetUploadMountsForTests();
  });

  it("names a disk mounted by upload instead of showing the device's temporary upload file", () => {
    noteDiskMountOutcome("c64u", "b", "frogger", "transient", "Frogger.d64", 1000);
    drivesQuery.data = {
      drives: [
        { b: { enabled: true, bus_id: 9, type: "1541", image_file: "/Temp/cache/upload/temp0082", image_path: "" } },
      ],
      errors: [],
    };
    drivesQuery.dataUpdatedAt = 2000;

    const summary = renderHook(() => useDriveData(true)).result.current.driveSummaryItems.find(
      (item) => item.key === "b",
    );

    expect(summary?.mountedLabel).toBe("Frogger.d64");
  });

  it("keeps the reported path when the drive holds an image the app did not upload", () => {
    drivesQuery.data = {
      drives: [
        { a: { enabled: true, bus_id: 8, type: "1541", image_file: "/USB2/Games/Katakis.d81", image_path: "" } },
      ],
      errors: [],
    };
    drivesQuery.dataUpdatedAt = 2000;

    const summary = renderHook(() => useDriveData(true)).result.current.driveSummaryItems.find(
      (item) => item.key === "a",
    );

    expect(summary?.mountedLabel).toContain("Katakis.d81");
  });
});
