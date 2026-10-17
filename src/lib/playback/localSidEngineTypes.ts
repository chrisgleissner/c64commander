/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export interface LocalSidPlayCallbacks {
  /** Playback position in seconds, emitted as chunks are scheduled/drain. */
  onPosition?: (seconds: number) => void;
  /** The tune reached its natural end and all audio drained. */
  onEnded?: () => void;
  /** A fatal engine error during playback. */
  onError?: (error: Error) => void;
  /**
   * The engine has given up on this tune and no further audio is coming.
   *
   * Distinct from {@link onEnded}, which means the tune finished normally. This fires when a stall
   * could not be repaired, so the caller can move on rather than leave a track that will produce
   * nothing for the rest of its length.
   */
  onUnrecoverable?: () => void;
}

export interface LocalSidPlayResult {
  /**
   * True when the tune needs C64 ROMs we cannot ship (spec §12.2). Playback is
   * NOT started; the caller (LE2) routes it to "Play on C64" instead.
   */
  romRequired: boolean;
  /** False when `romRequired` — no audio was started. */
  started: boolean;
  sampleRate: number;
  channels: number;
  tuneInfo: Record<string, unknown> | null;
}

export interface LocalSidStats {
  /** Average ms to render one second of audio (≥ 4× realtime ⇒ < 250, §12.6). */
  renderMsPerSec: number;
  /**
   * p99 of the per-chunk render rate — the aggregation the §12.6 budget is
   * pinned on. The running average converges and hides the spikes that
   * actually cause underruns, so the HIL asserts this instead.
   */
  renderMsPerSecP99: number;
  /** Worst-case ms/sec seen this session. */
  peakRenderMsPerSec: number;
  /** Audible gaps in the gapless schedule (target 0 over a 3-min PSID). */
  audioUnderruns: number;
  /** Seconds currently buffered ahead of the audio clock. */
  bufferedSeconds: number;
  /** Playback position in seconds. */
  positionSeconds: number;
  /** Chunks scheduled so far. */
  chunksScheduled: number;
}
