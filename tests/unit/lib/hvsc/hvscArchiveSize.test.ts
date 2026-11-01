/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  fetchLatestHvscVersions: vi.fn(),
  fetchContentLength: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/hvsc/hvscReleaseService", () => ({
  fetchLatestHvscVersions: mocks.fetchLatestHvscVersions,
  buildHvscBaselineUrl: (version: number) => `https://hvsc.example/HVSC_${version}-all-of-them.7z`,
}));
vi.mock("@/lib/hvsc/hvscDownload", () => ({ fetchContentLength: mocks.fetchContentLength }));

import {
  HVSC_SIZE_LOOKUP_TIMEOUT_MS,
  fetchHvscBaselineSizeBytes,
  useHvscArchiveSize,
} from "@/lib/hvsc/hvscArchiveSize";

describe("the HVSC archive size", () => {
  beforeEach(() => {
    mocks.fetchLatestHvscVersions.mockReset().mockResolvedValue({ baselineVersion: 85, updateVersion: 85 });
    mocks.fetchContentLength.mockReset().mockResolvedValue(84_827_547);
  });
  afterEach(() => vi.useRealTimers());

  it("SPM-START-02 reads the size of the newest baseline archive from its response", async () => {
    await expect(fetchHvscBaselineSizeBytes()).resolves.toBe(84_827_547);
    expect(mocks.fetchContentLength).toHaveBeenCalledWith("https://hvsc.example/HVSC_85-all-of-them.7z");
  });

  it("SPM-START-02 gives up after the bound when the host does not answer", async () => {
    vi.useFakeTimers();
    mocks.fetchLatestHvscVersions.mockReturnValue(new Promise(() => undefined));
    const reading = fetchHvscBaselineSizeBytes();
    await vi.advanceTimersByTimeAsync(HVSC_SIZE_LOOKUP_TIMEOUT_MS + 10);
    await expect(reading).resolves.toBeNull();
  });

  it("SPM-START-02 a failed lookup is logged and reads as unknown", async () => {
    mocks.fetchLatestHvscVersions.mockRejectedValue(new Error("offline"));
    await expect(fetchHvscBaselineSizeBytes()).resolves.toBeNull();
  });

  it("SPM-START-02 the hook asks the host only once the consent is open", async () => {
    const { result, rerender } = renderHook(({ wanted }) => useHvscArchiveSize(wanted), {
      initialProps: { wanted: false },
    });
    expect(mocks.fetchLatestHvscVersions).not.toHaveBeenCalled();
    expect(result.current).toBeNull();

    rerender({ wanted: true });
    await waitFor(() => expect(result.current).toBe(84_827_547));
  });
});
