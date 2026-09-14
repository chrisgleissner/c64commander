/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const snapshot = { state: "DEMO_ACTIVE" as string };
  return {
    snapshot,
    moveTo: (state: string) => {
      snapshot.state = state;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => connection.snapshot,
  subscribeConnection: connection.subscribe,
}));

const deviceState = vi.hoisted(() => ({ connectionState: "DEMO_ACTIVE" as string }));
vi.mock("@/lib/deviceInteraction/deviceStateStore", () => ({
  getDeviceStateSnapshot: () => deviceState,
}));

vi.mock("@/lib/savedDevices/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/savedDevices/store")>()),
  getSelectedSavedDevice: () => ({ id: "debug-c64u", lastKnownUniqueId: "5D0464" }),
}));

import {
  installSimulatedDeviceContentCleanup,
  isSimulatedDeviceOrigin,
  removeSimulatedDeviceContent,
} from "@/lib/connection/simulatedDeviceContent";
import { SHARED_DISK_LIBRARY_ID, loadDiskLibrary, saveDiskLibrary } from "@/lib/disks/diskStore";
import { createDiskEntry } from "@/lib/disks/diskTypes";
import { getLocalStoragePlaylistDataRepository } from "@/lib/playlistRepository/localStorageRepository";
import type { PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository/types";
import { buildSelectedDeviceBoundOrigin } from "@/lib/savedDevices/deviceBoundOrigin";
import { SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

/*
 * A file added from Demo Mode's simulated device was attributed to the saved real device. After
 * Demo Mode it stayed in the playlist as "/Usb0/Music/Blue Screen Waltz.sid", a path the real C64
 * Ultimate does not have.
 */

const now = new Date(0).toISOString();

const track = (trackId: string, path: string, uniqueId: string): TrackRecord => ({
  trackId,
  sourceKind: "ultimate",
  sourceLocator: path,
  sourceId: null,
  origin: {
    sourceKind: "ultimate",
    originDeviceId: "debug-c64u",
    originDeviceLastKnownUniqueId: uniqueId,
    originPath: path,
    importedAt: now,
  },
  title: path.split("/").pop() ?? path,
  path,
  createdAt: now,
  updatedAt: now,
});

const item = (playlistItemId: string, trackId: string, index: number): PlaylistItemRecord => ({
  playlistItemId,
  playlistId: SHARED_PLAYLIST_STORAGE_KEY,
  trackId,
  songNr: 1,
  sortKey: String(index).padStart(4, "0"),
  status: "ready",
  addedAt: now,
});

const seed = async () => {
  const repository = getLocalStoragePlaylistDataRepository();
  await repository.upsertTracks([
    track("ultimate:demo-waltz", "/Usb0/Music/Blue Screen Waltz.sid", "MOCK-DEMO"),
    track("ultimate:bangkok", "/USB2/C64Music/MUSICIANS/A/Abbott_Chris/Bangkok.sid", "5D0464"),
  ]);
  await repository.replacePlaylistItems(SHARED_PLAYLIST_STORAGE_KEY, [
    item("demo-waltz:1", "ultimate:demo-waltz", 0),
    item("bangkok:1", "ultimate:bangkok", 1),
  ]);
  return repository;
};

describe("the simulated device's files after Demo Mode", () => {
  beforeEach(() => {
    localStorage.clear();
    connection.snapshot.state = "DEMO_ACTIVE";
    deviceState.connectionState = "DEMO_ACTIVE";
  });

  it("marks a file added in Demo Mode as coming from the simulated device", () => {
    expect(isSimulatedDeviceOrigin(buildSelectedDeviceBoundOrigin("/Usb0/Music/Blue Screen Waltz.sid"))).toBe(true);

    deviceState.connectionState = "REAL_CONNECTED";
    const realOrigin = buildSelectedDeviceBoundOrigin("/USB2/Bangkok.sid");
    expect(isSimulatedDeviceOrigin(realOrigin)).toBe(false);
    expect(realOrigin?.originDeviceLastKnownUniqueId).toBe("5D0464");
  });

  it("removes the simulated device's playlist entries and disks and keeps the real device's", async () => {
    const repository = await seed();
    saveDiskLibrary(SHARED_DISK_LIBRARY_ID, {
      disks: [
        createDiskEntry({ location: "ultimate", path: "/Usb0/Games/Demo.d64" }),
        { ...createDiskEntry({ location: "ultimate", path: "/USB2/Games/Real.d64" }), origin: null },
      ],
    });

    await removeSimulatedDeviceContent(repository);

    const remaining = await repository.getPlaylistItems(SHARED_PLAYLIST_STORAGE_KEY);
    expect(remaining.map((entry) => entry.playlistItemId)).toEqual(["bangkok:1"]);
    expect(loadDiskLibrary(SHARED_DISK_LIBRARY_ID).disks.map((disk) => disk.path)).toEqual(["/USB2/Games/Real.d64"]);
  });

  it("cleans up once Demo Mode has given way to the real device, and not when it merely rediscovers", async () => {
    saveDiskLibrary(SHARED_DISK_LIBRARY_ID, {
      disks: [createDiskEntry({ location: "ultimate", path: "/Usb0/Games/Demo.d64" })],
    });
    const uninstall = installSimulatedDeviceContentCleanup();

    connection.moveTo("DISCOVERING");
    connection.moveTo("DEMO_ACTIVE");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadDiskLibrary(SHARED_DISK_LIBRARY_ID).disks).toHaveLength(1);

    connection.moveTo("DISCOVERING");
    connection.moveTo("REAL_CONNECTED");
    await vi.waitFor(() => expect(loadDiskLibrary(SHARED_DISK_LIBRARY_ID).disks).toHaveLength(0));
    uninstall();
  });
});
