/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { SidAudio, type SidAudioPlugin } from "@/lib/native/sidAudio";

let attached: Promise<void> | null = null;

/**
 * Claim the native SID audio state for this page, once per page lifetime.
 *
 * The native feed, its PCM buffers and its libSidplayEZ renderers outlive a WebView reload, and a
 * reloaded page holds no ids for any of them. Attaching frees whatever the previous page left, and
 * every session and renderer is created after it, so nothing of this page's can be freed by it.
 * Failure is logged and not retried: the native side then simply keeps the previous page's
 * leftovers, which its own budgets bound.
 */
export const ensureSidAudioAttached = (plugin: SidAudioPlugin = SidAudio): Promise<void> => {
  attached ??= plugin.attach().catch((error: unknown) => {
    addLog("warn", "Native SID audio: attaching to the plugin failed", {
      service: "local-sid",
      error: (error as Error)?.message ?? String(error),
    });
  });
  return attached;
};

/** Test seam. */
export const __resetSidAudioAttachForTests = (): void => {
  attached = null;
};
