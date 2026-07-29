/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The bar used to show whichever stage was running, each counting 0 to 100 of its own — so it filled
 * during the download, snapped back, filled again through extraction, snapped back, and filled a
 * third time while indexing. It reached 100% three times without finishing, and the download half sat
 * at zero throughout because the native download was never asked to report progress.
 */

import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_WEIGHT,
  EXPECTED_ARCHIVE_BYTES,
  EXTRACTION_SHARE,
  EXPECTED_SONG_COUNT,
  monotonicPercent,
  overallPreparationPercent,
} from "@/lib/hvsc/hvscProgressModel";

describe("one progress figure for installing HVSC", () => {
  it("moves from the first byte, before any Content-Length arrives", () => {
    // The download is the longest part of a full install. A bar that cannot start until the server
    // states a size is a bar that sits at zero through the whole wait.
    const percent = overallPreparationPercent({
      kind: "full",
      downloadedBytes: EXPECTED_ARCHIVE_BYTES.full / 2,
      totalBytes: null,
    });
    expect(percent).toBeGreaterThan(20);
    expect(percent).toBeLessThan(35);
  });

  it("prefers the real total once the server states one", () => {
    const withReal = overallPreparationPercent({
      kind: "full",
      downloadedBytes: 40 * 1024 * 1024,
      totalBytes: 40 * 1024 * 1024 * 2,
    });
    expect(withReal).toBe(Math.round(DOWNLOAD_WEIGHT.full * 0.5 * 100));
  });

  it("never reaches 100% until BOTH halves are done", () => {
    // The old bar hit 100% at the end of every stage. This is the property that stops that.
    const downloadedOnly = overallPreparationPercent({
      kind: "full",
      downloadedBytes: EXPECTED_ARCHIVE_BYTES.full,
      totalBytes: EXPECTED_ARCHIVE_BYTES.full,
      downloadComplete: true,
    });
    expect(downloadedOnly).toBeLessThan(100);

    const indexedToo = overallPreparationPercent({
      kind: "full",
      downloadComplete: true,
      indexedSongs: EXPECTED_SONG_COUNT.full,
      totalSongs: EXPECTED_SONG_COUNT.full,
      indexComplete: true,
    });
    expect(indexedToo).toBe(100);
  });

  it("cannot claim a stage is finished on an estimate alone", () => {
    // An under-estimated size would otherwise let the download read 100% while bytes were still
    // arriving — which is exactly how a bar loses the user's trust.
    const percent = overallPreparationPercent({
      kind: "update",
      downloadedBytes: EXPECTED_ARCHIVE_BYTES.update * 4,
      totalBytes: null,
    });
    expect(percent).toBeLessThan(Math.round(DOWNLOAD_WEIGHT.update * 100) + 1);
  });

  it("weights the download by how long it actually takes, which differs by archive", () => {
    // A full install pulls ~81 MiB before indexing ~62,000 songs; an update pulls a few megabytes and
    // indexes a few hundred. Equal thirds would park the bar in the middle of the part that dominates.
    const halfDownloaded = (kind: "full" | "update") =>
      overallPreparationPercent({
        kind,
        downloadedBytes: EXPECTED_ARCHIVE_BYTES[kind] / 2,
        totalBytes: EXPECTED_ARCHIVE_BYTES[kind],
      });
    expect(halfDownloaded("full")).toBeGreaterThan(halfDownloaded("update"));
  });

  it("counts indexing against the expected song count before enumeration reports one", () => {
    const percent = overallPreparationPercent({
      kind: "full",
      downloadComplete: true,
      indexedSongs: EXPECTED_SONG_COUNT.full / 2,
      totalSongs: null,
    });
    // The whole download share, plus the metadata pass's part of the indexing share. The indexing
    // half is itself split between unpacking and reading metadata, so half the songs indexed with
    // nothing extracted is half of the metadata portion, not half of indexing.
    const expected = DOWNLOAD_WEIGHT.full + (1 - DOWNLOAD_WEIGHT.full) * (1 - EXTRACTION_SHARE) * 0.5;
    expect(percent).toBe(Math.round(expected * 100));
  });
});

describe("it keeps advancing all the way through", () => {
  /**
   * The bar reached the download's share and then stopped dead for the whole ingest. Two counters
   * were at fault: the song totals it read are only written once ingestion FINISHES, so they were
   * zero throughout, and they default to 0 rather than null so the fallback never engaged.
   */
  const at = (input: Parameters<typeof overallPreparationPercent>[0]) => overallPreparationPercent(input);

  it("rises monotonically across a whole full install", () => {
    const timeline = [
      // Fetching.
      { kind: "full" as const, downloadedBytes: 0, totalBytes: EXPECTED_ARCHIVE_BYTES.full },
      { kind: "full" as const, downloadedBytes: 20 * 1024 * 1024, totalBytes: EXPECTED_ARCHIVE_BYTES.full },
      { kind: "full" as const, downloadedBytes: 81 * 1024 * 1024, totalBytes: EXPECTED_ARCHIVE_BYTES.full },
      // Unpacking.
      { kind: "full" as const, downloadComplete: true, extractedFiles: 0, totalFiles: 62_000 },
      { kind: "full" as const, downloadComplete: true, extractedFiles: 31_000, totalFiles: 62_000 },
      { kind: "full" as const, downloadComplete: true, extractedFiles: 62_000, totalFiles: 62_000 },
      // Reading metadata — the stretch that used to be frozen.
      { kind: "full" as const, downloadComplete: true, extractedFiles: 62_000, totalFiles: 62_000, indexPercent: 1 },
      { kind: "full" as const, downloadComplete: true, extractedFiles: 62_000, totalFiles: 62_000, indexPercent: 50 },
      { kind: "full" as const, downloadComplete: true, extractedFiles: 62_000, totalFiles: 62_000, indexPercent: 99 },
      // Reachable.
      { kind: "full" as const, downloadComplete: true, indexComplete: true },
    ];
    const seen = timeline.map(at);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    // And it genuinely travels rather than nudging: no two-thirds of the run stuck on one number.
    expect(new Set(seen).size).toBeGreaterThan(6);
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen[seen.length - 2]).toBeLessThan(100);
  });

  it("does not stall at the download's share once the download is done", () => {
    // The exact symptom: 55% and then nothing for the entire ingest.
    const justDownloaded = at({ kind: "full", downloadComplete: true });
    const partwayThroughIndexing = at({ kind: "full", downloadComplete: true, indexPercent: 40 });
    expect(partwayThroughIndexing).toBeGreaterThan(justDownloaded);
  });

  it("reaches 100 only when the library is actually reachable", () => {
    // Every stage reporting done is not the same as the job being done.
    expect(
      at({
        kind: "full",
        downloadComplete: true,
        extractedFiles: 62_000,
        totalFiles: 62_000,
        indexPercent: 100,
      }),
    ).toBeLessThan(100);
    expect(at({ kind: "full", downloadComplete: true, indexComplete: true })).toBe(100);
  });
});

describe("the displayed percentage holds its high-water mark", () => {
  it("does not retreat when a better estimate arrives", () => {
    // A Content-Length landing mid-download changes the denominator, and enumeration replaces an
    // estimated song count with a real one. A bar going backwards reads as a fault even when the
    // estimate merely improved.
    expect(monotonicPercent(40, 32)).toBe(40);
  });

  it("still advances", () => {
    expect(monotonicPercent(40, 55)).toBe(55);
  });

  it("resets to zero for a fresh run", () => {
    expect(monotonicPercent(90, 0)).toBe(0);
  });
});
