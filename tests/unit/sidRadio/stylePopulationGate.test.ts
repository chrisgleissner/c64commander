/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { MIN_STYLE_POPULATION, assertStylePopulations, readStylePopulations } from "../../../scripts/fetch-sidcorr.mjs";
import { parseSidcorrTiny } from "@/lib/sidRadio/sidcorrTiny";
import { stylePopulationsFromBundle } from "@/lib/sidRadio/sidRadioWorkerCore";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

/**
 * The launcher no longer prints a per-mood track count, so a release that quietly
 * lost most of a mood would not be visible on screen any more. The build counts
 * them instead, and these tests hold that counter to the app's own parser.
 */
describe("SID Radio style population gate", () => {
  const fixture = () =>
    Buffer.from(
      buildTinyFixture({
        files: [
          { md5_48: "aaaaaaaaaaaa", tracks: [{ styleMask: 0b011 }, { styleMask: 0b001 }] },
          { md5_48: "bbbbbbbbbbbb", tracks: [{ styleMask: 0b010, neighbors: [0] }] },
          { md5_48: "cccccccccccc", tracks: [{ styleMask: 0b000, neighbors: [1, 0] }] },
        ],
      }),
    );

  it("counts each style exactly as the app's own parser does", () => {
    // The build script cannot import the app's TypeScript parser, so it carries
    // its own reader of the same header. That is a duplicate, and a duplicate is
    // only safe while something proves the two agree.
    const buffer = fixture();
    const fromBuildScript = readStylePopulations(buffer);
    const fromApp = stylePopulationsFromBundle(
      parseSidcorrTiny(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
    );

    expect(fromBuildScript).toEqual(fromApp);
    // And the numbers are the ones the fixture was built with, so a reader that
    // returned zeroes for everything could not pass by agreeing with itself.
    expect(fromBuildScript.fast_paced).toBe(2);
    expect(fromBuildScript.slow_ambient).toBe(2);
  });

  it("reports every style that falls under the floor", () => {
    const offenders = assertStylePopulations({ fast_paced: 12_000, slow_ambient: 9_999, theme_hunter: 0 }, 10_000);

    expect(offenders).toEqual([
      { key: "slow_ambient", count: 9_999 },
      { key: "theme_hunter", count: 0 },
    ]);
  });

  it("passes a release where every style clears the floor", () => {
    expect(assertStylePopulations({ fast_paced: 10_000, slow_ambient: 17_574 }, 10_000)).toEqual([]);
  });

  it("holds the floor at ten thousand", () => {
    // Stated as a test so lowering the bar is a visible decision rather than a
    // quiet edit to a constant.
    expect(MIN_STYLE_POPULATION).toBe(10_000);
  });

  it("refuses a buffer that is not a bundle", () => {
    expect(() => readStylePopulations(Buffer.from("not a bundle at all"))).toThrow(/sidcorr-tiny-1/);
  });
});
