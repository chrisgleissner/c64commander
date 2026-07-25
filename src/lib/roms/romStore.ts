/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * App-private persistence for the C64 system ROM images used by on-device SID
 * playback (spec §12, Track B).
 *
 * **Deliberate constraints, do not relax these:**
 *
 * - ROM images are stored **only** in this app's own private storage on the
 *   user's device. They are never bundled in the app, never uploaded, never
 *   exported, and never included in diagnostics bundles or logs — only the
 *   fingerprint and human-readable description are ever surfaced.
 * - Nothing here reaches the network. Acquisition is `romFetchService`, and it
 *   only ever reads from the C64 the user has connected to.
 * - `clearStoredRoms()` exists so a user can revoke them at any time.
 *
 * Storage is `localStorage`, matching the rest of the app's settings; on Android
 * and iOS the WebView's local storage lives inside the app's private data
 * directory. Two 8 KiB images base64-encode to ~22 KiB, comfortably inside the
 * quota.
 */

import { logger } from "@/lib/logging";
import { C64_ROM_BYTES, romFingerprint, validateRomImage, type C64RomKind } from "./c64SystemRoms";

const STORAGE_KEY = "c64commander.localEngine.systemRoms.v1";

export interface StoredRom {
  /** Base64 of the raw 8 KiB image. */
  data: string;
  fingerprint: string;
  description: string;
  /** ISO timestamp of when this image was read from a C64. */
  capturedAt: string;
  /** Which device it came from, for the user's own reference (host only, no credentials). */
  capturedFrom: string;
}

export type StoredRomSet = Partial<Record<C64RomKind, StoredRom>>;

/** What the UI needs to describe the current state without touching the bytes. */
export interface RomSummary {
  kind: C64RomKind;
  description: string;
  fingerprint: string;
  capturedAt: string;
  capturedFrom: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked so a 8 KiB image cannot blow the argument limit of String.fromCharCode.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readRaw(): StoredRomSet {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredRomSet;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    logger.warn("Stored C64 ROMs could not be read; ignoring them", { error: String(error) });
    return {};
  }
}

/**
 * Load and re-validate the stored images.
 *
 * Re-validating on read rather than trusting what was written means a corrupted
 * or truncated entry degrades to "no ROMs" — which routes playback to the C64 —
 * instead of feeding the engine a broken image.
 */
export function loadStoredRoms(): Partial<Record<C64RomKind, Uint8Array>> {
  const stored = readRaw();
  const result: Partial<Record<C64RomKind, Uint8Array>> = {};
  for (const kind of ["kernal", "basic"] as const) {
    const entry = stored[kind];
    if (!entry) continue;
    try {
      const bytes = fromBase64(entry.data);
      if (bytes.length !== C64_ROM_BYTES) continue;
      if (romFingerprint(bytes) !== entry.fingerprint) {
        logger.warn("Stored C64 ROM failed its fingerprint check; ignoring it", { kind });
        continue;
      }
      if (!validateRomImage(kind, bytes).ok) continue;
      result[kind] = bytes;
    } catch (error) {
      logger.warn("Stored C64 ROM could not be decoded; ignoring it", { kind, error: String(error) });
    }
  }
  return result;
}

/** Descriptions only — never the bytes. Safe to render and to log. */
export function loadRomSummaries(): RomSummary[] {
  const stored = readRaw();
  return (["kernal", "basic"] as const)
    .map((kind) => {
      const entry = stored[kind];
      return entry
        ? {
            kind,
            description: entry.description,
            fingerprint: entry.fingerprint,
            capturedAt: entry.capturedAt,
            capturedFrom: entry.capturedFrom,
          }
        : null;
    })
    .filter((summary): summary is RomSummary => summary !== null);
}

/** True when both images the engine needs are present and valid. */
export function hasCompleteRomSet(): boolean {
  const roms = loadStoredRoms();
  return roms.kernal !== undefined && roms.basic !== undefined;
}

export function saveRom(
  kind: C64RomKind,
  bytes: Uint8Array,
  meta: { description: string; fingerprint: string; capturedFrom: string },
): void {
  if (typeof localStorage === "undefined") return;
  const stored = readRaw();
  stored[kind] = {
    data: toBase64(bytes),
    fingerprint: meta.fingerprint,
    description: meta.description,
    capturedAt: new Date().toISOString(),
    capturedFrom: meta.capturedFrom,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/** Lets the user revoke the images at any time. */
export function clearStoredRoms(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
