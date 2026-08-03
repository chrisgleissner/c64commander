/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { effectiveSidEmulationEngine, resolveLocalSidModel } from "@/lib/config/appSettings";
import { hasCompleteRomSet } from "@/lib/roms/romStore";

/**
 * The cache key for one rendered tune.
 *
 * Item and tune, because two tunes of one file are different music. The `tuneIndex` is the
 * zero-based index handed to the engine, not the one-based number shown to the listener, so the key
 * names the tune that was actually rendered rather than the one that was asked for — see
 * `sidTuneIndex`.
 *
 * Everything that changes what the render SOUNDS like belongs in the key, or the cache serves audio
 * produced under settings the listener has since moved away from — and a lead-in cached under the
 * old ones hands over to live rendering under the new ones part-way through a track.
 *
 * Two things do:
 *
 *  - the fallback SID chip, for a tune whose header does not name one;
 *  - the emulation itself. reSIDfp and SIDLite do not sound alike — that difference is the whole
 *    reason the accurate one is preferred — and which is in use is not fixed for a session: it
 *    follows a Settings control, and it drops to SIDLite on its own when the ROMs are missing.
 *
 * Entries keyed to settings the listener has left are simply never read again and fall out of the
 * LRU window.
 */
export const buildRenderedTuneKey = (itemId: string, tuneIndex: number): string =>
  `${itemId}#${tuneIndex}@${resolveLocalSidModel()}/${effectiveSidEmulationEngine(hasCompleteRomSet())}`;

/**
 * A rolling cache of fully-rendered tunes, so seeking is instant.
 *
 * Seeking backwards is otherwise expensive: libsidplayfp cannot rewind, so the
 * engine reloads the tune and re-renders from the start to reach the target. On
 * a Pixel 4 that is roughly 150 ms of CPU per second of audio, i.e. ~20 s of
 * work to reach the two-minute mark. Once a tune has been rendered in full,
 * jumping anywhere inside it is a buffer offset.
 *
 * **This is expensive and the numbers matter.** Output is 48 kHz stereo 16-bit
 * = 192 KB per second, so a three-minute tune is ~35 MB. That is why the window
 * is three tunes (previous / current / next) rather than ten: ten would be a
 * third of a gigabyte. Even three is ~105 MB in the worst case, so the cache is
 * bounded by BYTES as well as by count and evicts the least-recently-used entry
 * when either limit is hit. A cache that silently grew to whatever the playlist
 * happened to contain would be an out-of-memory crash waiting for a long tune.
 */

export interface RenderedTune {
  /** Interleaved stereo Int16 PCM for the whole tune. */
  pcm: Int16Array;
  sampleRate: number;
  channels: number;
  /** Rendered length in seconds (pcm.length / channels / sampleRate). */
  durationSeconds: number;
  /**
   * True when this is only the opening of the tune, not the whole of it.
   *
   * A lead-in is cached for tracks the listener has not asked for yet — the next and the previous —
   * so that starting one does not have to out-render the speaker from a standing start. Playback must
   * hand over to live rendering when it runs out rather than treating the end of the buffer as the
   * end of the tune, which would cut the song off after a few seconds.
   */
  partial?: boolean;
}

/** previous / current / next — the window a listener can actually reach quickly. */
export const DEFAULT_MAX_TUNES = 3;

/**
 * Total PCM the cache may hold. 128 MB covers three tunes of ~3.5 minutes; past
 * that the oldest is dropped rather than risking the WebView being killed.
 */
export const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

export class RenderedTuneCache {
  /** Insertion order is LRU order: re-reading a key moves it to the end. */
  private readonly entries = new Map<string, RenderedTune>();

  /** What is cached, oldest first. For diagnosis: a warm miss is nearly always a key mismatch. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  constructor(
    private readonly maxTunes: number = DEFAULT_MAX_TUNES,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.pcm.byteLength;
    return total;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Fetch and mark as most-recently-used. */
  get(key: string): RenderedTune | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, tune: RenderedTune): void {
    // A single tune larger than the whole budget is refused rather than
    // evicting everything else to make room for something that still will not
    // fit alongside anything.
    if (tune.pcm.byteLength > this.maxBytes) {
      addLog("debug", "Rendered tune too large to cache", {
        service: "local-sid",
        key,
        bytes: tune.pcm.byteLength,
        maxBytes: this.maxBytes,
      });
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, tune);
    this.evict();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private evict(): void {
    while (this.entries.size > this.maxTunes || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
