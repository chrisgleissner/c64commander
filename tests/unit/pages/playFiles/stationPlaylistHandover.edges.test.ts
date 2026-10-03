/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

import {
  clearHandoverRecord,
  forgetSavedCopyRead,
  handoverForStationStart,
  readHandoverRecord,
  readSavedCopyOnce,
  readSavedPlaylistWithRetry,
  resetStationHandoverSession,
  restoredPlaylistState,
  SAVED_PLAYLIST_READ,
  writeHandoverRecord,
  type StationHandover,
} from "@/pages/playFiles/stationPlaylistHandover";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string) => ({ id, path: `/${id}.sid` }) as unknown as PlaylistItem;
const RECORD_KEY = "c64u_sid_radio_saved_playlist";

const handover = (overrides: Partial<StationHandover> = {}): StationHandover & { items: PlaylistItem[] } =>
  ({
    items: [item("a"), item("b")],
    currentItemId: null,
    currentIndex: 0,
    selectedIds: [],
    stationItemIds: [],
    phase: "finishing",
    ...overrides,
  }) as StationHandover & { items: PlaylistItem[] };

beforeEach(() => {
  localStorage.clear();
  resetStationHandoverSession();
  logs.addLog.mockReset();
  logs.addErrorLog.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("station playlist handover edge cases", () => {
  it("saves no current tune when the cursor is past the end of the playlist", () => {
    const saved = handoverForStationStart(null, { playlist: [item("a")], currentIndex: 5, selectedIds: new Set() }, [
      item("radio:1"),
    ]);

    expect(saved.currentItemId).toBeNull();
    expect(saved.currentIndex).toBe(5);
  });

  it("falls back to the saved index when the saved tune id is gone, and to no cursor when that is out of range", () => {
    expect(restoredPlaylistState(handover({ currentItemId: "gone", currentIndex: 1 })).currentIndex).toBe(1);
    expect(restoredPlaylistState(handover({ currentItemId: null, currentIndex: 7 })).currentIndex).toBe(-1);
  });

  it("retries a failed read of the saved playlist and returns the items once a read succeeds", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<() => Promise<PlaylistItem[]>>()
      .mockRejectedValueOnce(new Error("IndexedDB busy"))
      .mockResolvedValueOnce([item("a")]);

    const result = readSavedPlaylistWithRetry(read);
    await vi.advanceTimersByTimeAsync(SAVED_PLAYLIST_READ.retryDelayMs);

    await expect(result).resolves.toEqual([item("a")]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "SID Radio: could not read back the playlist saved before the station, retrying",
      { attempt: 1, error: "IndexedDB busy" },
    );
  });

  it("gives up reading the saved playlist after the last attempt and rejects with the last failure", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<PlaylistItem[]>>().mockRejectedValue(new Error("unreadable"));

    const result = readSavedPlaylistWithRetry(read).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SAVED_PLAYLIST_READ.retryDelayMs * 3);

    expect(((await result) as Error).message).toBe("unreadable");
    expect(read).toHaveBeenCalledTimes(SAVED_PLAYLIST_READ.attempts);
  });

  it("logs when the handover record cannot be written or cleared", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    writeHandoverRecord(handover());
    clearHandoverRecord();

    expect(logs.addErrorLog).toHaveBeenCalledWith("Failed to persist the playlist saved before SID Radio", {
      error: "quota exceeded",
    });
    expect(logs.addErrorLog).toHaveBeenCalledWith("Failed to clear the playlist saved before SID Radio", {
      error: "storage disabled",
    });
  });

  it("ignores a stored record of the wrong shape and logs one that is not JSON", () => {
    localStorage.setItem(RECORD_KEY, JSON.stringify({ phase: "playing", selectedIds: [], stationItemIds: [] }));
    expect(readHandoverRecord()).toBeNull();
    expect(logs.addErrorLog).not.toHaveBeenCalled();

    localStorage.setItem(RECORD_KEY, "{not json");
    expect(readHandoverRecord()).toBeNull();
    expect(logs.addErrorLog).toHaveBeenCalledWith(
      "Failed to read the playlist saved before SID Radio",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("does not let a forgotten read clear the read that replaced it when it settles", async () => {
    let finishOld: (items: PlaylistItem[]) => void = () => undefined;
    const oldRead = readSavedCopyOnce(() => new Promise<PlaylistItem[]>((resolve) => (finishOld = resolve)));
    forgetSavedCopyRead();
    let finishNew: (items: PlaylistItem[]) => void = () => undefined;
    const newRead = readSavedCopyOnce(() => new Promise<PlaylistItem[]>((resolve) => (finishNew = resolve)));

    finishOld([item("old")]);
    await oldRead;
    const joined = readSavedCopyOnce(() => Promise.resolve([item("third")]));
    finishNew([item("new")]);

    expect(joined).toBe(newRead);
    await expect(joined).resolves.toEqual([item("new")]);
  });

  it("logs a non-Error read failure by its text before retrying", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<PlaylistItem[]>>().mockRejectedValueOnce("worker gone").mockResolvedValueOnce([]);

    const result = readSavedPlaylistWithRetry(read);
    await vi.advanceTimersByTimeAsync(SAVED_PLAYLIST_READ.retryDelayMs);

    await expect(result).resolves.toEqual([]);
    expect(logs.addLog).toHaveBeenCalledWith("warn", expect.any(String), { attempt: 1, error: "worker gone" });
  });
});
