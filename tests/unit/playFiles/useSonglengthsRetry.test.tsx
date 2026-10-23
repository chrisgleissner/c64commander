/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionState, listEntries, apiHost } = vi.hoisted(() => ({
  connectionState: { current: "REAL_CONNECTED" },
  listEntries: vi.fn(),
  apiHost: { current: "u64" },
}));

vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: connectionState.current }) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/connection/connectionManager", () => ({ isSimulatedDeviceTarget: () => false }));
vi.mock("@/lib/connection/networkStatusWatch", () => ({ isNetworkKnownOffline: () => false }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  createUltimateSourceLocation: () => ({ id: "ultimate", type: "ultimate", listEntries }),
  normalizeFtpHost: (host: string) => host,
}));
vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: () => ({ deviceHost: apiHost.current, password: "" }),
}));
vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: () => ({
    selectedDeviceId: "device-1",
    devices: [
      { id: "device-1", host: "u64" },
      { id: "device-2", host: "c64u" },
    ],
  }),
}));
vi.mock("@/lib/ftp/ftpClient", () => ({ readFtpFile: vi.fn() }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));

import { useSonglengthsRetry } from "@/pages/playFiles/hooks/useSonglengthsRetry";
import {
  clearSkippedSonglengthsFolders,
  getSkippedSonglengthsFolders,
  recordSkippedSonglengthsFolders,
} from "@/pages/playFiles/songlengthsRetryStore";

const SAVED = ["device-1", "device-2"];
const songlengths = { type: "file", name: "Songlengths.md5", path: "/DOCUMENTS/Songlengths.md5", sizeBytes: 1024 };

