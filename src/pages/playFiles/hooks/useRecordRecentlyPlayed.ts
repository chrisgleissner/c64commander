/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";

import {
  loadRecentlyPlayed,
  saveRecentlyPlayed,
  toRecentlyPlayedEntry,
  withRecentlyPlayed,
  type RecentlyPlayedEntry,
} from "@/lib/sidRadio/recentlyPlayed";
import { isSongCategory } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

/** The composer read from a tune's SID header, and the playlist item it was read from. */
export type ItemCredits = { itemId: string | null; author: string | null };

export const buildRecentlyPlayedEntry = (
  item: PlaylistItem,
  title: string,
  author: string | null,
  playedAt?: number,
): RecentlyPlayedEntry => {
  // A disk or a program is reopened by its source path, so it carries its source; an archive tune's
  // path is meaningful on its own.
  const isArchiveTune = isSongCategory(item.category) && item.request.source === "hvsc";
  const category = item.category === "disk" ? "disk" : isSongCategory(item.category) ? "sid" : "program";
  return toRecentlyPlayedEntry({
    virtualPath: item.path,
    title,
    author,
    category,
    ...(isArchiveTune ? {} : { source: item.request.source }),
    ...(isArchiveTune || !item.sourceId ? {} : { sourceId: item.sourceId }),
    songNr: item.request.songNr,
    subsongCount: item.subsongCount,
    durationMs: item.durationMs,
    playedAt,
  });
};

const record = (entry: RecentlyPlayedEntry) => saveRecentlyPlayed(withRecentlyPlayed(loadRecentlyPlayed(), entry));

/**
 * Records each track instance in Recently played, and corrects its row once the tune's own credits
 * arrive. The credits are read asynchronously after the tune starts, so when a new instance begins
 * they can still hold the previous tune's composer; only credits read from this item are used.
 */
export const useRecordRecentlyPlayed = ({
  trackInstanceId,
  item,
  title,
  credits,
}: {
  trackInstanceId: number;
  item: PlaylistItem | null | undefined;
  title: string | null | undefined;
  credits: ItemCredits;
}) => {
  const recordedRef = useRef<{ itemId: string; entry: RecentlyPlayedEntry } | null>(null);

  useEffect(() => {
    if (!item?.path) return;
    const author = credits.itemId === item.id ? credits.author : null;
    const entry = buildRecentlyPlayedEntry(item, title ?? item.label, author);
    recordedRef.current = { itemId: item.id, entry };
    record(entry);
    // A re-render of the same instance is not a new hearing; the same tune coming round again is.
  }, [trackInstanceId]);

  useEffect(() => {
    const recorded = recordedRef.current;
    if (!recorded || !item || item.id !== recorded.itemId || credits.itemId !== recorded.itemId) return;
    const entry = buildRecentlyPlayedEntry(item, title ?? item.label, credits.author, recorded.entry.playedAt);
    if (entry.author === recorded.entry.author && entry.title === recorded.entry.title) return;
    recordedRef.current = { itemId: recorded.itemId, entry };
    record(entry);
  }, [credits]);
};
