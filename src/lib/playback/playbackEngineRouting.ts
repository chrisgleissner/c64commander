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
 * A correction, because the reasoning recorded here was wrong in two ways and the conclusions built
 * on it are still in the code below.
 *
 * It claimed libsidplayfp needs the kernal and basic images to run ANY tune, so that an ordinary
 * PSID plays silence without them. That is not reproducible on the shipped build: over a random
 * sample of 200 PSID tunes rendered with and without ROMs, on both engines, not one lost level
 * (0 of 200 down by even 6 dB). PSID is 93.8% of HVSC. The likely explanation is that the original
 * measurement predates the engine fix in c08fde2, which repaired a heap-use-after-free that made
 * the shipped engine render wrongly regardless of ROMs.
 *
 * It also claimed the lighter engine has kernal-free playback of its own. It does not — see
 * `effectiveSidEmulationEngine`.
 *
 * What is actually true, measured: needing the images is a property of the TUNE. libsidplayfp
 * synthesizes a minimal KERNAL when none is supplied (`SystemROMBanks.h`: an IRQ handler at $EA31,
 * RTS at all 39 jump-table entries), which is why nearly every RSID still plays; about 1.3% do not.
 * There is no BASIC substitute at all, so every RSID/BASIC tune — 1.0% of the archive — is silent
 * without the images, on either engine.
 *
 * The routing below is therefore more conservative than it needs to be for the 93.8% case. Changing
 * it is a behavioural decision that has not been taken, so it is left as it is and documented here.
 */
export function romFallbackDecision(romRequired: boolean, romsAvailable = true): PreRouteDecision {
  // An RSID drives the C64's kernal to make its sound, so no emulation without the real images can
  // play it — that one genuinely belongs on the C64.
  if (romRequired) return { route: "c64", notice: "rom-on-c64" };
  // An ordinary tune does not need the images at all — see the correction above. Note that this
  // branch cannot currently deliver what its notice promises: the worker refuses to open anything
  // when no ROMs are supplied (`localSid.worker.ts`), so "rom-lite-engine" routes to `local` and
  // then produces nothing. Whichever way that is resolved, the notice and the worker have to agree.
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