describe("useSonglengthsRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSkippedSonglengthsFolders();
    connectionState.current = "REAL_CONNECTED";
    apiHost.current = "u64";
    listEntries.mockReset();
  });

  it("registers the songlengths file of a skipped folder once the device answers, and forgets that folder", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/", "/Games/"]);
    listEntries.mockImplementation(async (folder: string) => (folder === "/DOCUMENTS/" ? [songlengths] : []));
    const merge = vi.fn();

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );

    await waitFor(() => expect(getSkippedSonglengthsFolders("device-1")).toEqual([]));
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge.mock.calls[0][0][0]).toMatchObject({ path: "/DOCUMENTS/Songlengths.md5" });
  });

  it("keeps the folders it did not reach when the device stops answering", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/", "/Games/"]);
    listEntries.mockRejectedValue(new Error("FTP list failed: Timeout (control socket)"));
    const merge = vi.fn();

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));
    expect(getSkippedSonglengthsFolders("device-1")).toEqual(["/DOCUMENTS/", "/Games/"]);
    expect(merge).not.toHaveBeenCalled();
  });

  it("does not ask the device while it is not connected", async () => {
    connectionState.current = "OFFLINE_NO_DEMO";
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: vi.fn(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listEntries).not.toHaveBeenCalled();
  });

  it("forgets the folders when the playlist the user had is emptied, but not when the page opens with no items yet", () => {
    connectionState.current = "OFFLINE_NO_DEMO";
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    const { rerender } = renderHook(
      ({ length }) =>
        useSonglengthsRetry({
          deviceId: "device-1",
          savedDeviceIds: SAVED,
          playlistLength: length,
          mergeSonglengthsFiles: vi.fn(),
        }),
      { initialProps: { length: 0 } },
    );
    expect(getSkippedSonglengthsFolders("device-1")).toEqual(["/DOCUMENTS/"]);

    rerender({ length: 4 });
    expect(getSkippedSonglengthsFolders("device-1")).toEqual(["/DOCUMENTS/"]);
    recordSkippedSonglengthsFolders("device-2", ["/Other/"]);
    rerender({ length: 0 });
    expect(getSkippedSonglengthsFolders("device-1")).toEqual([]);
    expect(getSkippedSonglengthsFolders("device-2")).toEqual([]);
  });

  it("starts for a folder that is stored after the page was already connected", async () => {
    listEntries.mockResolvedValue([songlengths]);
    const merge = vi.fn();
    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listEntries).not.toHaveBeenCalled();

    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
  });

  it("drops a folder the device refuses to list and goes on with the others", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/Gone/", "/DOCUMENTS/"]);
    listEntries.mockImplementation(async (folder: string) => {
      if (folder === "/Gone/") throw new Error("FTP list failed: 550 No such directory");
      return [songlengths];
    });
    const merge = vi.fn();

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );

    await waitFor(() => expect(getSkippedSonglengthsFolders("device-1")).toEqual([]));
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it("tries again after a wait when the device did not answer while the connection stayed up", async () => {
    vi.useFakeTimers();
    try {
      recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);
      listEntries.mockRejectedValueOnce(new Error("FTP list failed: Timeout (control socket)"));
      listEntries.mockResolvedValue([songlengths]);
      const merge = vi.fn();

      renderHook(() =>
        useSonglengthsRetry({
          deviceId: "device-1",
          savedDeviceIds: SAVED,
          playlistLength: 3,
          mergeSonglengthsFiles: merge,
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(listEntries).toHaveBeenCalledTimes(1);
      expect(merge).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(merge).toHaveBeenCalledTimes(1);
      expect(getSkippedSonglengthsFolders("device-1")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask while the API is aimed at another host than the selected device", async () => {
    apiHost.current = "c64u";
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: vi.fn(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listEntries).not.toHaveBeenCalled();
  });

  it("only asks for the folders of the selected device", async () => {
    recordSkippedSonglengthsFolders("device-2", ["/Other/"]);
    listEntries.mockResolvedValue([]);

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: vi.fn(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listEntries).not.toHaveBeenCalled();
    expect(getSkippedSonglengthsFolders("device-2")).toEqual(["/Other/"]);
  });

  it("does not run again after the page is left while it waits for its next try", async () => {
    vi.useFakeTimers();
    try {
      recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);
      listEntries.mockRejectedValue(new Error("FTP list failed: Timeout (control socket)"));

      const { unmount } = renderHook(() =>
        useSonglengthsRetry({
          deviceId: "device-1",
          savedDeviceIds: SAVED,
          playlistLength: 3,
          mergeSonglengthsFiles: vi.fn(),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(listEntries).toHaveBeenCalledTimes(1);
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000);
      });

      expect(listEntries).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doubles the wait between tries while the device does not answer, and stops after six", async () => {
    vi.useFakeTimers();
    try {
      recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);
      listEntries.mockRejectedValue(new Error("FTP list failed: Timeout (control socket)"));
      renderHook(() =>
        useSonglengthsRetry({
          deviceId: "device-1",
          savedDeviceIds: SAVED,
          playlistLength: 3,
          mergeSonglengthsFiles: vi.fn(),
        }),
      );
      const advance = async (ms: number) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      };

      await advance(100);
      expect(listEntries).toHaveBeenCalledTimes(1);
      await advance(14_000);
      expect(listEntries).toHaveBeenCalledTimes(1);
      await advance(2_000);
      expect(listEntries).toHaveBeenCalledTimes(2);
      await advance(28_000);
      expect(listEntries).toHaveBeenCalledTimes(2);
      await advance(2_000);
      expect(listEntries).toHaveBeenCalledTimes(3);
      for (let minutes = 0; minutes < 60; minutes += 5) await advance(300_000);
      expect(listEntries).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the folders of a saved device that has been removed", () => {
    connectionState.current = "OFFLINE_NO_DEMO";
    recordSkippedSonglengthsFolders("device-gone", ["/DOCUMENTS/"]);
    recordSkippedSonglengthsFolders("device-1", ["/Games/"]);

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: vi.fn(),
      }),
    );

    expect(getSkippedSonglengthsFolders("device-gone")).toEqual([]);
    expect(getSkippedSonglengthsFolders("device-1")).toEqual(["/Games/"]);
  });

  it("does not ask a folder below one that was listed without it, and rebuilds that from the real listings", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/", "/USB0/", "/USB0/C64Music/DOCUMENTS/"]);
    listEntries.mockImplementation(async (folder: string) =>
      folder === "/" ? [{ type: "dir", name: "Flash", path: "/Flash" }] : [],
    );
    const merge = vi.fn();

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );

    await waitFor(() => expect(getSkippedSonglengthsFolders("device-1")).toEqual([]));
    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it("lets a found songlengths file replace one whose read failed", async () => {
    recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);
    listEntries.mockResolvedValue([songlengths]);
    const merge = vi.fn();

    renderHook(() =>
      useSonglengthsRetry({
        deviceId: "device-1",
        savedDeviceIds: SAVED,
        playlistLength: 3,
        mergeSonglengthsFiles: merge,
      }),
    );

    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(merge.mock.calls[0][1]).toEqual({ replaceFailed: true });
  });

  it("drops the wait of a run that a newer run replaced", async () => {
    vi.useFakeTimers();
    try {
      recordSkippedSonglengthsFolders("device-1", ["/DOCUMENTS/"]);
      listEntries.mockRejectedValue(new Error("FTP list failed: Timeout (control socket)"));
      renderHook(() =>
        useSonglengthsRetry({
          deviceId: "device-1",
          savedDeviceIds: SAVED,
          playlistLength: 3,
          mergeSonglengthsFiles: vi.fn(),
        }),
      );
      const advance = async (ms: number) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      };
      await advance(100);
      expect(listEntries).toHaveBeenCalledTimes(1);

      await advance(10_000);
      act(() => recordSkippedSonglengthsFolders("device-1", ["/Games/"]));
      await advance(100);
      expect(listEntries).toHaveBeenCalledTimes(2);
      await advance(10_000);

      expect(listEntries).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
