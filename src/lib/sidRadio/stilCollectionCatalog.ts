/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { StilCollectionId } from "@/lib/hvsc";

export type SidRadioCollection = {
  id: StilCollectionId;
  label: string;
  blurb: string;
  /** Offered only in its season, so a Christmas tile is not the first thing seen in July. */
  inSeason?: (date: Date) => boolean;
};

/** December, and the first week of January. */
const isChristmasSeason = (date: Date) => date.getMonth() === 11 || (date.getMonth() === 0 && date.getDate() <= 6);

/** The collection tiles, in launcher order. Labels follow the app's sentence case. */
export const SID_RADIO_COLLECTIONS: ReadonlyArray<SidRadioCollection> = [
  { id: "winners", label: "Competition winners", blurb: "First place at a party or online compo" },
  { id: "screen", label: "Movie & TV themes", blurb: "Film, TV and cartoon music" },
  { id: "games", label: "Arcade & console", blurb: "Game music from other machines" },
  { id: "pioneers", label: "Electronic pioneers", blurb: "Jarre, Kraftwerk, Vangelis, Oldfield" },
  { id: "synthpop", label: "Synth-pop", blurb: "Depeche Mode, Pet Shop Boys, Erasure" },
  { id: "classical", label: "Classical", blurb: "Bach, Beethoven, Grieg and more" },
  { id: "remixes", label: "C64 remixes", blurb: "New takes on C64 tunes" },
  { id: "christmas", label: "Christmas", blurb: "Carols and holiday songs", inSeason: isChristmasSeason },
];

export const sidRadioCollectionsFor = (date: Date): ReadonlyArray<SidRadioCollection> =>
  SID_RADIO_COLLECTIONS.filter((collection) => collection.inSeason?.(date) ?? true);

export const sidRadioCollectionLabel = (id: StilCollectionId): string =>
  SID_RADIO_COLLECTIONS.find((collection) => collection.id === id)?.label ?? id;
