/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { loadDefaultSongDurationMs, saveDefaultSongDurationMs } from "@/lib/config/appSettings";

describe("the Play page's Default duration setting", () => {
  beforeEach(() => localStorage.clear());

  it("comes back as it was saved", () => {
    saveDefaultSongDurationMs(12_000);
    expect(loadDefaultSongDurationMs(180_000)).toBe(12_000);
  });

  it("falls back when nothing usable is stored", () => {
    expect(loadDefaultSongDurationMs(180_000)).toBe(180_000);
    saveDefaultSongDurationMs(0);
    expect(loadDefaultSongDurationMs(180_000)).toBe(180_000);
  });
});
