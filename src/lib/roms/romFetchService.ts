/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Read the C64 system ROMs from the connected machine (spec §12, Track B).
 *
 * `GET /v1/machine:readmem` is documented in the Ultimate's OpenAPI spec as
 * performing a **DMA read** on the cartridge bus, so this returns what the CPU
 * would see at those addresses. Verified byte-for-byte against the canonical
 * images during the fidelity work.
 *
 * **This is only ever driven by an explicit user action.** Nothing here runs in
 * the background, on connect, or on app start. The images are read from the
 * machine the user has chosen to connect to, and stay in that user's own
 * app-private storage.
 *
 * Chargen ($D000) is deliberately not fetched: under default banking that
 * address is I/O, so a plain read returns the I/O space rather than the
 * character generator, and reading it properly would mean writing $01 to clear
 * CHAREN and restoring it afterwards. Chargen has no effect on audio, so the
 * risk is not worth taking.
 */

import type { C64API } from "@/lib/c64api";
import { logger } from "@/lib/logging";
import { ROM_SOURCE_ADDRESS, validateRomImage, type C64RomKind } from "./c64SystemRoms";
import { saveRom } from "./romStore";

export interface RomFetchOutcome {
  kind: C64RomKind;
  ok: boolean;
  description?: string;
  fingerprint?: string;
  /** Present when `ok` is false. Safe to show the user. */
  reason?: string;
}

export interface RomFetchResult {
  ok: boolean;
  outcomes: RomFetchOutcome[];
}

const ROM_LENGTH = 8192;

/**
 * Fetch, validate and store KERNAL and BASIC.
 *
 * A dump that fails validation is **never stored** — see `validateRomImage` for
 * why that matters (a DMA read reflects current banking, so an active cartridge
 * yields RAM that is still ROM-shaped).
 */
export async function fetchSystemRomsFromDevice(api: C64API, deviceLabel: string): Promise<RomFetchResult> {
  const outcomes: RomFetchOutcome[] = [];

  for (const kind of ["kernal", "basic"] as const) {
    try {
      const bytes = await api.readMemory(ROM_SOURCE_ADDRESS[kind], ROM_LENGTH, {
        __c64uIntent: `read ${kind} ROM`,
      });
      const validation = validateRomImage(kind, bytes);
      if (!validation.ok) {
        outcomes.push({ kind, ok: false, reason: validation.reason });
        continue;
      }
      saveRom(kind, validation.image.bytes, {
        description: validation.image.description,
        fingerprint: validation.image.fingerprint,
        capturedFrom: deviceLabel,
      });
      outcomes.push({
        kind,
        ok: true,
        description: validation.image.description,
        fingerprint: validation.image.fingerprint,
      });
      // Fingerprint and description only — never the image itself.
      logger.info("Read a C64 system ROM from the connected device", {
        kind,
        description: validation.image.description,
        fingerprint: validation.image.fingerprint,
      });
    } catch (error) {
      outcomes.push({ kind, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { ok: outcomes.every((outcome) => outcome.ok), outcomes };
}
