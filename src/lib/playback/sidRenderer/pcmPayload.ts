/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Rendered PCM as the playback engine sees it.
 *
 * The WASM renderers hand back interleaved stereo `Int16Array`s. libSidplayEZ renders into buffers
 * that stay on the native side, and hands back a reference: the engine schedules, caches, slices
 * and discards it like any other chunk, and only the native audio feed ever reads the samples.
 * Everything here is interleaved signed 16-bit little-endian stereo at the renderer's sample rate.
 */
export interface NativePcmRef {
  readonly kind: "native-pcm";
  readonly bufferId: number;
  readonly startFrame: number;
  readonly frames: number;
}

export type PcmPayload = Int16Array | NativePcmRef;

export const isNativePcm = (payload: unknown): payload is NativePcmRef =>
  typeof payload === "object" &&
  payload !== null &&
  !ArrayBuffer.isView(payload) &&
  (payload as { kind?: unknown }).kind === "native-pcm";

/** Frames in a payload; a JS buffer's are counted from its samples. */
export const payloadFrames = (payload: PcmPayload, channels: number): number =>
  isNativePcm(payload) ? payload.frames : Math.floor(payload.length / Math.max(1, channels));

/** Samples (frames × channels) in a payload, the unit the engine's cursors count in. */
export const payloadSamples = (payload: PcmPayload, channels: number): number =>
  isNativePcm(payload) ? payload.frames * channels : payload.length;

/**
 * A pre-rendered tune held natively, presented with the slice of `Int16Array` the render cache and
 * the engine's cache cursor use: `length` and `byteLength` in samples and bytes, and `slice` /
 * `subarray` by sample index, which become frame ranges of the same native buffer.
 */
export class NativePcmBuffer {
  constructor(
    readonly bufferId: number,
    readonly frames: number,
    readonly channels: number = 2,
  ) {}

  get length(): number {
    return this.frames * this.channels;
  }

  get byteLength(): number {
    return this.length * 2;
  }

  /** The samples [start, end) as a reference into this buffer. */
  slice(startSample = 0, endSample = this.length): NativePcmRef {
    const startFrame = Math.max(0, Math.floor(startSample / this.channels));
    const endFrame = Math.min(this.frames, Math.floor(endSample / this.channels));
    return { kind: "native-pcm", bufferId: this.bufferId, startFrame, frames: Math.max(0, endFrame - startFrame) };
  }

  /** A view of the first `endSample` samples; only prefixes are ever taken. */
  subarray(startSample: number, endSample: number = this.length): NativePcmBuffer {
    if (startSample !== 0) throw new Error("A native PCM buffer can only be viewed from its start");
    return new NativePcmBuffer(
      this.bufferId,
      Math.min(this.frames, Math.floor(endSample / this.channels)),
      this.channels,
    );
  }
}

/** What a render-cache entry holds. */
export type CachedPcm = Int16Array | NativePcmBuffer;

export const isNativeCachedPcm = (pcm: CachedPcm): pcm is NativePcmBuffer => pcm instanceof NativePcmBuffer;
