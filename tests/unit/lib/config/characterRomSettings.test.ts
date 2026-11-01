/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_ROM_READ_KEY,
  DEFAULT_CHARACTER_ROM_READ,
  loadCharacterRomRead,
  saveCharacterRomRead,
} from "@/lib/config/characterRomSettings";

describe("characterRomRead", () => {
  beforeEach(() => localStorage.clear());

  it("is off by default, so no routine runs on the C64 unless the user asked for it", () => {
    expect(DEFAULT_CHARACTER_ROM_READ).toBe(false);
    expect(loadCharacterRomRead()).toBe(false);
  });

  it("persists the user turning the read on, and off again", () => {
    saveCharacterRomRead(true);
    expect(loadCharacterRomRead()).toBe(true);
    expect(localStorage.getItem(CHARACTER_ROM_READ_KEY)).toBe("1");

    saveCharacterRomRead(false);
    expect(loadCharacterRomRead()).toBe(false);
    expect(localStorage.getItem(CHARACTER_ROM_READ_KEY)).toBe("0");
  });

  it("announces the change on the shared settings event", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    saveCharacterRomRead(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "c64u-app-settings-updated" }));
    spy.mockRestore();
  });
});
