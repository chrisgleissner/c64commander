/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  getMd548PathIndexStats,
  md548FromFullMd5,
  parseMd548PathIndex,
  rebuildMd548PathIndex,
  resetMd548PathIndex,
  md548ForVirtualPath,
  resolveVirtualPath,
} from "@/lib/sidRadio/md5PathIndex";

// Representative Songlengths.md5 content. The comment line carries the path;
// the `<full_md5>=<durations>` line carries the identity. A shared 6-byte
// prefix across two different paths models an HVSC duplicate (§2.4).
const COMMANDO_MD5 = "cd50f5c1a2b3c4d5e6f70011223344ff";
const DUP_MD5_A = "abcdef0123450000000000000000aaaa";
const DUP_MD5_B = "abcdef0123459999999999999999bbbb"; // same first 12 hex → same md5_48
const OTHER_MD5 = "0011223344556677889900aabbccddee";

const SONGLENGTHS = [
  "[Database]",
  "; /MUSICIANS/H/Hubbard_Rob/Commando.sid",
  `${COMMANDO_MD5}=3:41 2:58`,
  "; /MUSICIANS/D/Daglish_Ben/Zoids.sid",
  `${OTHER_MD5}=2:10`,
  "; /GAMES/A/Alpha.sid",
  `${DUP_MD5_A}=1:00`,
  "; /DEMOS/B/Beta.sid",
  `${DUP_MD5_B}=1:00`,
].join("\n");

describe("parseMd548PathIndex", () => {
  it("derives md5_48 as the first 12 hex chars (case-insensitive)", () => {
    expect(md548FromFullMd5(COMMANDO_MD5)).toBe("cd50f5c1a2b3");
    expect(md548FromFullMd5(COMMANDO_MD5.toUpperCase())).toBe("cd50f5c1a2b3");
  });

  it("maps md5_48 → virtualPath[] including the Commando line", () => {
    const index = parseMd548PathIndex(SONGLENGTHS);
    expect(index.get("cd50f5c1a2b3")).toEqual(["/MUSICIANS/H/Hubbard_Rob/Commando.sid"]);
    expect(index.get(md548FromFullMd5(OTHER_MD5))).toEqual(["/MUSICIANS/D/Daglish_Ben/Zoids.sid"]);
  });

  it("collects multi-path prefixes into a deterministically sorted array", () => {
    const index = parseMd548PathIndex(SONGLENGTHS);
    // DUP_MD5_A and DUP_MD5_B share the first 12 hex → one md5_48, two paths.
    expect(index.get("abcdef012345")).toEqual(["/DEMOS/B/Beta.sid", "/GAMES/A/Alpha.sid"]);
  });
});

