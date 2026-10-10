/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { bestCompetitionRank, classifyCompetitionPlacings, LAST_PLACE } from "@/lib/hvsc/stilCompetition";

// Every sentence below is quoted from STIL v85.
describe("bestCompetitionRank — wins written by the HVSC editors", () => {
  it.each([
    "Won first place at the Revision 2026 oldskool music competition.",
    "Won first place at Fatum Party 1994.",
    "Won the music competition at the X'2023 party.",
    "Won the Datastorm 2012 music competition.",
    "Won the shared first place at the Gubbdata 2021 music competition.",
    "Won both the jury and audience voting of the www.c64.sk SID Compo 7.",
    "Won the annual www.c64.sk SID Compo IV, held in 2004.",
    "Won the CSDb online Was That Rob Hubbard? compo in 2021.",
    "Winner of the Primary Star 2007 music competition.",
    "This SID has won Skurup Party 1993 music competition.",
    "Ranked 1st in the C64 Music Competition at Silesia Party v1.0.",
    "Placed first as North Party 1997 music competition.",
    "1st place in the Floppy 2003 music competition.",
    "This was the shared winner of the Tiny SID Compo 2005 (256 bytes category).",
  ])("reads %j as a win", (comment) => {
    expect(bestCompetitionRank(comment)).toBe(1);
  });
});

describe("bestCompetitionRank — wins in the composer's own words", () => {
  it.each([
    '"Got 1st place at The Party 1994." (AR)',
    '"Another favourite of mine, reached the 1st place at tUM 2003." (RE)',
    '"2x speed tune for Towel2003. Won first prize. At the partyplace this tune kicked ass." (LV)',
    "Released at ArokParty 2002, Hungary. Placed 1st. The guys from Singular used this tune.",
  ])("reads %j as a win", (comment) => {
    expect(bestCompetitionRank(comment)).toBe(1);
  });

  it("takes the competition from a neighbouring sentence when the placing sentence names none", () => {
    expect(
      bestCompetitionRank(
        'Aged 16, Chris Hülsbeck entered a music contest in the German computer magazine "64er Magazine" with this song. It finished #1.',
      ),
    ).toBe(1);
  });
});

describe("bestCompetitionRank — placings other than first", () => {
  it("does not read 'Won 3rd place' as a win", () => {
    expect(
      bestCompetitionRank('"Won 3rd place at the Mixed Music competition at Syntax 2009 demoparty in Australia." (OC)'),
    ).toBe(3);
  });

  it.each([
    ['"2nd in the oldschool music competition at Assembly 2007." (TL)', 2],
    ['"Got 7th place at Mekka Symposium 1999."', 7],
    ['"This tune was made for the X-2004 party, it made the place #19 The tune has a intro."', 19],
    ["Despite finishing dead last in the compo I entered it in (Assembly '98), I still like this.", LAST_PLACE],
  ])("reads %j as rank %i", (comment, rank) => {
    expect(bestCompetitionRank(comment)).toBe(rank);
  });
});

describe("bestCompetitionRank — sentences that place something other than the tune", () => {
  it.each([
    ['"The demo (One-Der) got 2nd place at The Party 1997." (AR)', "the demo placed"],
    ['"This 4K shorty got 1st place at Mekka Symposium 2000." (AR)', "a 4K intro placed"],
    [
      "I converted the tune and it was used in the demo that won the C64 demo competition at the Randers copy-party.",
      "a production that used the tune won",
    ],
    [
      'Finally, this version was used in the demo with the same name which won the Forever 2010 party." (NP)',
      "a production that used the tune won",
    ],
    ["This song won the Eurovision Song Contest in 1984.", "not a scene music competition"],
    ["Won Syksyn sävel singing contest in Finland 1988.", "not a scene music competition"],
    ["Unfortunately none of them won the competition at the Vision party.", "negated"],
    [
      '"This was my competition entry on The Party 1991 and I made second or first place with that tune (not sure).',
      "uncertain",
    ],
    ['I hate Crest for stealing us the first place at Mekka Symposium 2000! ;-)" (AR)', "someone else placed"],
  ])("rejects %j (%s)", (comment, rejection) => {
    expect(bestCompetitionRank(comment)).toBeNull();
    expect(classifyCompetitionPlacings(comment).map((placing) => placing.rejection)).toContain(rejection);
  });

  it("ignores a finish that is not a placing", () => {
    expect(bestCompetitionRank("The C64 was finished first, however. It was my entry for the compo.")).toBeNull();
  });

  it("does not take 'composed' for a competition", () => {
    expect(bestCompetitionRank("I composed this in 1989 and it was the first tune I finished.")).toBeNull();
  });

  it("answers nothing for an empty or absent comment", () => {
    expect(bestCompetitionRank(undefined)).toBeNull();
    expect(bestCompetitionRank("")).toBeNull();
  });

  it("keeps the best accepted placing when a comment names several", () => {
    expect(
      bestCompetitionRank(
        'Placed 1st in the music competition at the Role 2002 party. "This song become the winner of the Role Party 2002 music compo."',
      ),
    ).toBe(1);
  });
});
