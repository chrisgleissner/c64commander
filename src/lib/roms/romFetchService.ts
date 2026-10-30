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
 * Two callers: the explicit Settings action, and `ensureSystemRoms` when a tune
 * plays here without KERNAL and BASIC and the user has left "Read them
 * automatically" on. Nothing runs on connect or on app start. The images are
 * read from the machine the user has chosen to connect to, and stay in that
 * user's own app-private storage.
 *
 * The character ROM ($D000) cannot be read that way: under default banking
 * that address is I/O, and only the C64's own CPU can bank the character ROM
 * in. So it is read only when the caller asks (`includeCharacterRom`, which
 * only the Settings action does), by briefly running a copy routine on the machine
 * (`characterRomReader.ts`), and only after KERNAL and BASIC have just read
 * back valid — proof the machine is in its default banking. It is optional:
 * no tune's audio depends on it, so a failure here never fails the fetch.
 */

import type { C64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { detectSnapshotCapability } from "@/lib/snapshot/cpu/capability";
import { ROM_SOURCE_ADDRESS, validateRomImage, type C64RomKind } from "./c64SystemRoms";
import { readCharacterRomViaIrq } from "./characterRomReader";
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
  /** KERNAL and BASIC were both read and stored; the optional character ROM does not count. */
  ok: boolean;
  outcomes: RomFetchOutcome[];
}

const ROM_LENGTH = 8192;

function storeValidated(kind: C64RomKind, bytes: Uint8Array, deviceLabel: string): RomFetchOutcome {
  const validation = validateRomImage(kind, bytes);
  if (!validation.ok) return { kind, ok: false, reason: validation.reason };
  saveRom(kind, validation.image.bytes, {
    description: validation.image.description,
    fingerprint: validation.image.fingerprint,
    capturedFrom: deviceLabel,
  });
  // Fingerprint and description only — never the image itself.
  addLog("info", "Read a C64 system ROM from the connected device", {
    kind,
    description: validation.image.description,
    fingerprint: validation.image.fingerprint,
  });
  return { kind, ok: true, description: validation.image.description, fingerprint: validation.image.fingerprint };
}

async function fetchCharacterRom(api: C64API, deviceLabel: string): Promise<RomFetchOutcome> {
  const capability = await detectSnapshotCapability(api);
  if (!capability.cpuSnapshotSupported) {
    const reason = `skipped: this device cannot run the copy routine (${capability.reason ?? "unsupported"})`;
    addLog("warn", "Did not read the C64 character ROM", { reason });
    return { kind: "chargen", ok: false, reason };
  }
  try {
    return storeValidated("chargen", await readCharacterRomViaIrq(api), deviceLabel);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    addLog("warn", "Reading the C64 character ROM failed", { error: reason });
    return { kind: "chargen", ok: false, reason };
  }
}

/**
 * Fetch, validate and store KERNAL and BASIC.
 *
 * A dump that fails validation is **never stored** — see `validateRomImage` for
 * why that matters (a DMA read reflects current banking, so an active cartridge
 * yields RAM that is still ROM-shaped).
 */
export async function fetchSystemRomsFromDevice(
  api: C64API,
  deviceLabel: string,
  { includeCharacterRom = false }: { includeCharacterRom?: boolean } = {},
): Promise<RomFetchResult> {
  const outcomes: RomFetchOutcome[] = [];

  for (const kind of ["kernal", "basic"] as const) {
    try {
      // "user": this only ever runs from an explicit tap in Settings, so it gets
      // the same scheduling priority as any other direct user action.
      const bytes = await api.readMemory(ROM_SOURCE_ADDRESS[kind], ROM_LENGTH, {
        __c64uIntent: "user",
      });
      outcomes.push(storeValidated(kind, bytes, deviceLabel));
    } catch (error) {
      outcomes.push({ kind, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const ok = outcomes.every((outcome) => outcome.ok);
  if (ok && includeCharacterRom) outcomes.push(await fetchCharacterRom(api, deviceLabel));
  return { ok, outcomes };
}
