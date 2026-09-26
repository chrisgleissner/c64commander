/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { formatElapsedAgo, formatElapsedSeconds } from "@/lib/ui/elapsedAgo";

describe("formatElapsedSeconds", () => {
  it("keeps seconds and minutes-with-seconds below an hour", () => {
    expect(formatElapsedSeconds(56)).toBe("56s");
    expect(formatElapsedSeconds(16 * 60 + 56)).toBe("16m 56s");
  });

  it("switches to hours and minutes from one hour instead of counting minutes past 59", () => {
    expect(formatElapsedSeconds(3600)).toBe("1h 0m");
    expect(formatElapsedSeconds(616 * 60 + 56)).toBe("10h 16m");
  });

  it("switches to days and hours from one day", () => {
    expect(formatElapsedSeconds(2 * 86400 + 3 * 3600 + 59)).toBe("2d 3h");
  });
});

describe("formatElapsedAgo", () => {
  it("prefixes the elapsed time and says ago", () => {
    const now = Date.parse("2026-01-01T22:16:57.000Z");
    expect(formatElapsedAgo("Last check", Date.parse("2026-01-01T12:00:01.000Z"), now)).toBe("Last check 10h 16m ago");
  });

  it("clamps a timestamp in the future to zero", () => {
    expect(formatElapsedAgo("Last seen", 2000, 1000)).toBe("Last seen 0s ago");
  });

  it("shows a dash when there is no timestamp", () => {
    expect(formatElapsedAgo("Last check", null)).toBe("Last check -");
    expect(formatElapsedAgo("Last check", Number.NaN)).toBe("Last check -");
  });
});
