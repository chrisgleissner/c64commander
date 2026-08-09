/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

describe("subscribeVicPalettePreference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies its subscriber and removes it during cleanup", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVicPalettePreference(listener);

    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated"));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does nothing when there is no browser window", () => {
    vi.stubGlobal("window", undefined);
    const listener = vi.fn();

    subscribeVicPalettePreference(listener)();

    expect(listener).not.toHaveBeenCalled();
  });
});
