/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A model of the Capacitor Filesystem on each platform. Native stores bytes: a write without an
 * encoding base64-decodes its data, a UTF-8 write encodes its text. The web platform stores the
 * data string exactly as given and ignores the encoding on both write and read.
 */
const platform = vi.hoisted(() => ({
  native: true,
  bytes: new Map<string, Uint8Array>(),
  webStrings: new Map<string, string>(),
}));

const URL_PREFIX = "http://localhost/_capacitor_file_/data/";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    convertFileSrc: (uri: string) => uri.replace("file:///data/", URL_PREFIX),
  },
}));

vi.mock("@capacitor/filesystem", () => {
  const missing = (path: string) => new Error(`File at '${path}' does not exist.`);
  const has = (path: string) => (platform.native ? platform.bytes.has(path) : platform.webStrings.has(path));
  return {
    Directory: { Data: "DATA" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      mkdir: vi.fn(async () => undefined),
      deleteFile: vi.fn(async ({ path }: { path: string }) => {
        if (!has(path)) throw missing(path);
        platform.bytes.delete(path);
        platform.webStrings.delete(path);
      }),
      stat: vi.fn(async ({ path }: { path: string }) => {
        if (!has(path)) throw missing(path);
        return { type: "file", size: 1 };
      }),
      getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/${path}` })),
      writeFile: vi.fn(async ({ path, data, encoding }: { path: string; data: string; encoding?: string }) => {
        if (!platform.native) {
          platform.webStrings.set(path, data);
          return { uri: path };
        }
        platform.bytes.set(path, encoding === "utf8" ? new TextEncoder().encode(data) : Buffer.from(data, "base64"));
        return { uri: path };
      }),
      readFile: vi.fn(async ({ path, encoding }: { path: string; encoding?: string }) => {
        if (!has(path)) throw missing(path);
        if (!platform.native) return { data: platform.webStrings.get(path) };
        const bytes = platform.bytes.get(path)!;
        return { data: encoding === "utf8" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("base64") };
      }),
    },
  };
});

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { Directory, Filesystem } from "@capacitor/filesystem";
import { addLog } from "@/lib/logging";
import {
  __buildPersistedMediaIndexSnapshotForTest,
  buildHvscBrowseIndexFromEntries,
  loadHvscBrowseIndexSnapshot,
  saveHvscBrowseIndexSnapshot,
  type HvscBrowseIndexSnapshot,
} from "@/lib/hvsc/hvscBrowseIndexStore";

const MEDIA_INDEX_PATH = "hvsc/index/media-index-v2.json";
const SONG_PATH = "/MUSICIANS/C/Cadaver/Escape.sid";
const HYDRATED_AUTHOR = "Lasse Öörni (Cadaver)";

const serveFileFromDisk = () =>
  vi.fn(async (url: string) => {
    const bytes = platform.bytes.get(url.slice(URL_PREFIX.length));
    if (!bytes) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => new TextDecoder().decode(bytes) };
  });

/** More than MAX_PERSISTED_FULL_SNAPSHOT_SONGS, so only the compact media index is persisted. */
const buildRealSizedLibrary = (): HvscBrowseIndexSnapshot => {
  const entries = Array.from({ length: 10_001 }, (_, index) => ({
    path: `/DEMOS/Filler_${index}.sid`,
    name: `Filler_${index}.sid`,
    type: "sid" as const,
  }));
  entries.push({ path: SONG_PATH, name: "Escape.sid", type: "sid" });
  const snapshot = buildHvscBrowseIndexFromEntries(entries);
  const song = snapshot.songs[SONG_PATH]!;
  song.canonicalTitle = "Escape";
  song.canonicalAuthor = HYDRATED_AUTHOR;
  song.metadataStatus = "hydrated";
  return snapshot;
};

const writeTheOldWay = async (snapshot: HvscBrowseIndexSnapshot) => {
  const json = JSON.stringify(__buildPersistedMediaIndexSnapshotForTest(snapshot));
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: MEDIA_INDEX_PATH,
    data: Buffer.from(json, "utf-8").toString("base64"),
  });
};

const decodeWarnings = () =>
  vi.mocked(addLog).mock.calls.filter(([, message]) => String(message).includes("Failed to decode base64 text"));

describe("HVSC snapshot file encoding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    platform.bytes.clear();
    platform.webStrings.clear();
    platform.native = true;
    localStorage.clear();
  });

  it("writes the compact media index to the bridge as UTF-8 JSON text, never as base64", async () => {
    vi.stubGlobal("fetch", serveFileFromDisk());
    await saveHvscBrowseIndexSnapshot(buildRealSizedLibrary());

    const write = vi.mocked(Filesystem.writeFile).mock.calls.find(([options]) => options.path === MEDIA_INDEX_PATH);
    expect(write?.[0]).toMatchObject({ encoding: "utf8" });
    expect(String(write?.[0].data).startsWith('{"version":2')).toBe(true);
  });

  it("stores the same JSON bytes a base64 write of the same snapshot stored", async () => {
    const snapshot = buildRealSizedLibrary();
    await writeTheOldWay(snapshot);
    const oldBytes = platform.bytes.get(MEDIA_INDEX_PATH)!;

    await saveHvscBrowseIndexSnapshot(snapshot);
    const newJson = JSON.parse(new TextDecoder().decode(platform.bytes.get(MEDIA_INDEX_PATH)!));
    const oldJson = JSON.parse(new TextDecoder().decode(oldBytes));
    expect({ ...newJson, updatedAt: null }).toEqual({ ...oldJson, updatedAt: null });
  });

  it("loads a media index written the old way, through the file server and through the bridge", async () => {
    await writeTheOldWay(buildRealSizedLibrary());

    vi.stubGlobal("fetch", serveFileFromDisk());
    expect((await loadHvscBrowseIndexSnapshot())?.songs[SONG_PATH]?.canonicalAuthor).toBe(HYDRATED_AUTHOR);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("file server unavailable");
      }),
    );
    expect((await loadHvscBrowseIndexSnapshot())?.songs[SONG_PATH]?.canonicalAuthor).toBe(HYDRATED_AUTHOR);
  });

  it("round-trips a saved media index on native through the bridge fallback", async () => {
    await saveHvscBrowseIndexSnapshot(buildRealSizedLibrary());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("file server unavailable");
      }),
    );
    expect((await loadHvscBrowseIndexSnapshot())?.songs[SONG_PATH]?.canonicalAuthor).toBe(HYDRATED_AUTHOR);
  });

  it("on the web platform loads both an old base64 file and a new UTF-8 file without a decode warning", async () => {
    platform.native = false;
    await writeTheOldWay(buildRealSizedLibrary());
    expect((await loadHvscBrowseIndexSnapshot())?.songs[SONG_PATH]?.canonicalAuthor).toBe(HYDRATED_AUTHOR);

    await saveHvscBrowseIndexSnapshot(buildRealSizedLibrary());
    expect(platform.webStrings.get(MEDIA_INDEX_PATH)?.startsWith("{")).toBe(true);
    expect((await loadHvscBrowseIndexSnapshot())?.songs[SONG_PATH]?.canonicalAuthor).toBe(HYDRATED_AUTHOR);
    expect(decodeWarnings()).toEqual([]);
  });
});
