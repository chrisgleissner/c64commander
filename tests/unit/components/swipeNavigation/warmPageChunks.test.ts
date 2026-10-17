/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => [] as string[]);

const PAGE_MODULES: Array<[string, string]> = [
  ["@/pages/HomePage", "home"],
  ["@/pages/PlayFilesPage", "play"],
  ["@/pages/DisksPage", "disks"],
  ["@/pages/ConfigBrowserPage", "config"],
  ["@/pages/SettingsPage", "settings"],
];

const importWarm = async () => (await import("@/components/swipeNavigation/PageSlotBody")).warmPageChunks;

describe("warmPageChunks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    loaded.length = 0;
    for (const [path, name] of PAGE_MODULES) {
      vi.doMock(path, () => {
        loaded.push(name);
        return { default: () => null };
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the other tabs one at a time after the app has been idle, never the page already shown", async () => {
    const warmPageChunks = await importWarm();
    warmPageChunks();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(loaded).toEqual([]);

    await vi.advanceTimersByTimeAsync(600);
    expect(loaded).toEqual(["play"]);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(loaded).toEqual(["play", "disks"]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(loaded).toEqual(["play", "disks", "config", "settings"]);
  });

  it("stops loading when it is cancelled, as when the layer unmounts", async () => {
    const cancel = (await importWarm())();

    await vi.advanceTimersByTimeAsync(2_600);
    expect(loaded).toEqual(["play"]);

    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loaded).toEqual(["play"]);
  });
});
