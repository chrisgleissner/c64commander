/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pure helpers for the Local SID worker (spec §12, Track B / LE1). Kept out of
 * `localSid.worker.ts` so the ROM-dependence detection and error/scope guards
 * are unit-tested host-deterministically — the worker file itself only wires
 * these to the worker globals and the (device-validated) WASM engine.
 */

import type { LocalSidErrorCode, LocalSidErrorMessage } from "./localSidWorkerProtocol";

/** The 4-byte magic at the start of a SID file. */
export type SidMagic = "PSID" | "RSID" | "UNKNOWN";

/** Read the 4-byte ASCII magic from SID bytes. */
export function sidMagic(bytes: Uint8Array): SidMagic {
  if (bytes.length < 4) return "UNKNOWN";
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return magic === "PSID" || magic === "RSID" ? magic : "UNKNOWN";
}

/**
 * True when the tune needs C64 KERNAL/BASIC/CHARGEN ROMs we cannot ship
 * (spec §12.2). v1 stance: **RSID always needs the KERNAL** (its init/play run
 * as real interrupt-driven C64 code), so it is routed to "Play on C64". The
 * large **ROM-independent PSID** subset plays on-device; the rare PSID that
 * calls a ROM routine is a refinement we can add on-device if a specific tune
 * misbehaves. `UNKNOWN` is left to the engine to reject.
 */
export function detectRomRequired(bytes: Uint8Array): boolean {
  return sidMagic(bytes) === "RSID";
}

/** True when running inside a real Web Worker global scope (not the main thread). */
export function isWorkerGlobalScope(): boolean {
  const scope = globalThis as unknown as { WorkerGlobalScope?: new () => unknown };
  return (
    typeof self !== "undefined" &&
    typeof scope.WorkerGlobalScope === "function" &&
    self instanceof scope.WorkerGlobalScope
  );
}

/** Normalise any thrown value into a typed worker error message. */
export function toLocalSidError(error: unknown, code: LocalSidErrorCode, id?: number): LocalSidErrorMessage {
  const message = error instanceof Error ? error.message : String(error);
  return id === undefined ? { type: "error", code, message } : { type: "error", code, id, message };
}
