/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { asCardTitle, slugifyCategory } from "@/pages/config/UnroutedCategorySections";

/**
 * These two decide what a reader sees on a card the app has never been told about, and what that
 * card is addressed by. Both are driven entirely by a string the DEVICE chose, so neither can be
 * checked by reading the code against a fixed list of categories.
 */
describe("asCardTitle", () => {
  it("lowers plain words after the first, so a category reads like the menu pages beside it", () => {
    expect(asCardTitle("Data Streams")).toBe("Data streams");
    expect(asCardTitle("Tape Settings")).toBe("Tape settings");
    expect(asCardTitle("Clock Settings")).toBe("Clock settings");
  });

  it("leaves names alone, because they are not words", () => {
    // The exemption is what stops "SoftIEC" becoming "Softiec" and "C64U" becoming "C64u". Anything
    // that is not simply an initial capital followed by lower case keeps the casing it arrived in.
    expect(asCardTitle("SoftIEC Drive Settings")).toBe("SoftIEC drive settings");
    expect(asCardTitle("C64U Model")).toBe("C64U model");
    // "Socket" is a plain word and lowers; "SID" and "ARMSID" are names and do not.
    expect(asCardTitle("SID Socket 1: ARMSID")).toBe("SID socket 1: ARMSID");
  });

  it("keeps the first word as the device wrote it", () => {
    expect(asCardTitle("Network Settings")).toBe("Network settings");
    expect(asCardTitle("USB Settings")).toBe("USB settings");
  });

  it("returns something for a category that is one word, or none", () => {
    expect(asCardTitle("Modems")).toBe("Modems");
    expect(asCardTitle("")).toBe("");
  });
});

describe("slugifyCategory", () => {
  it("reduces a category to a testid fragment", () => {
    expect(slugifyCategory("Tape Settings")).toBe("tape-settings");
    expect(slugifyCategory("SoftIEC Drive Settings")).toBe("softiec-drive-settings");
  });

  it("collapses punctuation rather than carrying it into an id", () => {
    // "SID Socket 1: ARMSID" would otherwise produce a colon, which is not a valid CSS selector
    // fragment — a testid query for it throws rather than returning nothing.
    expect(slugifyCategory("SID Socket 1: ARMSID")).toBe("sid-socket-1-armsid");
    expect(slugifyCategory("Network Services & Timezone")).toBe("network-services-timezone");
  });

  it("does not leave a leading or trailing separator", () => {
    expect(slugifyCategory("  Modems  ")).toBe("modems");
    expect(slugifyCategory("&Odd&")).toBe("odd");
  });

  it("gives two different categories two different ids", () => {
    expect(slugifyCategory("Drive A Settings")).not.toBe(slugifyCategory("Drive B Settings"));
  });
});
