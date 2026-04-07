import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

import { hydrateHvscMetadata } from "@/lib/hvsc/hvscMetadataHydrator";
import {
  buildHvscBrowseIndexFromSonglengthSnapshot,
  getHvscSongFromBrowseIndex,
  updateHvscBrowseSong,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import { addLog } from "@/lib/logging";

const createSidBase64 = () => {
  const bytes = new Uint8Array(124);
  bytes.set([0x50, 0x53, 0x49, 0x44], 0);
  bytes[5] = 2;
  bytes[7] = 0x7c;
  bytes[15] = 2;
  bytes[17] = 2;

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  writeText(22, "Canonical Title");
  writeText(54, "Canonical Author");
  writeText(86, "1988");

  return btoa(String.fromCharCode(...bytes));
};

describe("hvscMetadataHydrator", () => {
  it("replaces seeded metadata with canonical SID header fields and emits concise progress updates", async () => {
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map([["/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid", [90, 120]]]),
      md5ToSeconds: new Map(),
    });
    const emitProgress = vi.fn();
    const onSnapshotUpdated = vi.fn();

    await hydrateHvscMetadata({
      snapshot,
      readSong: vi.fn(async () => ({
        id: 1,
        virtualPath: "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid",
        fileName: "Comic_Bakery.sid",
        dataBase64: createSidBase64(),
      })),
      emitProgress,
      onSnapshotUpdated,
    });

    const song = getHvscSongFromBrowseIndex(snapshot, "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid");
    expect(song).toMatchObject({
      displayTitleSeed: "Comic Bakery",
      displayAuthorSeed: "Rob Hubbard",
      canonicalTitle: "Canonical Title",
      canonicalAuthor: "Canonical Author",
      released: "1988",
      defaultSong: 2,
      metadataStatus: "hydrated",
      subsongCount: 2,
    });
    expect(song?.trackSubsongs?.find((entry) => entry.isDefault)?.songNr).toBe(2);

    expect(emitProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "sid_metadata_hydration",
        statusToken: "queued",
        message: "HVSC META 0/1 queued",
      }),
    );
    expect(emitProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "sid_metadata_hydration",
        statusToken: "done",
        message: "HVSC META 1/1 done",
        processedCount: 1,
        totalCount: 1,
      }),
    );
    expect(onSnapshotUpdated).toHaveBeenCalled();
  });

  it("marks unreadable songs as metadata errors without stopping the full run", async () => {
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map([
        ["/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid", [90]],
        ["/MUSICIANS/T/Tel_Jeroen/Another.sid", [45]],
      ]),
      md5ToSeconds: new Map(),
    });
    const emitProgress = vi.fn();

    await hydrateHvscMetadata({
      snapshot,
      readSong: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 2,
        virtualPath: "/MUSICIANS/T/Tel_Jeroen/Another.sid",
        fileName: "Another.sid",
        dataBase64: createSidBase64(),
      }),
      emitProgress,
    });

    expect(getHvscSongFromBrowseIndex(snapshot, "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid")?.metadataStatus).toBe(
      "error",
    );
    expect(getHvscSongFromBrowseIndex(snapshot, "/MUSICIANS/T/Tel_Jeroen/Another.sid")?.metadataStatus).toBe(
      "hydrated",
    );
    expect(emitProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        failedSongs: 1,
        statusToken: "done",
      }),
    );
  });

  it("returns immediately when all songs are already hydrated or errored", async () => {
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map([
        ["/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid", [90]],
        ["/MUSICIANS/T/Tel_Jeroen/Another.sid", [45]],
      ]),
      md5ToSeconds: new Map(),
    });
    updateHvscBrowseSong(snapshot, "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid", {
      metadataStatus: "hydrated",
    });
    updateHvscBrowseSong(snapshot, "/MUSICIANS/T/Tel_Jeroen/Another.sid", {
      metadataStatus: "error",
    });
    const readSong = vi.fn();
    const emitProgress = vi.fn();

    const result = await hydrateHvscMetadata({
      snapshot,
      readSong,
      emitProgress,
    });

    expect(result).toBe(snapshot);
    expect(readSong).not.toHaveBeenCalled();
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "sid_metadata_hydration",
        statusToken: "done",
        message: "HVSC META 0/0 done",
        percent: 100,
      }),
    );
  });

  it("emits running progress across multiple chunks and logs thrown read failures", async () => {
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map(
        Array.from({ length: 9 }, (_, index) => [`/MUSICIANS/H/Hubbard_Rob/Song_${index + 1}.sid`, [90]]),
      ),
      md5ToSeconds: new Map(),
    });
    const emitProgress = vi.fn();
    const onSnapshotUpdated = vi.fn();
    const readSong = vi.fn(async (virtualPath: string) => {
      if (virtualPath.endsWith("Song_9.sid")) {
        throw new Error("boom");
      }
      return {
        id: 1,
        virtualPath,
        fileName: virtualPath.split("/").pop() ?? "song.sid",
        dataBase64: createSidBase64(),
      };
    });

    await hydrateHvscMetadata({
      snapshot,
      readSong,
      emitProgress,
      onSnapshotUpdated,
    });

    expect(emitProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        statusToken: "running",
        processedCount: 8,
        totalCount: 9,
        failedSongs: 0,
      }),
    );
    expect(emitProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        statusToken: "done",
        processedCount: 9,
        totalCount: 9,
        failedSongs: 1,
      }),
    );
    expect(onSnapshotUpdated).toHaveBeenCalledTimes(2);
    expect(getHvscSongFromBrowseIndex(snapshot, "/MUSICIANS/H/Hubbard_Rob/Song_9.sid")?.metadataStatus).toBe("error");
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "HVSC metadata hydration failed for song",
      expect.objectContaining({
        virtualPath: "/MUSICIANS/H/Hubbard_Rob/Song_9.sid",
        error: "boom",
      }),
    );
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "HVSC metadata hydration completed with failures",
      expect.objectContaining({
        processedCount: 9,
        totalCount: 9,
        failedSongs: 1,
      }),
    );
  });
});
