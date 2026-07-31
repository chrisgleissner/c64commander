/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Typed message contract for the Local SID engine Web Worker (spec §12.2, Track
 * B / LE1). The WASM synth (`libsidplayfp-wasm`'s `SidAudioEngine`) runs
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

/**
 * A SID revision in libsidplayfp's own spelling, which is what the engine's `SidConfig` takes.
 *
 * The app spells the same two chips `6581` / `8580` everywhere a person reads them; the
 * translation happens once, in {@link toEngineSidModel}, so the worker never has to know about the
 * app's settings vocabulary.
 */
export type EngineSidModel = "MOS6581" | "MOS8580";

export const toEngineSidModel = (model: "6581" | "8580"): EngineSidModel => (model === "6581" ? "MOS6581" : "MOS8580");

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
  /**
   * The chip to assume for a tune whose header does not name one.
   *
   * A **fallback**, never an override: libsidplayfp reads the model out of the tune's own header,
   * per chip, and only consults this where the header says `UNKNOWN` or `ANY`. The worker
   * therefore sets `sidModel` and leaves `forceSidModel` alone — forcing it would silence every
   * tune's own declaration, including the per-chip models of a 2SID or 3SID file.
   *
   * Passed per-open for the same reason the ROMs are: it keeps the worker stateless about the
   * setting, so changing it in Settings applies from the very next tune.
   */
  sidModel?: EngineSidModel;
}

/** main → worker: render the next `seconds` of PCM for the open tune. */
export interface LocalSidRenderMessage {
  type: "render";
  /** Correlates the response to this request. */
  id: number;
  /** Chunk length in seconds of audio to render this call. */
  seconds: number;
}

/**
 * main → worker: jump to an absolute position in the open tune.
 *
 * Absolute rather than relative because the engine's own `seekSeconds` is
 * absolute, and because the main thread owns the playback clock — making the
 * worker track position too would give two sources of truth that can drift.
 * Seeking backwards is inherently slower than forwards: the engine reloads the
 * tune and re-renders up to the target.
 */
export interface LocalSidSeekMessage {
  type: "seek";
  /** Correlates the response to this request. */
  id: number;
  positionSeconds: number;
}

/** main → worker: dispose the open tune + engine, freeing WASM memory. */
export interface LocalSidCloseMessage {
  type: "close";
}

export type LocalSidMainToWorker =
  | LocalSidLoadMessage
  | LocalSidOpenMessage
  | LocalSidRenderMessage
  | LocalSidSeekMessage
  | LocalSidPrerenderMessage
  | LocalSidCloseMessage;

/** worker → main: the seek completed; rendering resumes from `positionSeconds`. */
export interface LocalSidSeekedMessage {
  type: "seeked";
  id: number;
  /** Where the engine actually landed, which may differ from the request. */
  positionSeconds: number;
}

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
  /**
   * Where the open actually spent its time. Opening dominates `skipToLaunchMs`
   * (§9.2), and a single total cannot distinguish a slow WASM instantiation
   * from a slow tune load — those have opposite fixes. Absent when the tune
   * needed ROMs we do not have, since nothing was opened.
   */
  openTiming?: {
    /** Fetching/compiling the WASM module (cached after the first open). */
    moduleMs: number;
    /** Constructing a fresh SidAudioEngine instance. */
    constructMs: number;
    /** Copying the KERNAL/BASIC images in. */
    romsMs: number;
    /** Parsing the SID and preparing the tune. */
    loadMs: number;
  };
}

/**
 * main → worker: render the WHOLE tune ahead of time.
 *
 * Rendered separately from playback: the playing engine is a single stateful
 * WASM instance whose position advances as it renders, so it cannot also be
 * asked to render the future without disturbing what is being heard. The worker
 * therefore opens a SECOND engine for this, and streams progress back so a long
 * tune does not look frozen.
 */
export interface LocalSidPrerenderMessage {
  type: "prerender";
  id: number;
  sidBytes: ArrayBuffer;
  songIndex: number;
  sampleRate: number;
  /** How much audio to produce; the tune's resolved songlength. */
  seconds: number;
  roms?: { kernal: ArrayBuffer; basic: ArrayBuffer };
  /**
   * The same fallback chip the playing engine is using — see {@link LocalSidOpenMessage.sidModel}.
   *
   * It has to be the same value, or the cached render and the live render of one tune would be two
   * different performances, and the handover between them would be audible.
   */
  sidModel?: EngineSidModel;
}

/** worker → main: how far a pre-render has got (0..1). */
/**
 * One slice of a pre-render, sent as it is produced.
 *
 * Streamed rather than held to the end so the cache grows while the render runs: a seek into the part
 * already rendered is then instant, instead of waiting for the whole tune. libsidplayfp cannot rewind,
 * so reaching a position means rendering everything before it — roughly 150 ms of CPU per second of
 * audio on a Pixel 4, which is why what has been rendered is worth using the moment it exists.
 */
export interface LocalSidPrerenderChunkMessage {
  type: "prerender-chunk";
  id: number;
  pcm: Int16Array;
  sampleRate: number;
  channels: number;
  /** Seconds rendered so far, this slice included. */
  seconds: number;
}

export interface LocalSidPrerenderProgressMessage {
  type: "prerender-progress";
  id: number;
  fraction: number;
}

/** worker → main: the finished pre-render. */
export interface LocalSidPrerenderedMessage {
  type: "prerendered";
  id: number;
  sampleRate: number;
  channels: number;
  seconds: number;
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

export type LocalSidErrorCode = "load" | "open" | "render" | "prerender" | "unsupported";

/** worker → main: a fatal error, optionally correlated to a request. */
export interface LocalSidErrorMessage {
  type: "error";
  id?: number;
  code: LocalSidErrorCode;
  message: string;
}

export type LocalSidWorkerToMain =
  | LocalSidReadyMessage
  | LocalSidOpenedMessage
  | LocalSidChunkMessage
  | LocalSidSeekedMessage
  | LocalSidEndMessage
  | LocalSidPrerenderChunkMessage
  | LocalSidPrerenderProgressMessage
  | LocalSidPrerenderedMessage
  | LocalSidErrorMessage;
