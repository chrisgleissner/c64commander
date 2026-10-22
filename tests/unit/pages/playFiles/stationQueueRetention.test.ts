/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { retainStationQueue } from "@/pages/playFiles/stationQueueRetention";
import { loadSidRadioQueueLimit, saveSidRadioQueueLimit } from "@/lib/config/appSettings";
import type { PlaylistItem } from "@/pages/playFiles/types";
const item = (id: string) => ({ id }) as PlaylistItem;
describe("radio queue retention", () => {
  it("uses defaults without browser storage and broadcasts the normalized limit when saved", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(loadSidRadioQueueLimit()).toBe(200);
      expect(() => saveSidRadioQueueLimit(40)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    const listener = vi.fn();
    window.addEventListener("c64u-app-settings-updated", listener);
    try {
      saveSidRadioQueueLimit(10);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { key: "c64u_sid_radio_queue_limit", value: 20 },
        }),
      );
    } finally {
      window.removeEventListener("c64u-app-settings-updated", listener);
      localStorage.clear();
    }
  });

  it("keeps current and upcoming tracks even when no history can be evicted", () => {
    const queue = [item("radio:1"), item("radio:2"), item("radio:3")];
    const kept = retainStationQueue(queue, 0, 2);
    expect(kept.items).toEqual(queue);
    expect(kept.currentIndex).toBe(0);
  });
  it("retains user additions before the cursor while removing only the oldest radio history", () => {
    const kept = retainStationQueue([item("manual"), item("radio:1"), item("radio:2"), item("radio:3")], 2, 2);
    expect(kept.items.map((entry) => entry.id)).toEqual(["manual", "radio:2", "radio:3"]);
    expect(kept.currentIndex).toBe(1);
  });
  it("defaults to 200, persists valid limits and clamps malformed preferences to safe bounds", () => {
    localStorage.clear();
    expect(loadSidRadioQueueLimit()).toBe(200);
    for (const [input, expected] of [
      [50, 50],
      [0, 20],
      [999999, 1000],
      [NaN, 200],
      [Infinity, 200],
      [40.7, 41],
    ]) {
      saveSidRadioQueueLimit(input);
      expect(loadSidRadioQueueLimit()).toBe(expected);
    }
    localStorage.setItem("c64u_sid_radio_queue_limit", "NaN");
    expect(loadSidRadioQueueLimit()).toBe(200);
    localStorage.clear();
  });
});
