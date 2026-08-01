/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import { ensureStilReady, getStilInfo, primaryCredit, stripSectionTimestamp, type StilInfo } from "@/lib/hvsc";
import { addErrorLog } from "@/lib/logging";

export type StilDisplay = {
  /** What STIL calls this tune, when it names it. */
  title: string | null;
  /**
   * Who wrote the music, when that is someone other than whoever made the C64 version.
   *
   * This is the field with no equivalent anywhere else: a SID header names the person who did the
   * conversion, so for the large share of C64 music that is a cover, the composer shown until now
   * has been the arranger.
   */
  originalArtist: string | null;
  /** Editorial prose about the tune. Unbounded in length; see `TuneNotes`. */
  note: string | null;
};

const EMPTY: StilDisplay = { title: null, originalArtist: null, note: null };

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const toStilDisplay = (info: StilInfo | null): StilDisplay => {
  if (!info) return EMPTY;
  const credit = primaryCredit(info);
  const title = clean(credit?.title);
  return {
    title: (title ? clean(stripSectionTimestamp(title)) : null) ?? clean(info.name),
    originalArtist: clean(credit?.artist),
    note: clean(info.comment),
  };
};

export type UseStilInfoParams = {
  /** The HVSC path of the tune playing, or null when what is playing did not come from HVSC. */
  virtualPath: string | null;
  songNr: number | undefined;
};

/**
 * What STIL says about the tune playing now.
 *
 * STIL only describes HVSC, so a tune from anywhere else resolves to nothing without touching the
 * store. The lookup is a shard read that is cached after the first tune from that shard, and
 * `ensureStilReady` downloads the document once for a library that was installed before STIL was
 * kept — after which it is on disk and nothing is fetched again.
 */
export const useStilInfo = ({ virtualPath, songNr }: UseStilInfoParams): StilDisplay => {
  const [display, setDisplay] = useState<StilDisplay>(EMPTY);

  useEffect(() => {
    if (!virtualPath) {
      setDisplay(EMPTY);
      return;
    }
    let cancelled = false;
    // Cleared rather than left showing: a stale note under a new tune reads as that tune's note.
    setDisplay(EMPTY);
    void (async () => {
      try {
        await ensureStilReady();
        if (cancelled) return;
        const info = await getStilInfo(virtualPath, songNr);
        if (cancelled) return;
        setDisplay(toStilDisplay(info));
      } catch (error) {
        if (cancelled) return;
        addErrorLog("STIL lookup failed", { virtualPath, error: (error as Error).message });
        setDisplay(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [virtualPath, songNr]);

  return display;
};
