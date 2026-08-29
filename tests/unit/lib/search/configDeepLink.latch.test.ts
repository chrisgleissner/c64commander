/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_ITEM_FOCUS_LATCH_TTL_MS,
  requestConfigItemFocus,
  resetConfigItemFocusLatchForTests,
  subscribeConfigItemFocus,
  type ConfigItemFocusRequest,
} from "@/lib/search/configDeepLink";

/*
 * Activating a config result from any page other than Config navigates first, and React Router
 * commits that asynchronously. Dispatching alone reached nobody: the category stayed shut, the item
 * never rendered, and the resolver reported "Could not reach" for an item that was there all along.
 */
describe("a config focus request made before the Config page mounts", () => {
  afterEach(() => {
    resetConfigItemFocusLatchForTests();
  });

  it("reaches a subscriber that mounts afterwards", () => {
    const seen: ConfigItemFocusRequest[] = [];
    requestConfigItemFocus("Audio Mixer", "Vol UltiSid 1");

    const unsubscribe = subscribeConfigItemFocus((request) => seen.push(request));

    expect(seen).toEqual([{ category: "Audio Mixer", itemName: "Vol UltiSid 1" }]);
    unsubscribe();
  });

  it("still reaches a subscriber that was already listening, exactly once", () => {
    const seen: ConfigItemFocusRequest[] = [];
    const unsubscribe = subscribeConfigItemFocus((request) => seen.push(request));

    requestConfigItemFocus("Audio Mixer", "Vol UltiSid 1");

    expect(seen).toHaveLength(1);
    unsubscribe();
  });

  /*
   * Delivering through the event must also claim the latch. A config result activated from Config
   * itself reaches its subscriber directly, and the latch stayed armed for the rest of its five
   * seconds — so leaving the page and coming back inside the window moved focus a second time, on a
   * page the user had since scrolled somewhere else.
   */
  it("is claimed by that subscriber, so a later mount gets nothing", () => {
    const live: ConfigItemFocusRequest[] = [];
    const stopLive = subscribeConfigItemFocus((request) => live.push(request));

    requestConfigItemFocus("Audio Mixer", "Vol UltiSid 1");
    expect(live).toHaveLength(1);
    stopLive();

    const remounted: ConfigItemFocusRequest[] = [];
    const stopRemounted = subscribeConfigItemFocus((request) => remounted.push(request));

    expect(remounted, "the request was already delivered; it must not move focus again").toEqual([]);
    stopRemounted();
  });

  it("expires, so a stale request cannot move focus later", () => {
    vi.useFakeTimers();
    try {
      requestConfigItemFocus("Audio Mixer", "Vol UltiSid 1");
      vi.advanceTimersByTime(CONFIG_ITEM_FOCUS_LATCH_TTL_MS + 1);

      const seen: ConfigItemFocusRequest[] = [];
      const unsubscribe = subscribeConfigItemFocus((request) => seen.push(request));

      expect(seen).toEqual([]);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
