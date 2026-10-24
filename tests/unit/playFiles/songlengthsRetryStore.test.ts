/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSkippedSonglengthsFolders,
  MAX_SKIPPED_SONGLENGTHS_FOLDERS,
  getSkippedSonglengthsFolders,
  recordSkippedSonglengthsFolders,
  resolveSkippedSonglengthsFolders,
} from "@/pages/playFiles/songlengthsRetryStore";

describe("songlengthsRetryStore", () => {
  beforeEach(() => clearSkippedSonglengthsFolders());

  it("keeps the folders of each saved device apart and without repeats", () => {
    recordSkippedSonglengthsFolders("a", ["/USB2/", "/USB2/", "/USB2/Games/"]);
    recordSkippedSonglengthsFolders("b", ["/Flash/"]);

    expect(getSkippedSonglengthsFolders("a")).toEqual(["/USB2/", "/USB2/Games/"]);
    expect(getSkippedSonglengthsFolders("b")).toEqual(["/Flash/"]);
  });

  it("removes resolved folders and forgets a device that has none left", () => {
    recordSkippedSonglengthsFolders("a", ["/USB2/", "/USB2/Games/"]);

    resolveSkippedSonglengthsFolders("a", ["/USB2/"]);
    expect(getSkippedSonglengthsFolders("a")).toEqual(["/USB2/Games/"]);
    resolveSkippedSonglengthsFolders("a", ["/USB2/Games/"]);
    expect(getSkippedSonglengthsFolders("a")).toEqual([]);
  });

  it("clears one device or all of them", () => {
    recordSkippedSonglengthsFolders("a", ["/USB2/"]);
    recordSkippedSonglengthsFolders("b", ["/Flash/"]);

    clearSkippedSonglengthsFolders("a");
    expect(getSkippedSonglengthsFolders("a")).toEqual([]);
    expect(getSkippedSonglengthsFolders("b")).toEqual(["/Flash/"]);
    clearSkippedSonglengthsFolders();
    expect(getSkippedSonglengthsFolders("b")).toEqual([]);
  });

  it("stores at most the cap per device and keeps what it stored first", () => {
    const many = Array.from({ length: MAX_SKIPPED_SONGLENGTHS_FOLDERS + 50 }, (_, index) => `/USB2/${index}/`);

    recordSkippedSonglengthsFolders("a", many);

    const stored = getSkippedSonglengthsFolders("a");
    expect(stored).toHaveLength(MAX_SKIPPED_SONGLENGTHS_FOLDERS);
    expect(stored[0]).toBe("/USB2/0/");
  });
});
