/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { ensureStilReady, getHvscSubsongDurationsSeconds, getHvscSubsongTitles } from "@/lib/hvsc";
import { addErrorLog } from "@/lib/logging";

export type FileTune = {
  /** 1-based, as the format numbers them. */
  songNr: number;
  /** What STIL calls this tune, where it names it. Absent for most of the archive. */
  title: string | null;
  /** This tune's own length. Absent where the archive does not know it. */
  durationMs: number | null;
};

export type UseFileTunesParams = {
  /** The HVSC path of the file, or null when what is playing did not come from HVSC. */
  virtualPath: string | null;
  tuneCount: number;
  /** Resolved only while the list is actually being looked at. */
  enabled: boolean;
};

/**
 * Every tune in one SID file, as a list worth showing.
 *
 * The tune numbers alone are already known — the file says how many it holds — so this exists for
 * the two things that make the list navigable rather than a row of numbers: what each tune is
 * called, and how long it is. Both are per tune and both are frequently absent, and a row that
 * says only "Tune 12" is still a legitimate row.
 *
 * Resolved when the list is opened rather than kept current, because nothing about it changes while
 * a file plays and the alternative is two archive lookups per track change.
 */
export const useFileTunes = ({ virtualPath, tuneCount, enabled }: UseFileTunesParams) => {
  const [tunes, setTunes] = useState<FileTune[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || tuneCount <= 0) {
      setTunes([]);
      return;
    }
    let cancelled = false;
    // Numbers first, so the list is complete and tappable immediately; names and lengths fill in.
    const base = Array.from({ length: tuneCount }, (_, index): FileTune => ({
      songNr: index + 1,
      title: null,
      durationMs: null,
    }));
    setTunes(base);

    // A file from a device, a local folder or an archive holds its tunes just the same and they
    // play just the same; only the names and the lengths live in HVSC. Listing the numbers is the
    // whole feature for those files, so the lookup is skipped rather than the list.
    if (!virtualPath) return;
    setLoading(true);

    void (async () => {
      try {
        await ensureStilReady();
        if (cancelled) return;
        const [titles, seconds] = await Promise.all([
          getHvscSubsongTitles(virtualPath, tuneCount),
          getHvscSubsongDurationsSeconds(virtualPath),
        ]);
        if (cancelled) return;
        setTunes(
          base.map((tune) => {
            const title = titles[tune.songNr - 1]?.trim();
            const durationSeconds = seconds[tune.songNr - 1];
            return {
              songNr: tune.songNr,
              title: title ? title : null,
              durationMs:
                typeof durationSeconds === "number" && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
            };
          }),
        );
      } catch (error) {
        if (cancelled) return;
        // The numbered rows are already on screen and still work; only the names and lengths are
        // lost, so this must not empty the list.
        addErrorLog("Failed to resolve the tunes in a file", { virtualPath, error: (error as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, tuneCount, virtualPath]);

  return { tunes, loading };
};
