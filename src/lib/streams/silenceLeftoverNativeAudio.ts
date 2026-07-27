/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";

import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import { StreamUdp } from "@/lib/native/streamUdp";

/**
 * Silence anything the *previous* JS lifetime left playing.
 *
 * The A/V mirror's audio does not live in JavaScript. It is a native AudioTrack
 * fed by a native UDP receive loop, both owned by the Capacitor plugin — which
 * belongs to the Android process, not to the WebView. Reload the WebView (or let
 * Android recreate it) and the JavaScript starts over with `audioLive === false`
 * while the C64's audio is still coming out of the speaker.
 *
 * Everything downstream then reasons from a false premise. The speaker-ownership
 * registry is JS-side, so it starts empty and has nothing to evict; the next
 * local tune starts *underneath* the still-playing mirror, and the listener gets
 * two pieces of music at once — which sounds like a broken decoder rather than
 * like two songs.
 *
 * So on startup we assert the state we believe in: no native AudioTrack, no
 * bound sockets. Both calls are idempotent and harmless when nothing is running,
 * which matters because that is the common case.
 *
 * Not needed on the web build: there the bridge is a WebSocket owned by the page
 * itself, so a reload takes it with it. Nor on a native platform without the
 * plugin — `StreamUdp` is Android-only, and asking iOS to close an AudioTrack it
 * has no concept of rejects with "not implemented" on EVERY launch. That is not
 * a warning about anything; it is this function asking the wrong question.
 */
export const silenceLeftoverNativeAudio = async (): Promise<void> => {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("StreamUdp")) return;
  try {
    await StreamUdp.closeAudioTrack();
    // The receive loops would otherwise keep pulling multicast packets and
    // re-open a track underneath the new page.
    await Promise.allSettled([StreamUdp.close({ name: "audio" }), StreamUdp.close({ name: "video" })]);
    addLog("debug", "Streams: cleared any native audio left over from a previous page", { service: "streams" });
  } catch (error) {
    // Best effort by design: a phone with nothing left over throws here on some
    // paths, and that must never stop the app from starting.
    addLog("warn", "Streams: could not clear leftover native audio", {
      service: "streams",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
