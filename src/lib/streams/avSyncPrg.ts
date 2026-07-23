/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The bundled **av-sync-auto** C64 program (415 bytes), from the c64stream sibling project
 * (`tools/c64/av-sync-auto.asm`). It loads at $0801 (BASIC `SYS 2062`) and, every 48 frames,
 * flashes the whole screen white for exactly one frame while gating an audible SID tone at
 * the same instant — a periodic, precisely-aligned A/V "pop" for measuring the app's
 * audio↔video pipeline skew (see {@link AvSyncAnalyzer}). Run it via the device's
 * `run_prg` upload; it is RAM-resident and self-contained.
 */

import { getC64API, type C64API } from "@/lib/c64api";

export const AV_SYNC_PRG_FILENAME = "avsync.prg";

/** Base64 of `av-sync-auto.prg` (load address $0801 first). */
export const AV_SYNC_PRG_BASE64 =
  "AQgMCAoAniAyMDYyAAAAeKk3hQEgbAggjgipAI0g0I0h0I0V0KIYnQDUyhD6qQCNBdSp8I0G1KkwjZkJqQCNmgkgZgmpsI0UA6kIjRUDqX+NDdyNDd2tDdytDd2pAY0a0CBUCakBjRnQWExpCKkgogCdAASdAAWdAAadAAfo4OjQ750ABJ0ABZ0ABujQ9GCpAaIAnQDYnQDZnQDanQDb6ODo0O+dANidANmdANro0PRgrZsJ8CStmgnwFMkB8AsgMQmpAI2aCUzOCKkCjZoJqQCNmwkgVAlMCAmtmgnJAvAgzpkJ0BipMI2ZCSAQCakBjZoJqQGNmwkgRglMCAlMCAmpAY2bCSBGCakBjRnQTIHqqTeFAakBjSDQjSHQqQ+NGNSpKI0A1KkAjQHUqRGNBNRgqTeFAakQjQTUqQCNGNSNINCNIdBgqQCNEtCtEdApf40R0GCtnAmNEtCtEdApfw2dCY0R0GCpAM0S0ND7rRLQ8PutEdAQ+60S0MkgsBCtEdAw9KkEjZwJqYCNnQlgqTWNnAmpgI2dCWAwAAAAAA==";

/** Decode the bundled PRG to raw bytes. */
export const avSyncPrgBytes = (): Uint8Array => {
  const binary = atob(AV_SYNC_PRG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const avSyncPrgBlob = (): Blob =>
  new Blob([new Uint8Array(avSyncPrgBytes())], { type: "application/octet-stream" });

/** Upload and run the A/V sync test program on the connected device. */
export const runAvSyncTest = (api: C64API = getC64API()): Promise<{ errors: string[] }> =>
  api.runPrgUpload(avSyncPrgBlob(), { filename: AV_SYNC_PRG_FILENAME });
