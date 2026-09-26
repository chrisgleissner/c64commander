/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const drivesQuery = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Drives: () => ({ data: drivesQuery.data, refetch: vi.fn() }),
  useC64ConfigItems: () => ({ data: undefined }),
}));

import { useDriveData } from "@/pages/home/hooks/useDriveData";

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
