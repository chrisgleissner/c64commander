/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildHvscBrowseIndexFromSonglengthSnapshot,
  listSongsRecursiveFromBrowseIndex,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import {
  countSonglengthsEntries,
  parseSonglengths,
  resolveSonglengthsDurationMs,
  resolveSonglengthsSeconds,
} from "@/lib/sid/songlengths";

vi.mock("@/lib/sid/sidUtils", () => ({
  computeSidMd5: async () => "deadbeefdeadbeefdeadbeefdeadbeef",
}));

const fixture = `
; /HVSC/Demos/demo.sid
c0ffeec0ffeec0ffeec0ffeec0ffee00=0:30 0:40
; /HVSC/Demos/demo2.sid
c0c0anutc0c0anutc0c0anutc0c0anut=1:15
`;

describe("parseSonglengths", () => {
  it("maps path and md5 entries to seconds arrays", () => {
    const data = parseSonglengths(fixture);
    expect(data.pathToSeconds.get("/HVSC/Demos/demo.sid")).toEqual([30, 40]);
    expect(data.pathToSeconds.get("/HVSC/Demos/demo2.sid")).toEqual([75]);
    expect(data.md5ToSeconds.get("c0ffeec0ffeec0ffeec0ffeec0ffee00")).toEqual([30, 40]);
    expect(data.md5ToSeconds.get("c0c0anutc0c0anutc0c0anutc0c0anut")).toEqual([75]);
  });

  it("builds seeded catalog rows and folder hierarchy from a representative Songlengths.md5 fragment", () => {
    const data = parseSonglengths(`
      ; /MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid
      aa11aa11aa11aa11aa11aa11aa11aa11=1:30 2:00
      ; /GAMES/Zap.sid
      bb22bb22bb22bb22bb22bb22bb22bb22=0:45
    `);

    const snapshot = buildHvscBrowseIndexFromSonglengthSnapshot(data);
    const seededSong = snapshot.songs["/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid"];

    expect(seededSong).toMatchObject({
      fileName: "Comic_Bakery.sid",
      displayTitleSeed: "Comic Bakery",
      displayAuthorSeed: "Rob Hubbard",
      durationSeconds: 90,
      durationsSeconds: [90, 120],
      subsongCount: 2,
      defaultSong: 1,
      metadataStatus: "seeded",
    });
    expect(snapshot.folders["/MUSICIANS/H/Hubbard_Rob"]).toMatchObject({
      path: "/MUSICIANS/H/Hubbard_Rob",
      songs: ["/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid"],
    });
    expect(listSongsRecursiveFromBrowseIndex(snapshot, "/MUSICIANS")).toHaveLength(1);
    expect(listSongsRecursiveFromBrowseIndex(snapshot, "/GAMES")).toHaveLength(1);
  });

  it("parses legacy songlengths.txt path entries", () => {
    const txtFixture = `
      /HVSC/Demos/demo.sid 0:25
      /HVSC/Demos/demo2.sid 1:05
    `;
    const data = parseSonglengths(txtFixture);
    expect(data.pathToSeconds.get("/HVSC/Demos/demo.sid")).toEqual([25]);
    expect(data.pathToSeconds.get("/HVSC/Demos/demo2.sid")).toEqual([65]);
    expect(data.md5ToSeconds.size).toBe(0);
  });

  it("parses old-format attribute tokens (G/M/Z/B)", () => {
    const data = parseSonglengths("aabbcc=0:06(G) 0:02(M)");
    expect(data.md5ToSeconds.get("aabbcc")).toEqual([6, 2]);
  });

  it("resolves seconds by path or md5 and songNr", () => {
    const data = parseSonglengths(fixture);
    expect(resolveSonglengthsSeconds(data, "/HVSC/Demos/demo.sid", null, 1)).toBe(30);
    expect(resolveSonglengthsSeconds(data, "/HVSC/Demos/demo.sid", null, 2)).toBe(40);
    expect(resolveSonglengthsSeconds(data, "/HVSC/Demos/demo.sid", null, 3)).toBeNull();
    expect(resolveSonglengthsSeconds(data, "/missing.sid", "c0c0anutc0c0anutc0c0anutc0c0anut", 1)).toBe(75);
    expect(resolveSonglengthsSeconds(data, "/missing.sid", "missing", 1)).toBeNull();
  });

  it("counts songlengths entries", () => {
    const data = parseSonglengths(fixture);
    expect(countSonglengthsEntries(data)).toBe(2);
  });

  it("resolves duration ms using path or md5 fallback", async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const md5Fixture = "deadbeefdeadbeefdeadbeefdeadbeef=0:42 0:55";
    const data = parseSonglengths(md5Fixture);
    const file = {
      name: "demo.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => buffer,
    };

    const pathDuration = await resolveSonglengthsDurationMs(parseSonglengths(fixture), "/HVSC/Demos/demo.sid", file, 1);
    expect(pathDuration).toBe(30 * 1000);

    const pathDurationSong2 = await resolveSonglengthsDurationMs(
      parseSonglengths(fixture),
      "/HVSC/Demos/demo.sid",
      file,
      2,
    );
    expect(pathDurationSong2).toBe(40 * 1000);

    const md5Duration = await resolveSonglengthsDurationMs(data, "/missing.sid", file, 2);
    expect(md5Duration).toBe(55 * 1000);
  });

  it("resolves duration by path without file data", async () => {
    const data = parseSonglengths("/songs/demo.sid 0:25");
    const duration = await resolveSonglengthsDurationMs(data, "/songs/demo.sid", null, 1);
    expect(duration).toBe(25 * 1000);
  });

  it("returns null duration when data is null", async () => {
    expect(await resolveSonglengthsDurationMs(null, "/any.sid")).toBeNull();
  });

  it("returns null duration when data is undefined", async () => {
    expect(await resolveSonglengthsDurationMs(undefined, "/any.sid")).toBeNull();
  });

  it("returns 0 count for null or undefined data", () => {
    expect(countSonglengthsEntries(null)).toBe(0);
    expect(countSonglengthsEntries(undefined)).toBe(0);
  });

  it("returns null seconds for null data", () => {
    expect(resolveSonglengthsSeconds(null, "/any.sid")).toBeNull();
  });

  it("returns null when songNr exceeds available entries", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "/demo.sid", null, 5)).toBeNull();
  });

  it("defaults songNr 0 to first entry", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30 0:45");
    expect(resolveSonglengthsSeconds(data, "/demo.sid", null, 0)).toBe(30);
  });

  it("handles backslash path normalization", () => {
    const data = parseSonglengths("; /HVSC\\Demos\\demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "/HVSC/Demos/demo.sid", null, 1)).toBe(30);
  });

  it("handles paths without leading slash", () => {
    const data = parseSonglengths("; HVSC/Demos/demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "HVSC/Demos/demo.sid", null, 1)).toBe(30);
  });

  it("skips bracket lines in HVSC format", () => {
    const input = "; /demo.sid\n[Database]\nabc=0:30";
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.get("/demo.sid")).toEqual([30]);
  });

  it("skips lines with hash comment prefix", () => {
    const input = "# comment line\n; /demo.sid\nabc=0:30";
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.size).toBe(1);
  });

  it("skips lines with colon prefix and treats as path", () => {
    const input = ": /HVSC/Songs/tune.sid\nabc=1:00";
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.get("/HVSC/Songs/tune.sid")).toEqual([60]);
  });

  it("handles sub-second durations with fractional parts", () => {
    const data = parseSonglengths("; /demo.sid\nabc=1:30.500");
    expect(resolveSonglengthsSeconds(data, "/demo.sid", null, 1)).toBe(91);
  });

  it("handles md5 lookup with whitespace padding", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "/nope.sid", "  ABC  ", 1)).toBe(30);
  });

  it("returns null when md5 fallback also misses", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "/nope.sid", "missing_md5", 1)).toBeNull();
  });

  it("returns null when md5 is falsy", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    expect(resolveSonglengthsSeconds(data, "/nope.sid", null, 1)).toBeNull();
    expect(resolveSonglengthsSeconds(data, "/nope.sid", "", 1)).toBeNull();
  });

  it("handles md5 fallback in resolveSonglengthsDurationMs when computeSidMd5 returns known md5", async () => {
    const md5Fixture = "deadbeefdeadbeefdeadbeefdeadbeef=0:42";
    const data = parseSonglengths(md5Fixture);
    const file = {
      name: "test.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, "/unknown.sid", file, 1);
    expect(duration).toBe(42 * 1000);
  });

  it("returns null when computeSidMd5 md5 is also not found", async () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    const file = {
      name: "test.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, "/unknown.sid", file, 1);
    expect(duration).toBeNull();
  });

  it("ignores empty md5 or value in equals-format lines", () => {
    const data = parseSonglengths("=0:30\nabc=");
    expect(data.md5ToSeconds.size).toBe(0);
    expect(data.pathToSeconds.size).toBe(0);
  });

  it("ignores durations with unparseable tokens", () => {
    const data = parseSonglengths("; /demo.sid\nabc=notaTime");
    expect(data.md5ToSeconds.get("abc")).toBeUndefined();
  });

  it("ignores legacy lines with only path and no duration", () => {
    const data = parseSonglengths("/just/path.sid");
    expect(data.pathToSeconds.size).toBe(0);
  });

  it("returns null for empty durations array via manual data construction", () => {
    const data = {
      pathToSeconds: new Map([["/x.sid", [] as number[]]]),
      md5ToSeconds: new Map<string, number[]>(),
    };
    expect(resolveSonglengthsSeconds(data, "/x.sid", null, 1)).toBeNull();
  });

  it("defaults negative songNr to first entry", () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30 0:45");
    expect(resolveSonglengthsSeconds(data, "/demo.sid", null, -1)).toBe(30);
  });

  it("returns null when file.arrayBuffer throws during md5 resolution", async () => {
    const data = parseSonglengths("; /other.sid\nabc=0:30");
    const file = {
      name: "test.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => {
        throw new Error("read error");
      },
    };
    const duration = await resolveSonglengthsDurationMs(data, "/missing.sid", file, 1);
    expect(duration).toBeNull();
  });

  it("returns null when path not found and file is null", async () => {
    const data = parseSonglengths("; /demo.sid\nabc=0:30");
    const result = await resolveSonglengthsDurationMs(data, "/missing.sid", null, 1);
    expect(result).toBeNull();
  });

  it("normalizes empty path string to slash in resolveSonglengthsSeconds", () => {
    const data = parseSonglengths("");
    const result = resolveSonglengthsSeconds(data, "", null, 1);
    expect(result).toBeNull();
  });

  it("logs null songNr when arrayBuffer throws and songNr is undefined", async () => {
    const data = parseSonglengths("; /miss.sid\nabc=0:30");
    const file = {
      name: "test.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => {
        throw new Error("read error");
      },
    };
    const result = await resolveSonglengthsDurationMs(data, "/missing.sid", file, undefined);
    expect(result).toBeNull();
  });

  it("ignores legacy format lines with unrecognized duration tokens", () => {
    const data = parseSonglengths("/song.sid badtiming");
    expect(data.pathToSeconds.size).toBe(0);
  });

  it("ignores legacy format lines where value is empty after path (line 151 TRUE)", () => {
    // Line like "path   " has a space but the value after the split is empty
    const data = parseSonglengths("path  ");
    expect(data.pathToSeconds.size).toBe(0);
  });

  it("resolveSonglengthsSeconds handles out-of-range songNr (line 27)", () => {
    const data = parseSonglengths("; /test.sid\nabc=0:30 0:45");
    // songNr=10 is beyond the 2-element durations array
    const result = resolveSonglengthsSeconds(data, "/test.sid", "abc", 10);
    expect(result).toBeNull();
  });

  it("returns null for undefined element in durations array (line 28 ?? fallback)", () => {
    // Manually construct a sparse array to trigger the durations[index] ?? null branch
    const data = {
      pathToSeconds: new Map([["/x.sid", [30, undefined as unknown as number, 60]]]),
      md5ToSeconds: new Map<string, number[]>(),
    };
    expect(resolveSonglengthsSeconds(data, "/x.sid", null, 2)).toBeNull();
  });
});
