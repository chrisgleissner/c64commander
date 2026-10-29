/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Pure playback-engine routing decision. */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaybackEngine } from "@/lib/config/appSettings";

export type PlaybackRoute = "c64" | "local";

/** The distinct one-time notices shown when a Local selection falls back to the C64. */
export type EngineFallbackNotice =
  | "non-sid-on-c64"
  | "rom-on-c64"
  | "local-unavailable"
  | "rom-lite-engine"
  | "rom-list-on-c64"
  | "rom-list-unverified"
  | "rom-list-played-anyway"
  | "simulated-device-local-sid"
  | "no-device-local-sid"
  | "sid-unreadable-on-c64";

export interface EngineRouteInput {
  category: PlayFileCategory;
  engine: PlaybackEngine;
  /** Web Worker + Web Audio present (LocalSidEngine.isSupported()). */
  localSupported: boolean;
  /** Demo Mode: the device answering is the built-in simulation, which has no SID chip. */
  simulatedDevice?: boolean;
  /** Offline: no C64 Ultimate is connected, simulated or real. */
  noDeviceConnected?: boolean;
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
export function preRouteEngine({
  category,
  engine,
  localSupported,
  simulatedDevice = false,
  noDeviceConnected = false,
}: EngineRouteInput): PreRouteDecision {
  if (engine !== "local") {
    // A SID sent to the simulated device is silence with a success toast, and with no device at all
    // it is a connection error. Play it here instead and say so once.
    if ((simulatedDevice || noDeviceConnected) && category === "sid" && localSupported) {
      return { route: "local", notice: simulatedDevice ? "simulated-device-local-sid" : "no-device-local-sid" };
    }
    return { route: "c64", notice: null };
  }
  if (category !== "sid") return { route: "c64", notice: "non-sid-on-c64" };
  if (!localSupported) return { route: "c64", notice: "local-unavailable" };
  return { route: "local", notice: null };
}

/** True when the pre-route says to attempt on-device playback. */
export function shouldAttemptLocalEngine(input: EngineRouteInput): boolean {
  return preRouteEngine(input).route === "local";
}

/**
 * Decide whether a tune with the stored ROM images may play on this device.
 *
 * A tune "requires ROMs" when its header declares a BASIC requirement (`romRequired`, which only the
 * missing images can satisfy) or when the ROM dependency list says it sounds different on this phone
 * in its current configuration (`listedDifferent`, which holds even with KERNAL and BASIC stored,
 * because the audit's reference also has the character ROM). Either way the real C64 is the answer.
 */
export function romFallbackDecision(
  romRequired: boolean,
  romsAvailable = true,
  listedDifferent = false,
): PreRouteDecision {
  if (romRequired && !romsAvailable) return { route: "c64", notice: "rom-on-c64" };
  if (listedDifferent) return { route: "c64", notice: romsAvailable ? "rom-list-on-c64" : "rom-on-c64" };
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
    "Playing without the C64\u2019s ROMs \u2014 they\u2019re being read from the machine you\u2019re " +
    "connected to. Ordinary tunes sound the same either way; only the few that use the C64\u2019s own " +
    "routines need them.",
  "rom-list-on-c64": "This tune needs more of the C64\u2019s own ROMs than this device has, so it plays on the C64.",
  "rom-list-unverified":
    "This tune hasn\u2019t been checked without the C64\u2019s ROMs. If it sounds wrong, it needs them.",
  "rom-list-played-anyway":
    "This tune needs the C64\u2019s ROMs to sound right. Playing it anyway, as set in Settings \u2192 Play and disk.",
  "simulated-device-local-sid":
    "The simulated device has no SID chip, so this tune is playing on your phone. Everything else " +
    "behaves as it does against a real C64 Ultimate.",
  "no-device-local-sid":
    "No C64 Ultimate is connected, so this tune is playing on your phone. Programs, cartridges and " +
    "disks need a connected C64 Ultimate.",
  "sid-unreadable-on-c64": "This tune could not be read from the C64, so it plays on the C64 instead.",
};
