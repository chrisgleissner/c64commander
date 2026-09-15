/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { getPlatform } from "@/lib/native/platform";

/**
 * Chromium freezes a hidden page a minute after it was hidden unless it is playing audio (kStopInBackground).
 * Audio rendered on the phone plays through a native track Chromium does not see, so with the screen off the
 * page froze: timers and workers stopped, the tune fell silent when the native queue ran out, and a lost
 * network went unnoticed. While background playback runs, Web Audio plays an offset nobody can hear.
 */

// -60 dBFS, above the -72 dBFS level below which Chromium counts a stream as silent. An offset has
// no frequency to hear; a source at 0 was counted as silent and the page still froze.
export const KEEP_ALIVE_LEVEL = 0.001;

let context: AudioContext | null = null;
let source: ConstantSourceNode | null = null;

export const isWebViewKeepAliveRunning = () => source !== null;

export const startWebViewKeepAlive = () => {
  if (source || getPlatform() !== "android" || typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext({ latencyHint: "playback" });
    source = context.createConstantSource();
    source.offset.value = KEEP_ALIVE_LEVEL;
    source.connect(context.destination);
    source.start();
    if (context.state !== "running") {
      void context.resume().catch((error: unknown) => {
        addLog("warn", "Background playback: could not keep the page awake with the screen off", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    source = null;
    addLog("warn", "Background playback: could not keep the page awake with the screen off", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const stopWebViewKeepAlive = () => {
  const running = source;
  if (!running) return;
  source = null;
  try {
    running.stop();
    running.disconnect();
    // Suspended, which releases the audio output, and resumed by the next start.
    void context?.suspend().catch(() => undefined);
  } catch (error) {
    addLog("debug", "Background playback: the keep-awake source was already stopped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const resetWebViewKeepAliveForTests = () => {
  source = null;
  context = null;
};
