/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { AUDIO_PROCESSING_KEY, loadAudioProcessing } from "@/lib/config/audioProcessingSettings";
import { setAudioProcessing } from "@/lib/native/audioFx";

/** Window over which a burst of slider changes is merged into one call to the plugin. */
export const AUDIO_PROCESSING_PUSH_DELAY_MS = 60;

export const pushAudioProcessing = (): Promise<boolean> => setAudioProcessing(loadAudioProcessing());

/**
 * Keeps the native processing chain equal to the stored settings: once now, then after every change
 * to one of them. Returns the function that stops it.
 */
export const installAudioProcessingSync = (): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void pushAudioProcessing();
    }, AUDIO_PROCESSING_PUSH_DELAY_MS);
  };
  const onSettingChanged = (event: Event) => {
    const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
    if (key === AUDIO_PROCESSING_KEY) schedule();
  };
  window.addEventListener("c64u-app-settings-updated", onSettingChanged);
  void pushAudioProcessing();
  return () => {
    window.removeEventListener("c64u-app-settings-updated", onSettingChanged);
    if (timer !== null) clearTimeout(timer);
  };
};
