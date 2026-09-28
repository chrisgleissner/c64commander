/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { compactPathLabel } from "@/components/itemSelection/ItemSelectionView";

/*
 * On a Pixel 4 at 320 CSS px, "/USB2/Games/Boulder Dash" wrapped to two lines in the browser's
 * path row, and with it the list lost the height of one of its rows.
 */
describe("compactPathLabel", () => {
  it("names the folder being shown and stands in for the ones above it", () => {
    expect(compactPathLabel("/USB2/Games/Boulder Dash")).toBe("…/Boulder Dash");
  });

  it("shows a top-level folder whole", () => {
    expect(compactPathLabel("/USB2")).toBe("/USB2");
  });

  it("shows the root as the root", () => {
    expect(compactPathLabel("/")).toBe("/");
    expect(compactPathLabel("")).toBe("/");
  });

  it("ignores a trailing slash", () => {
    expect(compactPathLabel("/USB2/Games/")).toBe("…/Games");
  });
});
