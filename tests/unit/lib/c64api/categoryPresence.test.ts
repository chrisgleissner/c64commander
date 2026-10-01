/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { CategoryPresence } from "@/lib/c64api/categoryPresence";

describe("CategoryPresence", () => {
  it("keeps a category the device lists although it once answered 404", () => {
    const presence = new CategoryPresence();
    presence.recordList(["Audio Mixer", "Drive A Settings"]);
    presence.recordMissing("Audio Mixer");

    expect(presence.isAbsent("Audio Mixer")).toBe(false);
    expect(presence.isAbsent("Data Streams")).toBe(true);
  });

  it("treats a category that answered 404 as absent until the list is known", () => {
    const presence = new CategoryPresence();
    presence.recordMissing("Data Streams");

    expect(presence.isAbsent("Data Streams")).toBe(true);
    expect(presence.isAbsent("Audio Mixer")).toBe(false);
  });
});
