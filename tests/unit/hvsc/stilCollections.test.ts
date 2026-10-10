/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  deriveStilCollections,
  isStilCollectionId,
  STIL_COLLECTION_IDS,
  STIL_COLLECTIONS_VERSION,
  stilCollectionCounts,
  type StilCollectionId,
  type StilCollectionIndex,
} from "@/lib/hvsc/stilCollections";
import { parseStil } from "@/lib/hvsc/stilParser";

// Entries in STIL's own layout: labels right-aligned to column 7, continuations indented 9.
const DOCUMENT = `/MUSICIANS/C/Crowley_Owen/A_Drop_of_Blue.sid
COMMENT: Won the music competition at 15 Years Oxyron Party 2007

/MUSICIANS/F/Fanta/Challenger.sid
COMMENT: "The demo (One-Der) got 2nd place at The Party 1997." (AR)

/MUSICIANS/M/Mitch_and_Dane/Dane/912.sid
COMMENT: "A fusion of Jeroen Tel's tune "911", "Robocop III" and some of my
         weird ideas. Released at Floppy 2003." (SA)
(#1)
  TITLE: Nine One One [from the XM module]
 ARTIST: Jeroen Tel (WAVE)
COMMENT: 1st place in the Floppy 2003 music competition.
(#2)
  TITLE: Nine One One [from the XM module]
 ARTIST: Jeroen Tel (WAVE)

/MUSICIANS/P/Paradroid/Airwolf.sid
  TITLE: Airwolf Theme [from the TV series]
 ARTIST: Sylvester Levay

/MUSICIANS/D/DJ_Space/Moonlight_Sonata.sid
  TITLE: Piano Sonata No. 14 Op. 27 "Moonlight Sonata", 3rd Movement
 ARTIST: Ludwig van Beethoven

/GAMES/A-F/Bards_Tale.sid
(#6)
  TITLE: Slavonic Dance Number 7 [from Slovanské Tance, Op. 46]
 ARTIST: Antonín Dvorák

/MUSICIANS/D/Dealer/Tune_5.sid
  TITLE: Magical Sound Shower [from the arcade game Out Run]
 ARTIST: Hiroshi Kawaguchi

/MUSICIANS/N/Nordischsound/Stickerbush_Symphony_2023.sid
  TITLE: Brambles - Stickerbrush Symphony [from the SNES game Donkey Kong Country 2]
 ARTIST: David Wise

/MUSICIANS/N/Narciso/Remix_88.sid
  TITLE: Thalamusik [from the game Sanxion]
 ARTIST: Rob Hubbard

/MUSICIANS/M/Merman/Equinoxe_4.sid
  TITLE: Equinoxe Part 4 [from Equinoxe]
 ARTIST: Jean-Michel Jarre

/MUSICIANS/K/Kosa/Just_Cant.sid
  TITLE: Just Can't Get Enough [from Speak & Spell]
 ARTIST: Depeche Mode

/MUSICIANS/D/Dobek_Eric/Verkeersrally_2022.sid
  TITLE: Verkeersrally
 ARTIST: Cees Kramer
COMMENT: Covers /MUSICIANS/K/Kramer_Cees/Verkeersrally.sid, Tune #1.

/MUSICIANS/H/Hithouse/Jingle_Bells.sid
  TITLE: One Horse Open Sleigh
 ARTIST: James Lord Pierpont

/GAMES/G-L/Hunchback_at_the_Olympics.sid
(#1)
  TITLE: Run Rabbit Run
 ARTIST: Noel Gay and Ralph Butler
`;

const derive = (): StilCollectionIndex => deriveStilCollections(parseStil(DOCUMENT));

const membersOf = (index: StilCollectionIndex, id: StilCollectionId): string[] =>
  index.collections[id].map(([pathIndex, songNr]) => `${index.paths[pathIndex]}#${songNr}`);

describe("deriveStilCollections", () => {
  const index = derive();

  it("puts a first place into Winners and leaves the demo's placing out", () => {
    expect(membersOf(index, "winners")).toEqual([
      "/MUSICIANS/C/Crowley_Owen/A_Drop_of_Blue.sid#1",
      "/MUSICIANS/M/Mitch_and_Dane/Dane/912.sid#1",
    ]);
  });

  it("takes a (#N) block as that tune only, and a file block as the file's first tune", () => {
    expect(membersOf(index, "classical")).toEqual([
      "/MUSICIANS/D/DJ_Space/Moonlight_Sonata.sid#1",
      "/GAMES/A-F/Bards_Tale.sid#6",
    ]);
  });

  it("files film and TV music under Movie & TV themes", () => {
    expect(membersOf(index, "screen")).toEqual(["/MUSICIANS/P/Paradroid/Airwolf.sid#1"]);
  });

  it("files arcade and other-machine game music, but not a C64 game", () => {
    expect(membersOf(index, "games")).toEqual([
      "/MUSICIANS/D/Dealer/Tune_5.sid#1",
      "/MUSICIANS/N/Nordischsound/Stickerbush_Symphony_2023.sid#1",
    ]);
  });

  it("separates the electronic pioneers from synth-pop", () => {
    expect(membersOf(index, "pioneers")).toEqual(["/MUSICIANS/M/Merman/Equinoxe_4.sid#1"]);
    expect(membersOf(index, "synthpop")).toEqual(["/MUSICIANS/K/Kosa/Just_Cant.sid#1"]);
  });

  it("files a cover that names the C64 original's path under C64 remixes", () => {
    expect(membersOf(index, "remixes")).toEqual(["/MUSICIANS/D/Dobek_Eric/Verkeersrally_2022.sid#1"]);
  });

  it("files Christmas songs by title or writer, not by a writer who happens to be called Noel", () => {
    expect(membersOf(index, "christmas")).toEqual(["/MUSICIANS/H/Hithouse/Jingle_Bells.sid#1"]);
  });

  it("lists each tune once even when its file block and its (#1) block both qualify", () => {
    const twice = deriveStilCollections(
      parseStil(`/MUSICIANS/X/Example/Both.sid
  TITLE: Toccata [from Toccata and Fugue in D Minor (BWV 565)]
 ARTIST: Johann Sebastian Bach
(#1)
  TITLE: Toccata
 ARTIST: Johann Sebastian Bach
`),
    );
    expect(membersOf(twice, "classical")).toEqual(["/MUSICIANS/X/Example/Both.sid#1"]);
  });

  it("shares one sorted path table between the collections", () => {
    expect(index.paths).toEqual([...index.paths].sort());
    expect(new Set(index.paths).size).toBe(index.paths.length);
    expect(index.paths).not.toContain("/MUSICIANS/F/Fanta/Challenger.sid");
  });

  it("stamps the rules version and counts every collection", () => {
    expect(index.version).toBe(STIL_COLLECTIONS_VERSION);
    const counts = stilCollectionCounts(index);
    expect(Object.keys(counts)).toEqual([...STIL_COLLECTION_IDS]);
    expect(counts.winners).toBe(2);
    expect(counts.classical).toBe(2);
  });

  it("recognises only the collection ids it defines", () => {
    expect(isStilCollectionId("winners")).toBe(true);
    expect(isStilCollectionId("jazz")).toBe(false);
    expect(isStilCollectionId(undefined)).toBe(false);
  });
});
