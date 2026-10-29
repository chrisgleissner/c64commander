/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SKIP_ROM_DEPENDENT_SONGS,
  loadSkipRomDependentSongs,
  saveSkipRomDependentSongs,
  SKIP_ROM_DEPENDENT_SONGS_KEY,
} from "@/lib/config/romDependencySettings";

describe("skipRomDependentSongs", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to skipping, so a song that sounds wrong on this device is not played unasked", () => {
    expect(DEFAULT_SKIP_ROM_DEPENDENT_SONGS).toBe(true);
    expect(loadSkipRomDependentSongs()).toBe(true);
  });

  it("persists the listener allowing these songs, and turning skipping back on", () => {
    saveSkipRomDependentSongs(false);
    expect(loadSkipRomDependentSongs()).toBe(false);
    expect(localStorage.getItem(SKIP_ROM_DEPENDENT_SONGS_KEY)).toBe("0");

    saveSkipRomDependentSongs(true);
    expect(loadSkipRomDependentSongs()).toBe(true);
    expect(localStorage.getItem(SKIP_ROM_DEPENDENT_SONGS_KEY)).toBe("1");
  });

  it("announces the change on the shared settings event", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    saveSkipRomDependentSongs(false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "c64u-app-settings-updated" }));
  });
});
