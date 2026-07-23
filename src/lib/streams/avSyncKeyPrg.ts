/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The bundled **av-sync-key** C64 program (`tools/c64/av-sync-key.asm`), derived from
 * c64stream's space-triggered `av-sync.asm`. It loads at $0801 (BASIC `SYS 2062`) and, each time
 * SPACE is newly pressed (rising edge, de-bounced), flashes the whole screen white for exactly
 * one frame while gating an audible SID tone at the same instant — one precisely-aligned A/V
 * "pop" per keypress, frame-aligned via a raster IRQ exactly like {@link avSyncPrg av-sync-auto}.
 *
 * C64 Commander sends SPACE over Remote Input (machine:input) and measures the time from that
 * press to seeing/hearing the resulting pop, plus the pop's audio↔video offset (see
 * {@link useAvSync} interactive latency). RAM-resident and self-contained; run via `run_prg`.
 */

import { getC64API, type C64API } from "@/lib/c64api";

export const AV_SYNC_KEY_PRG_FILENAME = "avsynckey.prg";

/** Base64 of `av-sync-key.prg` (load address $0801 first). */
export const AV_SYNC_KEY_PRG_BASE64 =
  "AQgMCAoAniAyMDYyAAAAeKk3hQGp/40C3KkAjQPcIHQIIJYIqQCNINCNIdCNFdCiGJ0A1MoQ+qkAjQXUqfCNBtSpAI21CY23CSCCCam4jRQDqQiNFQOpf40N3I0N3a0N3K0N3akBjRrQIHAJqQGNGdBYTHEIqSCiAJ0ABJ0ABZ0ABp0AB+jg6NDvnQAEnQAFnQAG6ND0YKkBogCdANidANmdANqdANvo4OjQ750A2J0A2Z0A2ujQ9GCttgnwJK21CfAUyQHwCyBNCakAjbUJTNYIqQKNtQmpAI22CSBwCUwkCa21CckC8DSpf40A3K0B3CkQ0B2ttwnQIKkBjbcJICwJqQGNtQmpAY22CSBiCUwkCakAjbcJTBkJTCQJqQGNtgkgYgmpAY0Z0EyB6qk3hQGpAY0g0I0h0KkPjRjUqSiNANSpAI0B1KkRjQTUYKk3hQGpEI0E1KkAjRjUjSDQjSHQYKkAjRLQrRHQKX+NEdBgrbgJjRLQrRHQKX8NuQmNEdBgqQDNEtDQ+60S0PD7rRHQEPutEtDJILAQrRHQMPSpBI24CamAjbkJYKk1jbgJqYCNuQlgAAAAAAA=";

/** Decode the bundled PRG to raw bytes. */
export const avSyncKeyPrgBytes = (): Uint8Array => {
  const binary = atob(AV_SYNC_KEY_PRG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const avSyncKeyPrgBlob = (): Blob =>
  new Blob([new Uint8Array(avSyncKeyPrgBytes())], { type: "application/octet-stream" });

/** Upload and run the space-triggered A/V sync test program on the connected device. */
export const runAvSyncKeyTest = (api: C64API = getC64API()): Promise<{ errors: string[] }> =>
  api.runPrgUpload(avSyncKeyPrgBlob(), { filename: AV_SYNC_KEY_PRG_FILENAME });
