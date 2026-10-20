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
 * Positive declaration of BASIC execution in an RSID v2+ header. There is no
 * general KERNAL requirement flag. A clear flag (including PSID) is unknown,
 * not a guarantee that execution never calls a system ROM routine.
 */
export function detectRomRequired(bytes: Uint8Array): boolean {
  return (
    sidMagic(bytes) === "RSID" &&
    bytes.length >= 0x7c &&
    bytes[4] === 0 &&
    bytes[5] >= 2 &&
    bytes[5] <= 4 &&
    (bytes[0x77] & 2) !== 0
  );
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
