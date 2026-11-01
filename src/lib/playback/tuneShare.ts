/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";

const DEEPSID_FILE_URL = "https://deepsid.chordian.net/?file=";
const HVSC_COLLECTION_PREFIX = "/High Voltage SID Collection";
const UNKNOWN_COMPOSER = "<?>";
const YEAR_PATTERN = /\b(?:19|20)\d\d\b/;

export type TuneShareInput = {
  title: string | null | undefined;
  composer: string | null | undefined;
  /** The SID header's released field, which holds the year and often a publisher ("1985 Elite"). */
  released: string | null | undefined;
  virtualPath: string;
  /** 1-based number of the tune within the file. */
  songNr: number;
  subsongCount: number;
};

export type TuneShare = { title: string; text: string; url: string };

/** A shareable tune together with the archive path, which the share error log needs. */
export type TuneSharePayload = TuneShare & { path: string };

const clean = (value: string | null | undefined): string => value?.trim() ?? "";

const fileStem = (virtualPath: string): string =>
  (virtualPath.split("/").filter(Boolean).pop() ?? "").replace(/\.[^.]*$/, "");

const releasedYear = (released: string | null | undefined): string | null =>
  YEAR_PATTERN.exec(clean(released))?.[0] ?? null;

const encodedArchivePath = (virtualPath: string): string => {
  const withoutCollection = virtualPath.startsWith(`${HVSC_COLLECTION_PREFIX}/`)
    ? virtualPath.slice(HVSC_COLLECTION_PREFIX.length)
    : virtualPath;
  return withoutCollection.split("/").map(encodeURIComponent).join("/");
};

/** The text and DeepSID link for one tune of an HVSC file. DeepSID counts tunes from 1 and writes `subtune` only for files that hold several. */
export const buildTuneShare = (input: TuneShareInput): TuneShare => {
  const title = clean(input.title) || fileStem(input.virtualPath);
  const composer = clean(input.composer);
  const year = releasedYear(input.released);
  const multiTune = input.subsongCount > 1;
  const songNr = Math.min(Math.max(1, input.songNr), Math.max(1, input.subsongCount));

  const byline = composer && composer !== UNKNOWN_COMPOSER ? ` by ${composer}` : "";
  const lines = [`${title}${byline}${year ? ` (${year})` : ""}`];
  if (multiTune) lines.push(`Tune ${songNr} of ${input.subsongCount}`);

  const subtune = multiTune ? `&subtune=${songNr}` : "";
  return {
    title,
    text: lines.join("\n"),
    url: `${DEEPSID_FILE_URL}${encodedArchivePath(input.virtualPath)}${subtune}`,
  };
};

const isArchiveTune = (item: PlaylistItem): boolean =>
  item.request.source === "hvsc" && item.category === "sid" && item.path.startsWith("/");

/**
 * What to share for a playlist item, or null when it has no public link.
 *
 * Only a tune whose HVSC path is known qualifies: found and recent tunes are built with the `hvsc`
 * source, as are tunes played from the archive. A file from the phone or the Ultimate would put a
 * private path in the link.
 */
export const tuneShareForItem = (
  item: PlaylistItem | null | undefined,
  credits?: { author?: string | null; released?: string | null },
  subsongCount?: number | null,
  title?: string | null,
): TuneSharePayload | null => {
  if (!item || !isArchiveTune(item)) return null;
  const share = buildTuneShare({
    title,
    composer: credits?.author,
    released: credits?.released,
    virtualPath: item.path,
    songNr: item.request.songNr ?? 1,
    subsongCount: subsongCount ?? item.subsongCount ?? 1,
  });
  return { ...share, path: item.path };
};
