/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { PlaylistItem } from "@/pages/playFiles/types";

export const PREFETCH_BEFORE_END_MS = 45_000;
export const PREFETCH_SETTLE_MS = 3_000;
export const PREFETCH_TIMEOUT_MS = 10_000;
export const PREFETCH_RETRY_MS = 30_000;
export const PREFETCH_MAX_ENTRIES = 2;
export const PREFETCH_MAX_BYTES = 2 * 1024 * 1024;

export interface NextTunePrefetchDeps {
  /** Reads the item's bytes from the Ultimate. Must resolve to null when the read fails. */
  fetchBlob: (item: PlaylistItem, signal: AbortSignal) => Promise<Blob | null>;
  /** True only when no other request is using the device and it has answered recently. */
  isDeviceReady: () => boolean;
  /** Called after bytes were stored, so the lead-in of that tune can be rendered. */
  onStored: () => void;
}

/** Only an SID that lives on the connected Ultimate has bytes that are not already on this phone. */
export const needsPrefetch = (item: PlaylistItem | undefined | null): item is PlaylistItem =>
  Boolean(item) && item!.category === "sid" && item!.request.source === "ultimate" && !item!.request.file;

/**
 * Reads the bytes of the next queue item from the Ultimate shortly before the current tune ends, so the
 * tune change does not wait for an FTP read. At most one read is in flight, it is abandoned after
 * `PREFETCH_TIMEOUT_MS`, and a failed or deferred attempt is repeated once after `PREFETCH_RETRY_MS`.
 */
export class NextTunePrefetcher {
  private readonly stored = new Map<string, Blob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private active: Promise<void> = Promise.resolve();

  constructor(private readonly deps: NextTunePrefetchDeps) {}

  /** Plans the read of `next` for when the current tune, `currentDurationMs` long, is close to its end. */
  schedule(next: PlaylistItem | undefined | null, currentDurationMs: number | null): void {
    this.cancel();
    for (const id of [...this.stored.keys()]) if (id !== next?.id) this.stored.delete(id);
    if (!needsPrefetch(next) || this.stored.has(next.id)) return;
    const untilWindowMs = currentDurationMs === null ? 0 : currentDurationMs - PREFETCH_BEFORE_END_MS;
    this.arm(next, 0, Math.max(PREFETCH_SETTLE_MS, untilWindowMs));
  }

  /** Stops a pending or running read. Bytes already stored are kept. */
  cancel(): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  /** Cancels and forgets everything, for Stop and unmount. */
  clear(): void {
    this.cancel();
    this.stored.clear();
  }

  peek(id: string): Blob | null {
    return this.stored.get(id) ?? null;
  }

  /** Hands over the bytes for starting the tune, which is the last use of them. */
  take(id: string): Blob | null {
    const blob = this.stored.get(id) ?? null;
    this.stored.delete(id);
    return blob;
  }

  private arm(item: PlaylistItem, attempt: number, delayMs: number): void {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(item, attempt, generation);
    }, delayMs);
  }

  private async run(item: PlaylistItem, attempt: number, generation: number): Promise<void> {
    await this.active;
    if (generation !== this.generation) return;
    this.active = this.fetchOnce(item, attempt, generation);
    await this.active;
  }

  private async fetchOnce(item: PlaylistItem, attempt: number, generation: number): Promise<void> {
    if (!this.deps.isDeviceReady()) {
      this.retryOnce(item, attempt, "device busy or not answering recently");
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(new Error(`timed out after ${PREFETCH_TIMEOUT_MS} ms`));
      }, PREFETCH_TIMEOUT_MS);
    });
    try {
      const blob = await Promise.race([this.deps.fetchBlob(item, abort.signal), timedOut]);
      if (generation !== this.generation) return;
      if (!blob) {
        this.retryOnce(item, attempt, "the read returned no bytes");
        return;
      }
      this.store(item, blob);
    } catch (error) {
      if (generation !== this.generation) return;
      this.retryOnce(item, attempt, (error as Error)?.message ?? String(error));
    } finally {
      clearTimeout(timeout);
      if (this.abort === abort) this.abort = null;
    }
  }

  private store(item: PlaylistItem, blob: Blob): void {
    if (blob.size > PREFETCH_MAX_BYTES) {
      addLog("warn", "Next tune prefetch: file too large to keep", { item: item.label, bytes: blob.size });
      return;
    }
    this.stored.delete(item.id);
    this.stored.set(item.id, blob);
    const totalBytes = () => [...this.stored.values()].reduce((sum, entry) => sum + entry.size, 0);
    while (this.stored.size > PREFETCH_MAX_ENTRIES || totalBytes() > PREFETCH_MAX_BYTES) {
      this.stored.delete(this.stored.keys().next().value as string);
    }
    addLog("info", "Next tune prefetched", { service: "local-sid", item: item.label, bytes: blob.size });
    this.deps.onStored();
  }

  private retryOnce(item: PlaylistItem, attempt: number, reason: string): void {
    addLog("warn", "Next tune prefetch failed", {
      service: "local-sid",
      item: item.label,
      attempt: attempt + 1,
      reason,
      willRetry: attempt === 0,
    });
    if (attempt === 0) this.arm(item, 1, PREFETCH_RETRY_MS);
  }
}
