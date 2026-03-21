/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeCustomSnapshotRangeDraft,
  parseHexAddress,
  sanitizeHexAddressInput,
  validateCustomSnapshotRanges,
} from "./customSnapshotRanges";

describe("customSnapshotRanges", () => {
  it("sanitizes input to uppercase hex digits only", () => {
    expect(sanitizeHexAddressInput("$0aZf1!")).toBe("0AF1");
  });

  it("normalizeCustomSnapshotRangeDraft uses empty string defaults when start/end are undefined", () => {
    const result = normalizeCustomSnapshotRangeDraft({});
    expect(result.start).toBe("");
    expect(result.end).toBe("");
  });

  it("normalizes both draft fields", () => {
    expect(normalizeCustomSnapshotRangeDraft({ start: "$0400", end: "d8zz" })).toEqual({
      start: "0400",
      end: "D8",
    });
  });

  it("parses 1-4 digit hex addresses", () => {
    expect(parseHexAddress("C000")).toBe(0xc000);
    expect(parseHexAddress("$D020")).toBe(0xd020);
    expect(parseHexAddress("")).toBeNull();
  });

  it("rejects overlapping ranges", () => {
    expect(
      validateCustomSnapshotRanges([
        { start: "0400", end: "07E7" },
        { start: "0700", end: "0800" },
      ]),
    ).toEqual({
      ok: false,
      title: "Overlapping ranges",
      description: "Custom ranges must not overlap.",
    });
  });

  it("returns encoded memory ranges for valid drafts", () => {
    expect(
      validateCustomSnapshotRanges([
        { start: "0400", end: "07E7" },
        { start: "2000", end: "20FF" },
      ]),
    ).toEqual({
      ok: true,
      ranges: [
        { start: 0x0400, length: 0x07e7 - 0x0400 + 1 },
        { start: 0x2000, length: 0x20ff - 0x2000 + 1 },
      ],
    });
  });
});
