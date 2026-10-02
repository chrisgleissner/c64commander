/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { restoreFoundState } from "../../../tools/hil/merge_gate.mjs";

describe("restoreFoundState", () => {
  it("still restores the Ultimate master volume when putting the mirror back fails", async () => {
    const setVolume = vi.fn(async () => undefined);
    const setMirror = vi.fn(async () => {
      throw new Error("the mirror would not go to audio=false video=false");
    });
    const setMasterVolume = vi.fn(async () => undefined);
    const warn = vi.fn();

    await restoreFoundState(
      [
        ["the phone volume", 3, setVolume],
        ["the mirror toggles", { audio: false, video: false }, setMirror],
        ["the Ultimate master volume", " 0 dB", setMasterVolume],
      ],
      warn,
    );

    expect(setMasterVolume).toHaveBeenCalledWith(" 0 dB");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("could not put back the mirror toggles");
    expect(warn.mock.calls[0][0]).toContain("the mirror would not go to audio=false video=false");
  });

  it("skips what was never recorded", async () => {
    const restore = vi.fn(async () => undefined);
    await restoreFoundState([["the phone volume", null, restore]], vi.fn());
    expect(restore).not.toHaveBeenCalled();
  });
});
