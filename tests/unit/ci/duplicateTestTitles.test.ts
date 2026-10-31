/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript.
import { findDuplicateSpecTitles, listTestFiles } from "../../../scripts/find-duplicate-test-titles.mjs";

describe("one test per spec-tagged behavior", () => {
  it("finds a spec-tagged title that two files both test", () => {
    const duplicates = findDuplicateSpecTitles([
      { file: "a.test.ts", source: `it("SPM-PLAY-01 skips a tune", () => {});` },
      { file: "b.test.ts", source: `test("SPM-PLAY-01 skips a tune", () => {});` },
      { file: "c.test.ts", source: `it("SPM-PLAY-02 plays a tune", () => {});` },
    ]);

    expect(duplicates).toEqual([{ title: "SPM-PLAY-01 skips a tune", files: ["a.test.ts", "b.test.ts"] }]);
  });

  it("recognizes the hardening and bug ids the repository's titles carry", () => {
    const duplicates = findDuplicateSpecTitles([
      { file: "a.test.ts", source: `it("HARD27-007: resumes a paused session", () => {});` },
      { file: "b.test.tsx", source: `it("HARD27-007: resumes a paused session", () => {});` },
      { file: "c.test.ts", source: `it("BUG-010 splits the CPU speed write", () => {});` },
      { file: "d.test.ts", source: `it("plays the tune", () => {}); it("plays the tune", () => {});` },
      { file: "e.test.ts", source: `it("plays the tune", () => {});` },
    ]);

    expect(duplicates).toEqual([{ title: "HARD27-007: resumes a paused session", files: ["a.test.ts", "b.test.tsx"] }]);
  });

  it("accepts the same title twice in one file, as a parameterized test does", () => {
    expect(
      findDuplicateSpecTitles([
        { file: "a.test.ts", source: `it("SPM-PLAY-01 skips", () => {}); it("SPM-PLAY-01 skips", () => {});` },
      ]),
    ).toEqual([]);
  });

  it("no spec-tagged title appears in two test files of the repository", () => {
    const root = process.cwd();
    const entries = listTestFiles(root).map((file: string) => ({
      file: path.relative(root, file),
      source: readFileSync(file, "utf8"),
    }));

    expect(entries.length).toBeGreaterThan(500);
    expect(findDuplicateSpecTitles(entries)).toEqual([]);
  });
});
