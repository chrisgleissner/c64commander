/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Typed message contract for the Local SID engine Web Worker (spec §12.2, Track
 * B / LE1). The WASM synth (`@sidflow/libsidplayfp-wasm` `SidAudioEngine`) runs
 * **only** in the worker — off the main thread by construction, the same
 * discipline as SID Radio (§4.5) — so the UI thread and Remote Input are never
 * starved by rendering ([[hvsc-hydration-starved-remote-input]]).
 *
 * A single contract test pins every shape so the main thread and worker cannot
 * drift. The worker owns the WASM module + the currently-open tune; the main
 * thread pulls PCM one **chunk** at a time (v1 chunked pre-render, D6 default —
 * no `SharedArrayBuffer`, no AudioWorklet, no COOP/COEP; the portability win for
 * the Callback 8020 / SailfishOS Android runtime).
 */

/** main → worker: instantiate the WASM module (idempotent). */
export interface LocalSidLoadMessage {
  type: "load";
  /**
   * Which SID emulation to instantiate: `residfp` (accurate, the default) or
   * `sidlite` (a ~10x cheaper approximation). The two are separate WASM
   * artifacts shipped side by side, so this is chosen before the module loads
   * and a change requires a fresh worker.
   */
  engine?: "residfp" | "sidlite";
}

/** main → worker: open a SID tune and select a song, ready to render. */
export interface LocalSidOpenMessage {
  type: "open";
  /** Correlates the response to this request. */
  id: number;
  /** Raw PSID/RSID bytes (ownership transferred). */
  sidBytes: ArrayBuffer;
  /** 0-based song index within the tune (default song otherwise). */
  songIndex: number;
  /** Requested output sample rate (the engine may return a different one). */
  sampleRate: number;
  /**
   * C64 KERNAL/BASIC images read from the user's own machine, when available.
   *
   * Not an optimisation: without them libsidplayfp initialises a tune and never
   * advances it (a flat drone — see docs/plans/sid-station/AUDIO-FIDELITY-TEST.md
   * §6.2), so absent ROMs means the tune must play on the C64 instead. Passing
   * them per-open keeps the worker stateless about ROMs, so revoking them in
   * Settings takes effect on the very next track.
   */
  roms?: { kernal: ArrayBuffer; basic: ArrayBuffer };
}

/** main → worker: render the next `seconds` of PCM for the open tune. */
export interface LocalSidRenderMessage {
  type: "render";
  /** Correlates the response to this request. */
  id: number;
  /** Chunk length in seconds of audio to render this call. */
  seconds: number;
}

/** main → worker: dispose the open tune + engine, freeing WASM memory. */
export interface LocalSidCloseMessage {
  type: "close";
}

export type LocalSidMainToWorker =
  LocalSidLoadMessage | LocalSidOpenMessage | LocalSidRenderMessage | LocalSidCloseMessage;

/** worker → main: the WASM module instantiated and is ready to open tunes. */
export interface LocalSidReadyMessage {
  type: "ready";
  /** Wall-clock ms to instantiate the WASM module (cold-load telemetry). */
  moduleLoadMs: number;
}

/** worker → main: a tune was opened; carries the true output format + ROM need. */
export interface LocalSidOpenedMessage {
  type: "opened";
  id: number;
  /** The engine's actual output sample rate (may differ from the request). */
  sampleRate: number;
  /** 1 = mono, 2 = stereo (interleaved in the PCM chunks). */
  channels: number;
  /** libsidplayfp tune metadata (title/author/released/songs), best-effort. */
  tuneInfo: Record<string, unknown> | null;
  /**
   * True when the tune needs C64 KERNAL/BASIC/CHARGEN ROMs we cannot ship
   * (spec §12.2). The controller routes these back to "Play on C64" (LE2).
   */
  romRequired: boolean;
}

/** worker → main: a rendered PCM chunk (interleaved Int16). */
export interface LocalSidChunkMessage {
  type: "chunk";
  id: number;
  /** Interleaved signed 16-bit PCM (ownership transferred back). */
  pcm: Int16Array;
  /** Total interleaved sample count (`frames * channels`). */
  samples: number;
  /** Wall-clock ms spent rendering this chunk (`renderMsPerSec` telemetry). */
  renderMs: number;
}

/** worker → main: the open tune reached its natural end (empty render). */
export interface LocalSidEndMessage {
  type: "end";
  id: number;
}

export type LocalSidErrorCode = "load" | "open" | "render" | "unsupported";

/** worker → main: a fatal error, optionally correlated to a request. */
export interface LocalSidErrorMessage {
  type: "error";
  id?: number;
  code: LocalSidErrorCode;
  message: string;
}

export type LocalSidWorkerToMain =
  LocalSidReadyMessage | LocalSidOpenedMessage | LocalSidChunkMessage | LocalSidEndMessage | LocalSidErrorMessage;
