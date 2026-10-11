/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { addLog } from "@/lib/logging";
import { SidAudio, type SidAudioPlugin } from "@/lib/native/sidAudio";

/**
 * The SID renderers the app can play with, and which of them this device actually has.
 *
 *  - `sidplayez`: libSidplayEZ, native, Android only. Renders into native buffers on its own
 *    thread, so its PCM never enters JavaScript.
 *  - `residfp`: libsidplayfp's reSIDfp, WASM in a Web Worker. Every platform.
 *  - `sidlite`: libsidplayfp's SIDLite, WASM in a Web Worker. Every platform.
 *
 * Which renderer to use is separate from where the sound goes (this device or the C64): that is
 * `PlaybackEngine`. A renderer is only ever offered where it can run, and the answer for
 * libSidplayEZ comes from the native side (the library loaded and this CPU can run it), not from a
 * platform guess.
 */
export type SidRendererId = "sidplayez" | "residfp" | "sidlite";

export const SID_RENDERERS: readonly SidRendererId[] = ["sidplayez", "residfp", "sidlite"];

export const isSidRendererId = (value: unknown): value is SidRendererId =>
  value === "sidplayez" || value === "residfp" || value === "sidlite";

/** Where a renderer runs, and therefore where its PCM lives. */
export const sidRendererRuntime = (id: SidRendererId): "native" | "wasm" => (id === "sidplayez" ? "native" : "wasm");

type NativeState =
  { status: "unknown" } | { status: "available"; revision: string | null } | { status: "unavailable"; reason: string };

let nativeState: NativeState = { status: "unknown" };
let probing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const PROBE_TIMEOUT_MS = 3000;

export const isSidRendererAvailable = (id: SidRendererId): boolean =>
  id !== "sidplayez" || nativeState.status === "available";

export const availableSidRenderers = (): SidRendererId[] => SID_RENDERERS.filter(isSidRendererAvailable);

/** Why libSidplayEZ is not offered, or null when it is (or has not been asked about yet). */
export const sidplayEzUnavailableReason = (): string | null =>
  nativeState.status === "unavailable" ? nativeState.reason : null;

export const sidplayEzRevision = (): string | null =>
  nativeState.status === "available" ? nativeState.revision : null;

export const subscribeSidRendererAvailability = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const isAndroidWithSidAudio = (): boolean =>
  Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SidAudio");

/**
 * Settle the answer without waiting where no question needs asking: off Android there is nothing to
 * ask, so the answer is known at once. True when the answer is known.
 */
export const settleSidRendererAvailabilitySync = (): boolean => {
  if (nativeState.status !== "unknown") return true;
  if (isAndroidWithSidAudio()) return false;
  nativeState = { status: "unavailable", reason: "libSidplayEZ is only built for Android" };
  notify();
  return true;
};

/**
 * Ask the native side once whether libSidplayEZ can run here. Idempotent; resolves when the answer
 * is known. Bounded, because a WebView that never delivers the reply must not hold up playback —
 * the renderer is then treated as unavailable and the WASM engines are used.
 */
export const probeSidRenderers = (plugin: SidAudioPlugin = SidAudio): Promise<void> => {
  if (settleSidRendererAvailabilitySync()) return Promise.resolve();
  if (probing) return probing;
  probing = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (nativeState.status === "unknown") {
        nativeState = { status: "unavailable", reason: "the native SID audio plugin did not answer" };
        addLog("warn", "libSidplayEZ availability probe timed out; using the WASM renderers", {
          service: "local-sid",
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        notify();
      }
      resolve();
    }, PROBE_TIMEOUT_MS);
    plugin
      .describe()
      .then((description) => {
        nativeState = description.sidplayezAvailable
          ? { status: "available", revision: description.sidplayezRevision ?? null }
          : { status: "unavailable", reason: description.sidplayezUnavailableReason ?? "not available" };
        addLog("info", "SID renderers probed", {
          service: "local-sid",
          sidplayez: description.sidplayezAvailable,
          reason: description.sidplayezUnavailableReason ?? null,
          revision: description.sidplayezRevision ?? null,
          abi: description.abi ?? null,
        });
      })
      .catch((error: unknown) => {
        nativeState = {
          status: "unavailable",
          reason: `the native SID audio plugin failed: ${(error as Error)?.message ?? String(error)}`,
        };
        addLog("warn", "libSidplayEZ availability probe failed; using the WASM renderers", {
          service: "local-sid",
          error: (error as Error)?.message ?? String(error),
        });
      })
      .finally(() => {
        clearTimeout(timer);
        notify();
        resolve();
      });
  });
  return probing;
};

/** Test seam: set what the native side reported, or forget it. */
export const __setSidplayEzAvailabilityForTests = (available: boolean | null, reason = "test"): void => {
  probing = null;
  nativeState =
    available === null
      ? { status: "unknown" }
      : available
        ? { status: "available", revision: "test" }
        : { status: "unavailable", reason };
  notify();
};
