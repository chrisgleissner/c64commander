/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionState, listEntries } = vi.hoisted(() => ({
  connectionState: { current: "REAL_CONNECTED" },
  listEntries: vi.fn(),
}));

vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: connectionState.current }) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/connection/connectionManager", () => ({ isSimulatedDeviceTarget: () => false }));
vi.mock("@/lib/connection/networkStatusWatch", () => ({ isNetworkKnownOffline: () => false }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  createUltimateSourceLocation: () => ({ id: "ultimate", type: "ultimate", listEntries }),
  normalizeFtpHost: (host: string) => host,
}));
vi.mock("@/lib/c64api", () => ({ getC64APIConfigSnapshot: () => ({ deviceHost: "u64", password: "" }) }));
vi.mock("@/lib/ftp/ftpClient", () => ({ readFtpFile: vi.fn() }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));

import { useSonglengthsRetry } from "@/pages/playFiles/hooks/useSonglengthsRetry";
import {
  clearSkippedSonglengthsFolders,
  getSkippedSonglengthsFolders,
  recordSkippedSonglengthsFolders,
} from "@/pages/playFiles/songlengthsRetryStore";

const songlengths = { type: "file", name: "Songlengths.md5", path: "/DOCUMENTS/Songlengths.md5", sizeBytes: 1024 };

describe("useSonglengthsRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSkippedSonglengthsFolders();
    connectionState.current = "REAL_CONNECTED";
    listEntries.mockReset();
  });

  it("registers the songlengths file of a skipped folder once the device answers, and forgets that folder", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/", "/Games/"]);
    listEntries.mockImplementation(async (folder: string) => (folder === "/DOCUMENTS/" ? [songlengths] : []));
    const merge = vi.fn();

    renderHook(() => useSonglengthsRetry({ deviceId: "device-1", playlistLength: 3, mergeSonglengthsFiles: merge }));

    await waitFor(() => expect(getSkippedSonglengthsFolders("device-1")).toEqual([]));
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge.mock.calls[0][0][0]).toMatchObject({ path: "/DOCUMENTS/Songlengths.md5" });
  });

  it("keeps the folders it did not reach when the device stops answering", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/", "/Games/"]);
    listEntries.mockRejectedValue(new Error("FTP list failed: Timeout (control socket)"));
    const merge = vi.fn();

    renderHook(() => useSonglengthsRetry({ deviceId: "device-1", playlistLength: 3, mergeSonglengthsFiles: merge }));

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));
    expect(getSkippedSonglengthsFolders("device-1")).toEqual(["/DOCUMENTS/", "/Games/"]);
    expect(merge).not.toHaveBeenCalled();
  });

  it("does not ask the device while it is not connected", async () => {
    connectionState.current = "OFFLINE_NO_DEMO";
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    renderHook(() => useSonglengthsRetry({ deviceId: "device-1", playlistLength: 3, mergeSonglengthsFiles: vi.fn() }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listEntries).not.toHaveBeenCalled();
  });

  it("forgets the folders when the playlist is cleared", () => {
    connectionState.current = "OFFLINE_NO_DEMO";
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    renderHook(() => useSonglengthsRetry({ deviceId: "device-1", playlistLength: 0, mergeSonglengthsFiles: vi.fn() }));

    expect(getSkippedSonglengthsFolders("device-1")).toEqual([]);
  });

  it("only asks for the folders of the selected device", async () => {
    recordSkippedSonglengthsFolders("device-2", ["/Other/"]);
    listEntries.mockResolvedValue([]);

    renderHook(() => useSonglengthsRetry({ deviceId: "device-1", playlistLength: 3, mergeSonglengthsFiles: vi.fn() }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listEntries).not.toHaveBeenCalled();
    expect(getSkippedSonglengthsFolders("device-2")).toEqual(["/Other/"]);
  });
});
