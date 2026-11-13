/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

const stubBlockedIndexedDb = () =>
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { onblocked?: () => void } = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  });

const settles = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      (value) => ({ resolved: value }),
      (error: Error) => ({ rejected: error.message }),
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 300)),
  ]);

describe("IndexedDB users when another connection blocks the open", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    stubBlockedIndexedDb();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the playlist repository rejects instead of waiting for the open", async () => {
    const { getIndexedDbPlaylistDataRepository } = await import("@/lib/playlistRepository/indexedDbRepository");
    const repository = getIndexedDbPlaylistDataRepository({ preferDurableStorage: false });

    expect(await settles(repository.queryPlaylist({ playlistId: "playlist-default", limit: 10, offset: 0 }))).toEqual({
      rejected: expect.stringContaining("blocked by another open connection"),
    });
  });

  it("the ranking store falls back to localStorage instead of waiting for the open", async () => {
    const store = await import("@/lib/sidRadio/rankingStore");

    expect(await settles(store.loadRankings())).toEqual({ resolved: undefined });
  });

  it("the saved-device dependency scan rejects instead of waiting for the open", async () => {
    const { getSavedDeviceDependencySummary } = await import("@/lib/savedDevices/deviceDependencies");

    expect(await settles(getSavedDeviceDependencySummary("device-1"))).toEqual({
      rejected: expect.stringContaining("blocked by another open connection"),
    });
  });
});

describe("the saved-device dependency scan when its read transaction aborts", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("settles with a logged error instead of waiting for a cursor event that never comes", async () => {
    const transaction: { error: Error | null; onabort?: () => void } = { error: null };
    const database = {
      close: vi.fn(),
      transaction: () => {
        queueMicrotask(() => transaction.onabort?.());
        return {
          ...transaction,
          objectStore: () => ({ openCursor: () => ({}) }),
          set onabort(handler: () => void) {
            transaction.onabort = handler;
          },
        };
      },
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request: { result?: unknown; onsuccess?: () => void } = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    const { addErrorLog } = await import("@/lib/logging");
    const { getSavedDeviceDependencySummary } = await import("@/lib/savedDevices/deviceDependencies");

    expect(await settles(getSavedDeviceDependencySummary("device-1"))).toEqual({
      resolved: { diskCount: 0, playlistItemCount: 0, totalCount: 0 },
    });
    expect(addErrorLog).toHaveBeenCalledWith(
      "Saved device dependency scan failed",
      expect.objectContaining({ error: "IndexedDB dependency scan transaction aborted" }),
    );
    expect(database.close).toHaveBeenCalled();
  });
});
