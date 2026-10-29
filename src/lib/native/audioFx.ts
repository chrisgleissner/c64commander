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
import { isKnownUnavailable, isPluginMethodUnimplemented, recordUnavailable } from "@/lib/native/pluginAvailability";
import {
  StreamUdp,
  type StreamUdpAudioProcessing,
  type StreamUdpPlugin,
  type StreamUdpSpectrumFrame,
  type StreamUdpSpectrumRequest,
} from "@/lib/native/streamUdp";

export type AudioProcessingParams = StreamUdpAudioProcessing;
export type SpectrumFrame = StreamUdpSpectrumFrame;

type AudioFxBackend = Pick<StreamUdpPlugin, "setAudioProcessing" | "setSpectrumEnabled" | "readSpectrum">;

const SERVICE = "audio-fx";

type AudioFxTestWindow = Window & { __c64uAudioFxOverride?: AudioFxBackend; __c64uTestProbeEnabled?: boolean };

const testBackend = (): AudioFxBackend | null => {
  if (typeof window === "undefined") return null;
  const probesBuilt =
    (import.meta.env as { VITE_ENABLE_TEST_PROBES?: string } | undefined)?.VITE_ENABLE_TEST_PROBES === "1";
  const probesOn = probesBuilt || (window as AudioFxTestWindow).__c64uTestProbeEnabled === true;
  return probesOn ? ((window as AudioFxTestWindow).__c64uAudioFxOverride ?? null) : null;
};

const resolveBackend = (): AudioFxBackend | null => {
  const override = testBackend();
  if (override) return override;
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("StreamUdp")) return null;
  return StreamUdp;
};

/**
 * Whether the phone can analyse and process its own sound: the Android plugin is present and has not
 * answered "not implemented" to one of the calls. The web build, iOS and an older Android build all
 * read false, and every caller degrades to doing nothing.
 */
export const isAudioFxAvailable = (): boolean => resolveBackend() !== null && !isKnownUnavailable("StreamUdp.audioFx");

const failureStreaks = new Map<string, number>();

const reportFailure = (method: string, error: unknown) => {
  if (isPluginMethodUnimplemented(error)) {
    if (recordUnavailable("StreamUdp.audioFx")) {
      addLog("info", "Audio fx: the native plugin has no audio analysis or processing; features stay off", {
        service: SERVICE,
        method,
      });
    }
    return;
  }
  const streak = (failureStreaks.get(method) ?? 0) + 1;
  failureStreaks.set(method, streak);
  if (streak === 1) {
    addLog("warn", `Audio fx: ${method} failed`, {
      service: SERVICE,
      method,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
};

const reportSuccess = (method: string) => {
  const streak = failureStreaks.get(method) ?? 0;
  if (streak === 0) return;
  failureStreaks.delete(method);
  addLog("info", `Audio fx: ${method} recovered after ${streak} failed calls`, { service: SERVICE, method });
};

/** Sends the processing settings. Resolves false when nothing was applied (no plugin, or the call failed). */
export const setAudioProcessing = async (params: AudioProcessingParams): Promise<boolean> => {
  const backend = resolveBackend();
  if (!backend || isKnownUnavailable("StreamUdp.audioFx")) return false;
  try {
    await backend.setAudioProcessing(params);
    reportSuccess("setAudioProcessing");
    return true;
  } catch (error) {
    reportFailure("setAudioProcessing", error);
    return false;
  }
};

/** Switches the native analyser. Resolves false when the call did not reach it. */
export const setSpectrumEnabled = async (enabled: boolean): Promise<boolean> => {
  const backend = resolveBackend();
  if (!backend || isKnownUnavailable("StreamUdp.audioFx")) return false;
  try {
    await backend.setSpectrumEnabled({ enabled });
    reportSuccess("setSpectrumEnabled");
    return true;
  } catch (error) {
    reportFailure("setSpectrumEnabled", error);
    return false;
  }
};

const spectrumOwners = new Set<string>();
let spectrumConfirmed = false;
let spectrumQueue: Promise<boolean> = Promise.resolve(true);

/**
 * One owner's wish for the analyser. It runs while any owner wants it, so the Spectrum card closing does
 * not stop the Sound card's backdrop, and the other way round. The native state that was last confirmed is
 * what a call is compared with, so a call that did not reach the plugin is tried again by the next one.
 * Resolves false when the call did not reach it.
 */
export const setSpectrumDemand = (owner: string, wanted: boolean): Promise<boolean> => {
  if (wanted) spectrumOwners.add(owner);
  else spectrumOwners.delete(owner);
  const applied = spectrumQueue.then(async () => {
    const wantEnabled = spectrumOwners.size > 0;
    if (wantEnabled === spectrumConfirmed) return true;
    const reached = await setSpectrumEnabled(wantEnabled);
    if (reached) spectrumConfirmed = wantEnabled;
    return reached;
  });
  spectrumQueue = applied;
  return applied;
};

const isFrame = (value: unknown): value is SpectrumFrame => {
  const frame = value as Partial<SpectrumFrame> | null | undefined;
  return (
    typeof frame === "object" &&
    frame !== null &&
    Array.isArray(frame.bands) &&
    typeof frame.sequence === "number" &&
    typeof frame.active === "boolean" &&
    (frame.ahead === undefined || (Array.isArray(frame.ahead) && frame.ahead.every(isFrame)))
  );
};

/** Reads the newest analysis frame. Null when unavailable, failed or malformed; callers keep their last picture. */
export const readSpectrum = async (request?: StreamUdpSpectrumRequest): Promise<SpectrumFrame | null> => {
  const backend = resolveBackend();
  if (!backend || isKnownUnavailable("StreamUdp.audioFx")) return null;
  try {
    const frame = await backend.readSpectrum(request && request.targetNanos ? request : undefined);
    if (!isFrame(frame)) {
      reportFailure("readSpectrum", new Error("readSpectrum returned an unexpected shape"));
      return null;
    }
    reportSuccess("readSpectrum");
    return frame;
  } catch (error) {
    reportFailure("readSpectrum", error);
    return null;
  }
};

let probe: Promise<boolean> | null = null;

/**
 * Asks the plugin once, with a read that changes nothing, whether it has the audio calls. An older build
 * answers "not implemented", which {@link isAudioFxAvailable} then reports as false.
 */
export const probeAudioFx = (): Promise<boolean> => {
  if (resolveBackend() === null) return Promise.resolve(false);
  probe ??= readSpectrum().then(isAudioFxAvailable);
  return probe;
};

export const resetAudioFxForTests = () => {
  failureStreaks.clear();
  spectrumOwners.clear();
  spectrumConfirmed = false;
  spectrumQueue = Promise.resolve(true);
  probe = null;
};
