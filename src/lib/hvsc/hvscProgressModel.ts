/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * One honest progress figure for installing HVSC.
 *
 * The bar used to show whichever stage was running, each counting 0 to 100 of its own. So it filled
 * during the download, snapped back to nothing, filled again while the archive extracted, snapped
 * back, and filled a third time while the songs were indexed — reaching 100% three times without
 * finishing. Worse, the download half did not move at all until it was over (the native download was
 * never asked to report progress), so the first and longest stage was a bar sitting at zero.
 *
 * This turns the two things actually being counted — **bytes fetched** and **songs indexed** — into a
 * single fraction that only ever goes forwards.
 *
 * The weights are wall-clock shares, not equal thirds, because the two halves are nothing like equal:
 * a full install pulls ~81 MiB before it can index ~62,000 songs, while an update pulls ~3.5 MiB and
 * indexes a few hundred. Splitting them evenly would park the bar at 50% through the part that
 * dominates the wait.
 *
 * Where a real total is not known yet the expected one stands in, so the bar is meaningful from the
 * first byte rather than waiting for a `Content-Length` that may never arrive.
 */

/** What an HVSC fetch is: the whole corpus, or the weekly update on top of it. */
export type HvscArchiveKind = "full" | "update";

/**
 * Expected archive sizes, used until the server states one.
 *
 * HVSC #85 is a little over 81 MiB packed; the weekly update is a few megabytes. These only have to
 * be the right order of magnitude — a real `Content-Length` replaces them as soon as it arrives, and
 * the estimate is clamped so an under-estimate cannot show more than 99% while bytes are still
 * coming in.
 */
export const EXPECTED_ARCHIVE_BYTES: Record<HvscArchiveKind, number> = {
  full: 81 * 1024 * 1024,
  update: 3.5 * 1024 * 1024,
};

/** Expected song counts, used until enumeration reports the real one. */
export const EXPECTED_SONG_COUNT: Record<HvscArchiveKind, number> = {
  full: 62_000,
  update: 500,
};

/**
 * Share of the wait the download accounts for.
 *
 * A full install spends most of its time fetching 81 MiB; an update fetches almost nothing and spends
 * its time indexing. Measured roughly on a Pixel 4 over Wi-Fi and deliberately kept coarse — the
 * point is that neither half is allowed to dominate the bar out of proportion to how long it takes.
 */
export const DOWNLOAD_WEIGHT: Record<HvscArchiveKind, number> = {
  full: 0.55,
  update: 0.15,
};

export interface HvscProgressInput {
  kind: HvscArchiveKind;
  /** Bytes fetched so far, if known. */
  downloadedBytes?: number | null;
  /** Total bytes, if the server stated one. Falls back to {@link EXPECTED_ARCHIVE_BYTES}. */
  totalBytes?: number | null;
  /** True once the archive is fully fetched, whatever the byte counters say. */
  downloadComplete?: boolean;
  /** Songs indexed so far, if known. */
  indexedSongs?: number | null;
  /** Total songs, once enumeration reports it. Falls back to {@link EXPECTED_SONG_COUNT}. */
  totalSongs?: number | null;
  /** True once indexing has finished. */
  indexComplete?: boolean;
}

const fraction = (done: number | null | undefined, total: number, complete: boolean | undefined) => {
  if (complete) return 1;
  if (done === null || done === undefined || total <= 0) return 0;
  // Clamped below 1: only the explicit completion flag may say "finished", so an under-estimated
  // total cannot let a stage claim to be done while it is still working.
  return Math.min(0.999, Math.max(0, done / total));
};

/**
 * The overall fraction complete, 0–1.
 *
 * Deliberately not monotonic on its own — a caller that replays events out of order would see it
 * move backwards, which is a real signal worth keeping. {@link monotonicPercent} is the guard for
 * the one place it matters, the bar itself.
 */
export const overallPreparationFraction = (input: HvscProgressInput): number => {
  const weight = DOWNLOAD_WEIGHT[input.kind];
  const downloadTotal =
    input.totalBytes && input.totalBytes > 0 ? input.totalBytes : EXPECTED_ARCHIVE_BYTES[input.kind];
  const indexTotal = input.totalSongs && input.totalSongs > 0 ? input.totalSongs : EXPECTED_SONG_COUNT[input.kind];

  const downloaded = fraction(input.downloadedBytes, downloadTotal, input.downloadComplete);
  const indexed = fraction(input.indexedSongs, indexTotal, input.indexComplete);

  if (input.downloadComplete && input.indexComplete) return 1;
  return weight * downloaded + (1 - weight) * indexed;
};

/** The same as a rounded percentage. */
export const overallPreparationPercent = (input: HvscProgressInput): number =>
  Math.round(overallPreparationFraction(input) * 100);

/**
 * Keep a displayed percentage from ever going backwards.
 *
 * The underlying numbers legitimately jump around: a `Content-Length` arriving mid-download changes
 * the denominator, and enumeration replaces an estimated song count with a real one. A bar that
 * retreats reads as a fault even when the estimate merely got better, so the display holds its
 * high-water mark — except at completion, and on a reset to zero for a fresh run.
 */
export const monotonicPercent = (previous: number | null, next: number): number => {
  if (next <= 0) return next;
  if (previous === null) return next;
  return Math.max(previous, next);
};
