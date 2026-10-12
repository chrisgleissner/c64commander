/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { SidAudio, type SidAudioPlugin } from "@/lib/native/sidAudio";
import { isNativePcm, type CachedPcm, type PcmPayload, NativePcmBuffer } from "./pcmPayload";

let pending = new Set<number>();
let scheduled = false;
let plugin: SidAudioPlugin = SidAudio;

const flush = () => {
  scheduled = false;
  const ids = [...pending];
  pending = new Set();
  if (ids.length === 0) return;
  void plugin.releaseBuffers({ bufferIds: ids }).catch((error: unknown) => {
    // The native store expires and budgets what it holds, so a lost release costs memory for a
    // while, not correctness; it is still worth seeing.
    addLog("warn", "Native SID audio: releasing PCM buffers failed", {
      service: "local-sid",
      count: ids.length,
      error: (error as Error)?.message ?? String(error),
    });
  });
};

/**
 * Give a native PCM buffer back. Batched per turn, so dropping a run of stale chunks costs one call.
 * Anything that is not a native buffer is ignored, so callers can pass whatever they are discarding.
 */
export const releaseNativePcm = (pcm: PcmPayload | CachedPcm | null | undefined): void => {
  const id = isNativePcm(pcm) ? pcm.bufferId : pcm instanceof NativePcmBuffer ? pcm.bufferId : null;
  if (id === null) return;
  pending.add(id);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
};

/** Test seam. */
export const __setNativePcmReleasePluginForTests = (next: SidAudioPlugin): void => {
  plugin = next;
};
