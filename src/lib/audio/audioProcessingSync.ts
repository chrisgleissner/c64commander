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

/** Delays before each retry of a push that did not reach the plugin; after the last one it waits for the next trigger. */
export const AUDIO_PROCESSING_RETRY_DELAYS_MS = [1000, 3000, 10000] as const;

const SETTINGS_EVENT = "c64u-app-settings-updated";
const LISTEN_ON_KEY = "c64u_playback_engine";

/**
 * Keeps the native processing chain equal to the stored settings: once now, then after every change
 * to one of them, again when the app returns to the foreground or the Listen on choice changes, and a few
 * times in a row when a push does not reach the plugin. The native state belongs to the process and is not
 * stored, so a restarted plugin would otherwise stay off while the card shows a curve. Every push sends the
 * whole stored state, so repeating one is harmless. Returns the function that stops it.
 */
export const installAudioProcessingSync = (): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const clearTimers = () => {
    if (timer !== null) clearTimeout(timer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
  };
  const push = async (attempt: number): Promise<void> => {
    const reached = await pushAudioProcessing();
    if (reached || stopped || attempt >= AUDIO_PROCESSING_RETRY_DELAYS_MS.length) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void push(attempt + 1);
    }, AUDIO_PROCESSING_RETRY_DELAYS_MS[attempt]);
  };
  const pushNow = () => {
    clearTimers();
    void push(0);
  };
  const schedule = () => {
    clearTimers();
    timer = setTimeout(() => {
      timer = null;
      void push(0);
    }, AUDIO_PROCESSING_PUSH_DELAY_MS);
  };
  const onSettingChanged = (event: Event) => {
    const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
    if (key === AUDIO_PROCESSING_KEY) schedule();
    else if (key === LISTEN_ON_KEY) pushNow();
  };
  const onVisibility = () => {
    if (!document.hidden) pushNow();
  };
  window.addEventListener(SETTINGS_EVENT, onSettingChanged);
  document.addEventListener("visibilitychange", onVisibility);
  pushNow();
  return () => {
    stopped = true;
    window.removeEventListener(SETTINGS_EVENT, onSettingChanged);
    document.removeEventListener("visibilitychange", onVisibility);
    clearTimers();
  };
};
