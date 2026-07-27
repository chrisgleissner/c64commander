/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ isNative: true }));
const plugin = vi.hoisted(() => ({
  closeAudioTrack: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));

// Partial: other modules pulled in here (tracing) use `getPlatform` from the
// same module, so replacing it wholesale breaks their import.
vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => native.isNative,
}));
vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: plugin }));

import { silenceLeftoverNativeAudio } from "@/lib/streams/silenceLeftoverNativeAudio";

/**
 * The A/V mirror's audio is a native AudioTrack fed by a native UDP loop, both
 * owned by the Android process rather than by the WebView. Reload the WebView
 * and it keeps playing while the fresh JavaScript believes nothing is — so the
 * speaker-ownership registry starts empty, has nothing to evict, and the next
 * local tune plays *underneath* the C64's audio. Two tunes at once do not sound
 * like two tunes; they sound like a broken decoder.
 */
describe("silencing native audio left over from a previous page", () => {
  beforeEach(() => {
    native.isNative = true;
    plugin.closeAudioTrack.mockClear();
    plugin.close.mockClear();
    plugin.closeAudioTrack.mockResolvedValue(undefined);
    plugin.close.mockResolvedValue(undefined);
  });

  it("closes any AudioTrack the previous page left open", async () => {
    await silenceLeftoverNativeAudio();

    expect(plugin.closeAudioTrack).toHaveBeenCalledTimes(1);
  });

  it("unbinds the receive loops so they cannot re-open a track underneath the new page", async () => {
    await silenceLeftoverNativeAudio();

    expect(plugin.close).toHaveBeenCalledWith({ name: "audio" });
    expect(plugin.close).toHaveBeenCalledWith({ name: "video" });
  });

  it("does nothing on the web build, where a reload takes the bridge with it", async () => {
    native.isNative = false;

    await silenceLeftoverNativeAudio();

    expect(plugin.closeAudioTrack).not.toHaveBeenCalled();
  });

  it("never stops the app from starting", async () => {
    // The common case is that there is nothing to clean up, and some paths
    // throw for exactly that reason.
    plugin.closeAudioTrack.mockRejectedValueOnce(new Error("no track open"));

    await expect(silenceLeftoverNativeAudio()).resolves.toBeUndefined();
  });
});
