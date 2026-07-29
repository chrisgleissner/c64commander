/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pure playback-engine routing decision (spec §12.2/§12.5, Track B / LE2).
 *
 * A single obvious control (`c64` | `local`) picks where a tune plays. This
 * module holds the *decision* — kept pure so the route + the one-time notices
 * are unit-tested without the controller. The rules:
 *
 * - Engine `c64` → always the Ultimate (`executePlayPlan`), the app's identity.
 * - Engine `local`:
 *   - only **SID** can play on-device (libsidplayfp is SID-only) → non-SID
 *     (prg/crt/disk/mod) falls back to the C64 with a one-time notice.
 *   - without **C64 ROMs** nothing can play on-device. libsidplayfp initialises a
 *     tune and then never advances it, producing a flat drone (measured: envelope
 *     correlation ~0.008 against real hardware, vs 0.625 with ROMs — see
 *     docs/plans/sid-station/AUDIO-FIDELITY-TEST.md §6.2). ROMs cannot be
 *     shipped, but the user can read them from their own connected C64 in
 *     Settings; until they do, every SID falls back to the C64 with a one-time
 *     notice.
 *   - if the environment lacks Web Workers / Web Audio → fall back to the C64.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaybackEngine } from "@/lib/config/appSettings";

export type PlaybackRoute = "c64" | "local";

/** The distinct one-time notices shown when a Local selection falls back to the C64. */
export type EngineFallbackNotice = "non-sid-on-c64" | "rom-on-c64" | "local-unavailable" | "rom-lite-engine";

export interface EngineRouteInput {
  category: PlayFileCategory;
  engine: PlaybackEngine;
  /** Web Worker + Web Audio present (LocalSidEngine.isSupported()). */
  localSupported: boolean;
}

export interface PreRouteDecision {
  route: PlaybackRoute;
  /** A one-time notice to surface when the Local selection was overridden. */
  notice: EngineFallbackNotice | null;
}

/**
 * Decide the route *before* the tune is opened (category + engine + support).
 * ROM-dependence is only known once the worker opens the SID, so a `local`
 * route here may still fall back later — see {@link romFallbackDecision}.
 */
export function preRouteEngine({ category, engine, localSupported }: EngineRouteInput): PreRouteDecision {
  if (engine !== "local") return { route: "c64", notice: null };
  if (category !== "sid") return { route: "c64", notice: "non-sid-on-c64" };
  if (!localSupported) return { route: "c64", notice: "local-unavailable" };
  return { route: "local", notice: null };
}

/** True when the pre-route says to attempt on-device playback. */
export function shouldAttemptLocalEngine(input: EngineRouteInput): boolean {
  return preRouteEngine(input).route === "local";
}

/**
 * Whether this tune can play on the device, given the ROMs actually stored.
 *
 * `romRequired` used to be the only question, and it asks whether the TUNE drives the C64's kernal
 * (an RSID). That is not the same as whether the engine can produce sound: libsidplayfp needs the
 * kernal and basic images to run ANY tune, and without them an ordinary PSID plays silence. Since
 * nothing fetches the ROMs on the user's behalf, the default state of a fresh install is "no ROMs" —
 * so "Listen on: this device" routed every tune to an engine that could not sound, and said nothing.
 * Measured on a Pixel 4: engine `local`, no stored ROMs, zero audio players, microphone at room noise.
 *
 * The notice for it already existed and already says the right thing; it was simply never reachable
 * for the case that matters most.
 */
export function romFallbackDecision(romRequired: boolean, romsAvailable = true): PreRouteDecision {
  // An RSID drives the C64's kernal to make its sound, so no emulation without the real images can
  // play it — that one genuinely belongs on the C64.
  if (romRequired) return { route: "c64", notice: "rom-on-c64" };
  // An ordinary tune does not. Missing images mean the accurate engine cannot run, but the lighter
  // one carries its own kernal-free playback, so the tune still plays here — which is what the
  // listener asked for. `effectiveSidEmulationEngine` makes that substitution; the only thing left
  // to do is say why it sounds different.
  return romsAvailable ? { route: "local", notice: null } : { route: "local", notice: "rom-lite-engine" };
}

/** Human-facing one-time notice copy (rendered by the controller). */
export const ENGINE_FALLBACK_MESSAGES: Record<EngineFallbackNotice, string> = {
  "non-sid-on-c64": "This runs on the C64 — only SID tunes can play on this device.",
  "rom-on-c64":
    "On-device playback needs the C64 ROMs. Add them in Settings — they are read from the C64 " +
    "you're connected to. Until then, this plays on the C64.",
  "local-unavailable": "On-device playback isn't available here, so this plays on the C64.",
  "rom-lite-engine":
    "Playing with the lighter SID emulation: the accurate one needs the C64\u2019s ROMs, which are " +
    "being read from the machine you\u2019re connected to. The next tune will use them.",
};
