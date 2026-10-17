/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteDataFileIfPresent: vi.fn(async (_path: string) => true),
  readDataFileText: vi.fn<(path: string) => Promise<string | null>>(),
  loadHvscBrowseIndexSnapshot: vi.fn(),
  saveHvscBrowseIndexSnapshot: vi.fn(async () => undefined),
  addLog: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));
vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  deleteDataFileIfPresent: mocks.deleteDataFileIfPresent,
  readDataFileText: mocks.readDataFileText,
}));
vi.mock("@/lib/hvsc/hvscBrowseIndexStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hvsc/hvscBrowseIndexStore")>()),
  loadHvscBrowseIndexSnapshot: mocks.loadHvscBrowseIndexSnapshot,
  saveHvscBrowseIndexSnapshot: mocks.saveHvscBrowseIndexSnapshot,
}));

import {
  buildHvscBrowseIndexFromSonglengthSnapshot,
  type HvscBrowseIndexSnapshot,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import { readFileSync } from "node:fs";
import {
  applyIngestedSidHeaders,
  applySidHeaderIndex,
  discardIngestedSidHeaderIndex,
  INGESTED_SID_HEADER_INDEX_PATH,
} from "@/lib/hvsc/hvscIngestedSidHeaders";
import { createHvscCancellationError } from "@/lib/hvsc/hvscCancellation";
import { hydrateHvscMetadata } from "@/lib/hvsc/hvscMetadataHydrator";
import { parseSidHeaderMetadata, uint8ToBase64 } from "@/lib/sid/sidUtils";

const INDEX_PATH = INGESTED_SID_HEADER_INDEX_PATH;
const STEREO_PSID = "/MUSICIANS/H/Hubbard_Rob/Stereo.sid";
const TRIPLE_RSID = "/MUSICIANS/T/Tester/Triple.sid";
const TRUNCATED = "/MUSICIANS/T/Tester/Truncated.sid";
const UNLISTED = "/MUSICIANS/U/Unlisted/Song.sid";

type SidFile = {
  magic: "PSID" | "RSID";
  version: number;
  load: number;
  play: number;
  speed: number;
  songs: number;
  startSong: number;
  name: number[];
  author: number[];
  released: number[];
  flags: number;
  sid2: number;
  sid3: number;
};

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/** A whole SID file: the 124-byte header, then a player body the header parser must ignore. */
const buildSidFile = (sid: SidFile) => {
  const bytes = new Uint8Array(124 + 64).fill(0xea, 124);
  const view = new DataView(bytes.buffer);
  bytes.set(ascii(sid.magic), 0);
  view.setUint16(4, sid.version);
  view.setUint16(6, 0x7c);
  view.setUint16(8, sid.load);
  view.setUint16(10, 0x1000);
  view.setUint16(12, sid.play);
  view.setUint16(14, sid.songs);
  view.setUint16(16, sid.startSong);
  view.setUint32(18, sid.speed);
  bytes.set(sid.name, 22);
  bytes.set(sid.author, 54);
  bytes.set(sid.released, 86);
  view.setUint16(118, sid.flags);
  bytes[122] = sid.sid2;
  bytes[123] = sid.sid3;
  return bytes;
};

const files: Record<string, Uint8Array> = {
  // Version 3: PAL/NTSC clock, an 8580 and a 6581 at $D420, a Windows-1252 trademark sign in the
  // name, and HVSC's "<?>" unknown-author placeholder.
  [STEREO_PSID]: buildSidFile({
    magic: "PSID",
    version: 3,
    load: 0x1000,
    play: 0x1003,
    speed: 0b101,
    songs: 5,
    startSong: 3,
    name: [...ascii("Stereo Tune"), 0x99],
    author: ascii("<?>"),
    released: ascii("1987 Firebird"),
    flags: (0b11 << 2) | (0b10 << 4) | (0b01 << 6),
    sid2: 0x42,
    sid3: 0,
  }),
  // Version 4 RSID with a third SID, a subsong count past the format's limit, and no start song.
  [TRIPLE_RSID]: buildSidFile({
    magic: "RSID",
    version: 4,
    load: 0,
    play: 0,
    speed: 0,
    songs: 300,
    startSong: 0,
    name: ascii("Triple"),
    author: ascii("Tester"),
    released: ascii("2024 Example"),
    flags: 0b10 | (0b01 << 2) | (0b01 << 4) | (0b10 << 6) | (0b11 << 8),
    sid2: 0x50,
    sid3: 0x60,
  }),
  [TRUNCATED]: new Uint8Array(ascii("PSID")),
};

const listedSongs = () =>
  buildHvscBrowseIndexFromSonglengthSnapshot({
    pathToSeconds: new Map([
      [STEREO_PSID, [90, 60, 30, 20, 10]],
      [TRIPLE_RSID, [120]],
      [TRUNCATED, [5]],
    ]),
    md5ToSeconds: new Map(),
  });

/** What the native ingest writes: each ingested song's first 124 bytes, keyed by virtual path. */
const nativeHeaderIndex = () =>
  JSON.stringify(
    Object.fromEntries(
      [...Object.entries(files), [UNLISTED, files[STEREO_PSID]] as const].map(([path, bytes]) => [
        path,
        uint8ToBase64(bytes.subarray(0, 124)),
      ]),
    ),
  );

const readWholeFile = async (virtualPath: string) => ({
  id: 1,
  virtualPath,
  fileName: virtualPath.split("/").pop() ?? virtualPath,
  dataBase64: uint8ToBase64(files[virtualPath]),
});

const withoutTimestamps = (snapshot: HvscBrowseIndexSnapshot) =>
  Object.fromEntries(
    Object.entries(snapshot.songs).map(([path, { metadataUpdatedAt: _ignored, ...song }]) => [path, song]),
  );

describe("applyIngestedSidHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates natively ingested songs exactly as reading each file would, so hydration reads none of them", async () => {
    const ingested = listedSongs();
    mocks.readDataFileText.mockResolvedValue(nativeHeaderIndex());
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(ingested);

    await applyIngestedSidHeaders(INDEX_PATH);

    expect(mocks.readDataFileText).toHaveBeenCalledWith(INDEX_PATH);
    expect(mocks.saveHvscBrowseIndexSnapshot).toHaveBeenCalledWith(ingested, { foldersUnchanged: true });

    const readSong = vi.fn(readWholeFile);
    const emitProgress = vi.fn();
    await hydrateHvscMetadata({ snapshot: ingested, readSong, emitProgress });
    expect(readSong).not.toHaveBeenCalled();
    expect(emitProgress).toHaveBeenCalledWith(expect.objectContaining({ message: "HVSC META 0/0 done" }));

    const readFileByFile = listedSongs();
    await hydrateHvscMetadata({ snapshot: readFileByFile, readSong: readWholeFile, emitProgress: vi.fn() });
    expect(withoutTimestamps(ingested)).toEqual(withoutTimestamps(readFileByFile));
    expect(ingested.songs[UNLISTED]).toBeUndefined();

    expect(ingested.songs[STEREO_PSID].sidMetadata).toEqual(parseSidHeaderMetadata(files[STEREO_PSID]));
    expect(ingested.songs[STEREO_PSID]).toMatchObject({
      metadataStatus: "hydrated",
      canonicalTitle: "Stereo Tune™",
      canonicalAuthor: null,
      released: "1987 Firebird",
      defaultSong: 3,
      subsongCount: 5,
      sidMetadata: { clock: "pal_ntsc", sid1Model: "mos8580", sid2Model: "mos6581", sid2Address: 0xd420 },
    });
    expect(ingested.songs[TRIPLE_RSID].sidMetadata).toEqual(parseSidHeaderMetadata(files[TRIPLE_RSID]));
    expect(ingested.songs[TRIPLE_RSID]).toMatchObject({
      defaultSong: 1,
      subsongCount: 256,
      sidMetadata: { magicId: "RSID", rsidValid: true, sidChipCount: 3, sid3Model: "both" },
    });
    expect(ingested.songs[TRUNCATED].metadataStatus).toBe("error");
    expect(mocks.addLog).toHaveBeenCalledWith("warn", "HVSC metadata hydration failed for song", {
      virtualPath: TRUNCATED,
      source: "ingested SID header",
      error: expect.any(String),
      stack: expect.stringContaining("Error"),
    });
  });

  it("reports a missing header index once, as missing, and leaves its songs to metadata hydration", async () => {
    const ingested = listedSongs();
    mocks.readDataFileText.mockResolvedValue(null);
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(ingested);
    mocks.deleteDataFileIfPresent.mockResolvedValueOnce(false);

    await applyIngestedSidHeaders(INDEX_PATH);
    await discardIngestedSidHeaderIndex(INDEX_PATH);

    expect(mocks.saveHvscBrowseIndexSnapshot).not.toHaveBeenCalled();
    expect(mocks.addLog.mock.calls).toEqual([
      [
        "warn",
        "HVSC SID header index missing; metadata hydration will read each song",
        { sidHeaderIndexPath: INDEX_PATH },
      ],
    ]);
    const readSong = vi.fn(readWholeFile);
    await hydrateHvscMetadata({ snapshot: ingested, readSong, emitProgress: vi.fn() });
    expect(readSong).toHaveBeenCalledTimes(3);
  });

  it("leaves the index unapplied when there is no browse index to apply it to", async () => {
    mocks.readDataFileText.mockResolvedValue(nativeHeaderIndex());
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(null);

    await applyIngestedSidHeaders(INDEX_PATH);

    expect(mocks.saveHvscBrowseIndexSnapshot).not.toHaveBeenCalled();
  });

  it("deletes the header index the Android ingest writes, at the path it writes it to", async () => {
    const kotlin = readFileSync(
      "android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscSidHeaderIndex.kt",
      "utf-8",
    );
    expect(kotlin).toContain(`const val SID_HEADER_INDEX_PATH = "${INGESTED_SID_HEADER_INDEX_PATH}"`);

    await discardIngestedSidHeaderIndex();

    expect(mocks.deleteDataFileIfPresent).toHaveBeenCalledWith(INGESTED_SID_HEADER_INDEX_PATH);
    expect(mocks.addLog).not.toHaveBeenCalled();
  });

  it("reports a header index it could not delete, with the stack", async () => {
    mocks.deleteDataFileIfPresent.mockRejectedValueOnce(new Error("disk busy"));

    await discardIngestedSidHeaderIndex(INDEX_PATH);

    expect(mocks.addLog).toHaveBeenCalledWith("warn", "Failed to delete the HVSC SID header index", {
      sidHeaderIndexPath: INDEX_PATH,
      error: "disk busy",
      stack: expect.stringContaining("disk busy"),
    });
  });

  it("stops at the next chunk once the ingest is cancelled, without saving the browse index", async () => {
    const paths = Array.from({ length: 1200 }, (_, index) => `/MUSICIANS/M/Many/Song_${index}.sid`);
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map(paths.map((path) => [path, [60]])),
      md5ToSeconds: new Map(),
    });
    const header = uint8ToBase64(files[STEREO_PSID].subarray(0, 124));
    mocks.readDataFileText.mockResolvedValue(JSON.stringify(Object.fromEntries(paths.map((path) => [path, header]))));
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(snapshot);
    const throwIfCancelled = vi.fn(() => {
      throw createHvscCancellationError();
    });

    await expect(applyIngestedSidHeaders(INDEX_PATH, throwIfCancelled)).rejects.toMatchObject({
      code: "HVSC_CANCELLED",
    });

    expect(throwIfCancelled).toHaveBeenCalledTimes(1);
    expect(Object.values(snapshot.songs).filter((song) => song.metadataStatus === "hydrated")).toHaveLength(499);
    expect(mocks.saveHvscBrowseIndexSnapshot).not.toHaveBeenCalled();
  });

  it("reports how many songs it has applied, from none to all, so the analysis step can show progress", async () => {
    // On a real install this pass took about 6 s after the native ingest had resolved, with no progress
    // events, so the install looked finished while it was still working.
    const paths = Array.from({ length: 1200 }, (_, index) => `/MUSICIANS/M/Many/Song_${index}.sid`);
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map(paths.map((path) => [path, [60]])),
      md5ToSeconds: new Map(),
    });
    const header = uint8ToBase64(files[STEREO_PSID].subarray(0, 124));
    mocks.readDataFileText.mockResolvedValue(JSON.stringify(Object.fromEntries(paths.map((path) => [path, header]))));
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(snapshot);
    const progress = vi.fn();

    await applyIngestedSidHeaders(INDEX_PATH, undefined, progress);

    expect(progress.mock.calls).toEqual([
      [0, 1200],
      [500, 1200],
      [1000, 1200],
      [1200, 1200],
    ]);
    expect(mocks.saveHvscBrowseIndexSnapshot).toHaveBeenCalledTimes(1);
  });

  it("gives the UI a turn while it hydrates a full-size library", async () => {
    const paths = Array.from({ length: 1200 }, (_, index) => `/MUSICIANS/M/Many/Song_${index}.sid`);
    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot({
      pathToSeconds: new Map(paths.map((path) => [path, [60]])),
      md5ToSeconds: new Map(),
    });
    const header = uint8ToBase64(files[STEREO_PSID].subarray(0, 124));
    let finished = false;
    let uiRanBeforeFinish = false;
    setTimeout(() => {
      uiRanBeforeFinish = !finished;
    }, 0);

    await applySidHeaderIndex(snapshot, Object.fromEntries(paths.map((path) => [path, header])));
    finished = true;

    expect(uiRanBeforeFinish).toBe(true);
    expect(Object.values(snapshot.songs).every((song) => song.metadataStatus === "hydrated")).toBe(true);
  });

  it("leaves the songs to metadata hydration when the header index is not valid JSON", async () => {
    const ingested = listedSongs();
    mocks.readDataFileText.mockResolvedValue("{truncated");
    mocks.loadHvscBrowseIndexSnapshot.mockResolvedValue(ingested);

    await applyIngestedSidHeaders(INDEX_PATH);

    expect(mocks.saveHvscBrowseIndexSnapshot).not.toHaveBeenCalled();
    expect(Object.values(ingested.songs).every((song) => song.metadataStatus === "seeded")).toBe(true);
  });
});