describe("resolveVirtualPath (D14 tie-break)", () => {
  beforeEach(() => resetMd548PathIndex());

  it("returns the lowest sorted path by default", () => {
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    expect(resolveVirtualPath("abcdef012345")).toBe("/DEMOS/B/Beta.sid");
    expect(resolveVirtualPath("cd50f5c1a2b3")).toBe("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    expect(resolveVirtualPath("ffffffffffff")).toBeNull();
  });

  it("prefers an installed path, then lowest sorted", () => {
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    // Only the GAMES copy is installed → it wins even though DEMOS sorts lower.
    expect(resolveVirtualPath("abcdef012345", { isInstalled: (p) => p.startsWith("/GAMES/") })).toBe(
      "/GAMES/A/Alpha.sid",
    );
    // Neither installed → fall back to lowest sorted.
    expect(resolveVirtualPath("abcdef012345", { isInstalled: () => false })).toBe("/DEMOS/B/Beta.sid");
  });
});

describe("rebuildMd548PathIndex — staleness & force", () => {
  beforeEach(() => resetMd548PathIndex());

  it("skips an unchanged rebuild but honours force", () => {
    expect(rebuildMd548PathIndex(SONGLENGTHS).rebuilt).toBe(true);
    expect(rebuildMd548PathIndex(SONGLENGTHS).rebuilt).toBe(false); // unchanged → skip
    expect(rebuildMd548PathIndex(SONGLENGTHS, { force: true }).rebuilt).toBe(true); // force re-derives
  });

  it("never clobbers a populated index with an empty discovery", () => {
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    const before = getMd548PathIndexStats().size;
    const result = rebuildMd548PathIndex("", { force: true }); // empty pre-commit discovery
    expect(result.rebuilt).toBe(false);
    expect(getMd548PathIndexStats().size).toBe(before);
    expect(resolveVirtualPath("cd50f5c1a2b3")).toBe("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
  });

  it("re-maps a moved tune after a simulated HVSC update (same md5 → new path)", () => {
    rebuildMd548PathIndex(SONGLENGTHS, { force: true });
    expect(resolveVirtualPath("cd50f5c1a2b3")).toBe("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    // HVSC update relocates Commando; content-addressed identity is unchanged.
    const moved = SONGLENGTHS.replace(
      "; /MUSICIANS/H/Hubbard_Rob/Commando.sid",
      "; /MUSICIANS/H/Hubbard_Rob/Commando_Remix.sid",
    );
    expect(rebuildMd548PathIndex(moved).rebuilt).toBe(true);
    expect(resolveVirtualPath("cd50f5c1a2b3")).toBe("/MUSICIANS/H/Hubbard_Rob/Commando_Remix.sid");
  });

  it("accepts multiple .md5 file contents", () => {
    const partA = "; /A/one.sid\n" + "1111111111110000000000000000aaaa=1:00";
    const partB = "; /B/two.sid\n" + "2222222222220000000000000000bbbb=2:00";
    rebuildMd548PathIndex([partA, partB], { force: true });
    expect(resolveVirtualPath("111111111111")).toBe("/A/one.sid");
    expect(resolveVirtualPath("222222222222")).toBe("/B/two.sid");
  });
});

/**
 * The index read backwards.
 *
 * Serving a neighbour needs `md5_48 → path`. Choosing a tune BY NAME needs the opposite: a search
 * result is a path, and seeding a station from it means turning that path back into the identity the
 * similarity corpus uses. Hashing the file would answer the same question at the cost of a file read
 * and a digest for something the parse already knew.
 */
describe("md548ForVirtualPath", () => {
  beforeEach(() => {
    resetMd548PathIndex();
    rebuildMd548PathIndex(SONGLENGTHS);
  });

  it("gives the corpus identity of a path", () => {
    expect(md548ForVirtualPath("/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBe(COMMANDO_MD5.slice(0, 12));
  });

  it("normalises a path the same way the forward lookup does", () => {
    expect(md548ForVirtualPath("MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBe(COMMANDO_MD5.slice(0, 12));
  });

  it("answers null for a tune the archive does not list", () => {
    // Not the same as an error: such a tune can still be played, it just cannot seed a station.
    expect(md548ForVirtualPath("/MUSICIANS/X/Nobody/Unknown.sid")).toBeNull();
  });

  it("maps every duplicate of a shared identity back to it", () => {
    // HVSC keeps the same tune in more than one place. Each path has exactly one hash, so the
    // inversion is unambiguous even though the forward direction is one-to-many.
    expect(md548ForVirtualPath("/GAMES/A/Alpha.sid")).toBe(DUP_MD5_A.slice(0, 12));
    expect(md548ForVirtualPath("/DEMOS/B/Beta.sid")).toBe(DUP_MD5_B.slice(0, 12));
  });

  it("is emptied by a reset, so a stale library cannot answer for a new one", () => {
    resetMd548PathIndex();
    expect(md548ForVirtualPath("/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBeNull();
  });

  it("follows a rebuild onto the new library", () => {
    rebuildMd548PathIndex(["; /NEW/Only.sid", `${OTHER_MD5}=1:00`].join("\n"));

    expect(md548ForVirtualPath("/NEW/Only.sid")).toBe(OTHER_MD5.slice(0, 12));
    expect(md548ForVirtualPath("/MUSICIANS/H/Hubbard_Rob/Commando.sid")).toBeNull();
  });
});
