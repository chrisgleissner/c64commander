/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { computeStation, type SidcorrTinyBundle } from "@/lib/sidRadio/stationEngine";
import { parseSidcorrTiny } from "@/lib/sidRadio/sidcorrTiny";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

const FAST = 0b001; // style bit 0 (even ordinals)
const CHILL = 0b010; // style bit 1 (odd ordinals)
const md5For = (i: number) => i.toString(16).repeat(12).slice(0, 12); // "0"*12, "1"*12, …, "9"*12
const full = (prefix: string) => prefix + "0".repeat(32 - prefix.length);

// 10 tracks alternating styles, chained backwards.
const bundle = (): SidcorrTinyBundle =>
  parseSidcorrTiny(
    buildTinyFixture({
      files: Array.from({ length: 10 }, (_, i) => ({
        md5_48: md5For(i),
        tracks: [{ styleMask: i % 2 === 0 ? FAST : CHILL, neighbors: i === 0 ? [] : [i - 1, Math.max(0, i - 2)] }],
      })),
    }),
  );

describe("stationEngine — Style & Taste (M3)", () => {
  const b = bundle();

  it("Style Radio (broad) admits only style-matching candidates", () => {
    const result = computeStation({ bundle: b, seed: { kind: "style", styleBit: 0 }, styleFilter: 0, shuffleSeed: 3 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(b.styleMask[c.trackOrdinal] & FAST).not.toBe(0);
    expect(result.candidates[0].reason).toBe("style");
  });

  it("'Fast-Paced from my Likes' composes: a style filter over a Likes seed (D10)", () => {
    const likes = [full(md5For(0)), full(md5For(2)), full(md5For(4))]; // even ordinals = FAST
    const result = computeStation({ bundle: b, seed: { kind: "taste" }, styleFilter: 0, likes, shuffleSeed: 3 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) expect(b.styleMask[c.trackOrdinal] & FAST).not.toBe(0);
  });

  it("a style filter over a Song seed keeps only that style (composition)", () => {
    const result = computeStation({
      bundle: b,
      seed: { kind: "song", md5_48: md5For(4) },
      styleFilter: 1,
      shuffleSeed: 3,
    });
    for (const c of result.candidates) expect(b.styleMask[c.trackOrdinal] & CHILL).not.toBe(0);
  });

  it("Taste seeding is deterministic (diversity sample stable for a fixed shuffleSeed, D12)", () => {
    const likes = Array.from({ length: 8 }, (_, i) => full(md5For(i)));
    const a1 = computeStation({ bundle: b, seed: { kind: "taste" }, likes, shuffleSeed: 55 }).candidates.map(
      (c) => c.trackOrdinal,
    );
    const a2 = computeStation({ bundle: b, seed: { kind: "taste" }, likes, shuffleSeed: 55 }).candidates.map(
      (c) => c.trackOrdinal,
    );
    expect(a1).toEqual(a2);
    expect(a1.length).toBeGreaterThan(0);
  });
});
