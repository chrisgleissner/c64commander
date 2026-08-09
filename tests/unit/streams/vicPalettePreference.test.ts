/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

describe("subscribeVicPalettePreference", () => {
  it("notifies its subscriber and removes it during cleanup", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVicPalettePreference(listener);

    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated"));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated"));
    expect(listener).toHaveBeenCalledOnce();
  });
});
