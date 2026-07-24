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
 *   - **ROM-dependent** SIDs (detected as RSID when the worker opens them) need
 *     ship-forbidden C64 ROMs → fall back to the C64 with a one-time notice.
 *   - if the environment lacks Web Workers / Web Audio → fall back to the C64.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaybackEngine } from "@/lib/config/appSettings";

export type PlaybackRoute = "c64" | "local";

/** The distinct one-time notices shown when a Local selection falls back to the C64. */
export type EngineFallbackNotice = "non-sid-on-c64" | "rom-on-c64" | "local-unavailable";

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
 * After the worker opens a SID: if it is ROM-dependent, fall back to the C64
 * with the `rom-on-c64` notice; otherwise stay on the Local engine.
 */
export function romFallbackDecision(romRequired: boolean): PreRouteDecision {
  return romRequired ? { route: "c64", notice: "rom-on-c64" } : { route: "local", notice: null };
}

/** Human-facing one-time notice copy (rendered by the controller). */
export const ENGINE_FALLBACK_MESSAGES: Record<EngineFallbackNotice, string> = {
  "non-sid-on-c64": "This runs on the C64 — only SID tunes can play on this device.",
  "rom-on-c64": "This tune needs C64 ROMs, so it plays on the C64.",
  "local-unavailable": "On-device playback isn't available here, so this plays on the C64.",
};
