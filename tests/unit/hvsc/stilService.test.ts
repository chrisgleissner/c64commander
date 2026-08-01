/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ingestStilText = vi.fn(async () => 3);
const isStilInstalled = vi.fn(async () => false);
const readStilManifest = vi.fn(async () => null as { release: number } | null);

const hasMockedStil = vi.fn(() => false);

vi.mock("@/lib/hvsc/stilStore", () => ({
  ingestStilText: (...args: unknown[]) => ingestStilText(...(args as [])),
  isStilInstalled: () => isStilInstalled(),
  hasMockedStil: () => hasMockedStil(),
  readStilManifest: () => readStilManifest(),
}));

import {
  buildStilUrls,
  ensureStilReady,
  storeStilFromArchive,
  __resetStilServiceForTest,
} from "@/lib/hvsc/stilService";
import { saveHvscState } from "@/lib/hvsc/hvscStateStore";

/** ISO-8859-1 bytes for "Für", so a decoding mistake shows up as a wrong string rather than a pass. */
const LATIN1_DOC = Uint8Array.from([0x46, 0xfc, 0x72]);

const okResponse = (bytes: Uint8Array) =>
  ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }) as unknown as Response;
const notFound = () => ({ ok: false, status: 404 }) as unknown as Response;

describe("buildStilUrls", () => {
  it("tries the release's own directory first, then the unversioned one", () => {
    // Not a theoretical fallback. The test device has HVSC 85 installed and the mirror returns 404
    // for C64Music.85/ while C64Music/ serves STIL v85, so the second URL is the one that works.
    expect(buildStilUrls(85, "https://mirror.example/HVSC/")).toEqual([
      "https://mirror.example/HVSC/C64Music.85/DOCUMENTS/STIL.txt",
      "https://mirror.example/HVSC/C64Music/DOCUMENTS/STIL.txt",
    ]);
  });

  it("asks only for the unversioned directory when the release is unknown", () => {
    expect(buildStilUrls(0, "https://mirror.example/HVSC/")).toEqual([
      "https://mirror.example/HVSC/C64Music/DOCUMENTS/STIL.txt",
    ]);
  });
});

describe("storeStilFromArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestStilText.mockResolvedValue(3);
  });

  it("decodes the bytes as ISO-8859-1, which is what the document is", async () => {
    await storeStilFromArchive(LATIN1_DOC, 85);
    expect(ingestStilText).toHaveBeenCalledWith("Für", 85);
  });

  it("never fails the install it is part of", async () => {
    // STIL enriches what is shown about a tune. A library that installed without it plays
    // everything, so a failure here must not take the archive down with it.
    ingestStilText.mockRejectedValue(new Error("disk full"));
    await expect(storeStilFromArchive(LATIN1_DOC, 85)).resolves.toBe(0);
  });
});

describe("ensureStilReady", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __resetStilServiceForTest();
    isStilInstalled.mockResolvedValue(false);
    hasMockedStil.mockReturnValue(false);
    readStilManifest.mockResolvedValue(null);
    ingestStilText.mockResolvedValue(3);
    vi.stubGlobal("fetch", fetchMock);
    saveHvscState({ installedVersion: 85, installedBaselineVersion: 85 } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads nothing when there is no library to describe", async () => {
    saveHvscState({ installedVersion: 0, installedBaselineVersion: null } as never);
    expect(await ensureStilReady()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads nothing when the store is already current", async () => {
    readStilManifest.mockResolvedValue({ release: 85 });
    expect(await ensureStilReady()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a stored copy that describes an older release", async () => {
    // `isStilInstalled` is true here — there IS something to look up — and short-circuiting on that
    // meant a library updated to a new release kept the previous release's notes for ever.
    isStilInstalled.mockResolvedValue(true);
    readStilManifest.mockResolvedValue({ release: 84 });
    fetchMock.mockResolvedValue(okResponse(LATIN1_DOC));
    expect(await ensureStilReady()).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not touch the network when a test has supplied STIL directly", async () => {
    hasMockedStil.mockReturnValue(true);
    expect(await ensureStilReady()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    hasMockedStil.mockReturnValue(false);
  });

  it("falls through to the unversioned directory when the release's own is missing", async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(okResponse(LATIN1_DOC));
    expect(await ensureStilReady()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("C64Music.85/");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("C64Music/");
    expect(ingestStilText).toHaveBeenCalledWith("Für", 85);
  });

  it("coalesces, so several tunes asking at once produce one download", async () => {
    fetchMock.mockResolvedValue(okResponse(LATIN1_DOC));
    await Promise.all([ensureStilReady(), ensureStilReady(), ensureStilReady()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an older stored copy when the download fails outright", async () => {
    // Better than nothing: an entry written for release 84 still describes most of release 85.
    fetchMock.mockResolvedValue(notFound());
    isStilInstalled.mockResolvedValue(true);
    expect(await ensureStilReady()).toBe(true);
    expect(ingestStilText).not.toHaveBeenCalled();
  });

  it("survives a network error rather than throwing at the tune that asked", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    isStilInstalled.mockResolvedValue(false);
    expect(await ensureStilReady()).toBe(false);
  });
});
