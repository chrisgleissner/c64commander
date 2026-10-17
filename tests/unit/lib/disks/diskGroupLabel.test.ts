/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { groupRepeatsFolder } from "@/lib/disks/diskGrouping";

describe("groupRepeatsFolder", () => {
  it("is true when the group is the folder's own name", () => {
    expect(groupRepeatsFolder("Sample Arcade", "/Local/Sample Arcade/")).toBe(true);
  });

  it("ignores case and the difference between spaces, underscores and hyphens", () => {
    expect(groupRepeatsFolder("Sample Arcade", "/Usb0/sample_arcade")).toBe(true);
    expect(groupRepeatsFolder("sample-arcade", "/Usb0/Sample Arcade/")).toBe(true);
  });

  it("is false when the group differs from the folder name", () => {
    expect(groupRepeatsFolder("Turrican_(Original)", "/Usb0/Games/Turrican/")).toBe(false);
  });

  it("is false for a folder with no name", () => {
    expect(groupRepeatsFolder("Sample Arcade", "/")).toBe(false);
  });
});
