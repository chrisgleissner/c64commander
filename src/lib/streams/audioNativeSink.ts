/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Native low-latency audio sink — the TypeScript face of the Android `AudioTrack` adapter in
 * StreamUdpPlugin. It replaces the WebAudio player, but crucially it does NOT feed audio from the JS
 * thread: the plugin's native receive thread (URGENT_AUDIO) writes each decoded audio packet straight
 * into the AudioTrack. So opening this sink simply arms that native feed — playback never crosses the
 * Capacitor bridge.
 *
 * Why native-fed and not JS-fed: feeding the track from JS (one bridge write per ~16 ms) measurably
 * stalled the JS event loop — the A/V-sync analyzer callback was delayed ~50 ms (press→hear 68→120 ms
 * on the Pixel 4) — and the JS↔video-paint contention forced a large jitter buffer. Feeding natively
 * removes the bridge traffic (press→hear stays ~68 ms) and the contention (a small, low-latency buffer
 * holds without underruns while video paints), so the audio latency actually drops.
 *
 * All the audio SMARTS still live in TypeScript: the A/V-sync analyzer is fed from the same datagrams
 * (the plugin still emits them); only the final speaker sink is native. This class just opens the
 * track (with a buffer-depth target), polls its depth/underruns for the governor, and closes it.
 */

import { addLog } from "@/lib/logging";
import { StreamUdp } from "@/lib/native/streamUdp";

/** How often to poll the native track's buffer/underrun stats for the governor (ms). */
export const NATIVE_AUDIO_STATS_POLL_MS = 250;

export interface NativeAudioStats {
  /** PCM still queued ahead of the AudioTrack playback head (ms). */
  bufferedMs: number;
  /** Cumulative AudioTrack underruns since {@link NativeAudioSink.open}. */
  underruns: number;
}

/** Minimal plugin surface the sink needs — injectable so the sink is unit-testable without Capacitor. */
export interface NativeAudioBackend {
  openAudioTrack(options: { sampleRate: number; bufferMs?: number }): Promise<{ sampleRate: number; bufferMs: number }>;
  readAudioStats(options?: Record<string, never>): Promise<NativeAudioStats>;
  closeAudioTrack(options?: Record<string, never>): Promise<void>;
}

const defaultBackend: NativeAudioBackend = StreamUdp;

export class NativeAudioSink {
  private opened = false;
  private closed = false;
  private stats: NativeAudioStats = { bufferedMs: 0, underruns: 0 };
  /** AudioTrack buffer capacity (ms) reported at open — the sink's worst-case added latency. */
  private capacityMs = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sampleRate: number,
    private readonly backend: NativeAudioBackend = defaultBackend,
    /** Target buffer depth (ms) = the native audio latency; 0 → the platform minimum buffer. */
    private readonly targetBufferMs: number = 0,
    private readonly pollMs: number = NATIVE_AUDIO_STATS_POLL_MS,
  ) {}

  /**
   * Open (and arm) the native track. Returns false (and logs) if the platform/plugin can't provide
   * one. Once open, the plugin's receive thread feeds it directly; JS only polls its stats.
   */
  async open(): Promise<boolean> {
    try {
      const result = await this.backend.openAudioTrack({
        sampleRate: Math.round(this.sampleRate),
        bufferMs: this.targetBufferMs > 0 ? Math.round(this.targetBufferMs) : undefined,
      });
      this.capacityMs = result.bufferMs;
      this.opened = true;
      this.pollTimer = setInterval(() => void this.poll(), this.pollMs);
      return true;
    } catch (error) {
      addLog("warn", "Native audio: AudioTrack open failed; falling back to WebAudio", {
        error: (error as Error)?.message ?? String(error),
      });
      return false;
    }
  }

  /** Worst-case buffer the native track can hold (ms), reported at open. */
  get bufferCapacityMs(): number {
    return this.capacityMs;
  }

  private async poll(): Promise<void> {
    if (this.closed || !this.opened) return;
    try {
      this.stats = await this.backend.readAudioStats();
    } catch (error) {
      addLog("debug", "Native audio: stats poll failed (ignored)", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  /** Latest native buffer depth + underruns (from the periodic poll) for the governor. */
  getStats(): NativeAudioStats {
    return this.stats;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.opened = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      await this.backend.closeAudioTrack();
    } catch (error) {
      addLog("debug", "Native audio: AudioTrack close failed (ignored)", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
}
