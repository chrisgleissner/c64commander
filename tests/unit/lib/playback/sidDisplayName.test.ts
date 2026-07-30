/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  formatSidDisplayName,
  resolveTrackDisplayName,
  sidChipBadgeDescription,
  sidChipBadgeLabel,
  type SidChipCount,
} from "@/lib/playback/sidDisplayName";

/**
 * Every expectation below was checked against a full HVSC #85 checkout (59,886 files), and most
 * against the tune's own SID header title — an independent rendering of the same name that this
 * module never sees. Where the two differ the comment says so and why the difference is accepted.
 */
const HVSC_CASES: ReadonlyArray<[fileName: string, title: string, chipCount: SidChipCount | null]> = [
  // The ordinary case: one word, nothing to do but drop the extension.
  ["Commando.sid", "Commando", null],
  ["Twin_Ball.sid", "Twin Ball", null],
  ["Geoff_Capes_Strongman_Challenge.sid", "Geoff Capes Strongman Challenge", null],
  ["What_Is_This.sid", "What Is This", null],
  // Leading digits stay leading digits. Nothing is reordered or padded.
  ["2_Souls_1_Body.sid", "2 Souls 1 Body", null],
  ["12345.sid", "12345", null],
  // Hyphens are left tight. Measured over the 2,432 hyphenated names in HVSC, the tune's own header
  // keeps the hyphen tight in 1,817 and spaces it in 595, so spacing them would be wrong three times
  // as often as it would be right.
  // "improved" trails the title the way "tune" does, but it appears too rarely in HVSC to have
  // cleared the corpus threshold for a qualifier, so it is title-cased with the rest of the prose.
  // The tune's own header writes "Utopia-Ending 1 (improved 2003)".
  ["Utopia-Ending_1_improved_2003.sid", "Utopia-Ending 1 Improved 2003", null],
  ["Little_Dragon-Cookie_Raiders.sid", "Little Dragon-Cookie Raiders", null],
  // Runs of single lower-case letters stay spaced. The header for this file is literally "R a y s".
  ["R_a_y_s.sid", "R a y s", null],
  ["F_i_s_h_e_s.sid", "F i s h e s", null],
  // Runs of single upper-case letters are an acronym. The header for this file is "M.U.L.E.".
  ["M_U_L_E.sid", "M.U.L.E.", null],
  ["A_C_E.sid", "A.C.E.", null],
  ["C_A_T_S_Title_Music.sid", "C.A.T.S. Title Music", null],
  ["P_W_Botha.sid", "P.W. Botha", null],
  // The lone `A`s here are letters of an acronym, not the article "a". Joining the run before any
  // casing decision is what keeps them out of the small-word rule.
  ["L_A_T_W_A_T.sid", "L.A.T.W.A.T.", null],
  // Mixed single letters and digits are not an acronym: the header here is "4 U 2 C".
  ["4_U_2_C.sid", "4 U 2 C", null],
  // The chip marker moves to the badge. The headers are "Oooaaaeee" and "Bossa in Do".
  ["Oooaaaeee_2SID.sid", "Oooaaaeee", 2],
  ["Bossa_in_Do_2SID.sid", "Bossa in Do", 2],
  ["Just_One_Life_3SID.sid", "Just One Life", 3],
  // ...but only when it is a token of its own. HVSC really does contain both of these, and neither
  // is a two- or three-chip tune.
  ["2SID03.sid", "2SID03", null],
  ["3SID_Tracker_Demo_2.sid", "3SID Tracker Demo 2", null],
];

/**
 * Casing. A file name that says which words matter is kept; one that says nothing — wholly
 * capitalised, wholly lower case, or sentence case — is set in English title case.
 */
const CASING_CASES: ReadonlyArray<[fileName: string, title: string]> = [
  // Wholly capitalised, so the module chooses. This is the name the product owner could not read.
  ["FRODIGI.sid", "Frodigi"],
  ["COMMANDO.SID", "Commando"],
  ["SWABBASWAG.sid", "Swabbaswag"],
  // Length cannot tell an ordinary word set in capitals from an initialism: THE, LAST, PLUS and EXIT
  // are four letters or fewer and are words; NTSC, DXPP, NOP and QUOD are the same size and are not.
  // A shipped list of three- and four-letter English words decides, and the decision is taken for
  // the name as a whole — QUOD and INIT are not words, but EXIT is, so the name is shouting.
  ["THE_LAST_V8.sid", "The Last V8"],
  ["QUOD_INIT_EXIT.sid", "Quod Init Exit"],
  ["IK_PLUS.sid", "IK Plus"],
  // A name in which nothing is a word and nothing is long is somebody's initials, and re-casing it
  // would invent a title. Words of two letters or fewer never move.
  ["FLI_DXPP.sid", "FLI DXPP"],
  ["BM1K.sid", "BM1K"],
  ["NOP.sid", "NOP"],
  ["XO.sid", "XO"],
  // Wholly lower case, so the module chooses here too — and applies the small-word rules.
  ["please_let_me_in.sid", "Please Let Me In"],
  ["another_rush_of_blood.sid", "Another Rush of Blood"],
  ["focus_on_food.sid", "Focus on Food"],
  ["completely_in_command.sid", "Completely in Command"],
  // Sentence case is the CD sleeve's loss and gets re-cased as well: a capital on the first word and
  // on nothing else is not a decision about which words matter.
  ["Hungry_for_you.sid", "Hungry for You"],
  ["Grosse_kunst.sid", "Grosse Kunst"],
  // ...but a raised word anywhere is proof the author was casing the name, including a small word.
  // `Shoot_em_Up` has only the "Up" to go on, and "em" is an elision the module must not raise.
  ["Shoot_em_Up.sid", "Shoot em Up"],
  ["Come_on_and_Do_It.sid", "Come on and Do It"],
  // A capital inside a word is a deliberate shape and survives being title-cased around.
  ["MasterComposer_sample.sid", "MasterComposer Sample"],
  ["McDonald_Theme.sid", "McDonald Theme"],
  ["2Pac_Intro.sid", "2Pac Intro"],
  // First and last word are always capitalised, which is what saves a title ending in a small word.
  ["the_end.sid", "The End"],
  ["9_to_5.sid", "9 to 5"],
  ["wake_up.sid", "Wake Up"],
  // A trailing variant marker stays lower-case and is not the last word for that rule. The qualifier
  // vocabulary comes from the corpus: HVSC's own headers bracket "tune" 2,081 times out of 2,130.
  ["Aces_High_tune_2.sid", "Aces High tune 2"],
  ["Thunder_loader.sid", "Thunder loader"],
  ["accept_intro.sid", "Accept intro"],
  ["1942_v2.sid", "1942 v2"],
  // A year that merely trails the title is not a marker, and a run without a qualifier in it is not
  // a qualifier run.
  ["Christmas_1989_tune_2.sid", "Christmas 1989 tune 2"],
  ["Fuer_Elise_1986.sid", "Fuer Elise 1986"],
  // Named initialisms keep their capitals even though most of them are dictionary words too.
  ["GO_BASIC.sid", "GO BASIC"],
  ["UFO_II_BASIC.sid", "UFO II BASIC"],
  ["USSR.sid", "USSR"],
  ["Jackal_NTSC.sid", "Jackal NTSC"],
  ["Qwak_PAL.sid", "Qwak PAL"],
  ["Randomly_generated_music_BASIC.sid", "Randomly generated music BASIC"],
  ["PETSCII_Aquarium.sid", "PETSCII Aquarium"],
  ["Attack_of_the_PETSCII_Robots.sid", "Attack of the PETSCII Robots"],
  // Roman numerals survive, but only where they are plausibly numerals. MIX is a valid numeral for
  // 1009 and must lose to the word.
  ["UNREAL_II.sid", "Unreal II"],
  ["MCMLXXXII.sid", "MCMLXXXII"],
  ["Strange_Visitor_III.sid", "Strange Visitor III"],
  ["HELLOWEEN-MIX.sid", "Helloween-Mix"],
  ["TECHNO_MIX.sid", "Techno Mix"],
  ["DISCO_MIX.sid", "Disco Mix"],
  // Inside a name its author cased, only length convicts: a short capitalised word there is emphasis,
  // and HVSC's own header keeps the NOT.
  ["2_Hours_NOT_Enough.sid", "2 Hours NOT Enough"],
  ["SNK_vs_CAPCOM_V1.sid", "SNK vs Capcom V1"],
  ["National_Park_GRAVE_DANGER.sid", "National Park Grave Danger"],
  ["1988_Top_40_MEGAMIX.sid", "1988 Top 40 Megamix"],
  // A word that begins with a digit keeps its shape, so an ordinal does not become "3Rd" and a
  // stylised handle is left alone. The header for `2hero.sid` is "2hero".
  ["2hero.sid", "2hero"],
  ["64C.sid", "64C"],
  // ...but a digit in front is not a licence to shout, and the result is set as a word rather than
  // flattened to lower case.
  ["4PIT.sid", "4Pit"],
  ["8BITWEAPON_Theme.sid", "8Bitweapon Theme"],
];

/**
 * The beautifier is not an HVSC feature. These are the shapes a tune reaches the app in when it came
 * off a phone's storage, the Ultimate's filesystem or an online archive.
 */
const NON_HVSC_CASES: ReadonlyArray<[fileName: string, title: string, chipCount: SidChipCount | null]> = [
  ["My Own Tune.sid", "My Own Tune", null],
  ["My Own Tune 2SID.sid", "My Own Tune", 2],
  ["Tune.2SID.sid", "Tune", 2],
  ["Tune-3SID.sid", "Tune", 3],
  ["all lower case.sid", "All Lower Case", null],
  ["no_extension_at_all", "No Extension at All", null],
  // Each side of a hyphen is a word; a dot inside a word is not a separator this module knows about.
  ["my-tune.mixed_separators.sid", "My-Tune.mixed Separators", null],
  // Casing is Unicode-aware, so an accented name is capitalised like any other rather than skipped.
  ["ünïcödé_tüne.sid", "Ünïcödé Tüne", null],
  ["日本語_の_曲.sid", "日本語 の 曲", null],
  ["  padded   name  .sid", "Padded Name", null],
  ["/storage/emulated/0/Music/Deep/Great_Tune_3SID.sid", "Great Tune", 3],
  ["C:\\Users\\me\\Music\\Great_Tune.sid", "Great Tune", null],
  // Only one extension comes off, because the rest of the name is the name.
  ["song.sid.sid", "Song.sid", null],
];

describe("formatSidDisplayName", () => {
  it.each(HVSC_CASES)("renders the HVSC name %s", (fileName, title, chipCount) => {
    expect(formatSidDisplayName(fileName)).toEqual({ title, chipCount });
  });

  it.each(CASING_CASES)("cases %s", (fileName, title) => {
    expect(formatSidDisplayName(fileName).title).toBe(title);
  });

  it.each(NON_HVSC_CASES)("renders the non-HVSC name %s", (fileName, title, chipCount) => {
    expect(formatSidDisplayName(fileName)).toEqual({ title, chipCount });
  });

  it("never returns an empty title, even for a name made only of separators", () => {
    // Falling back to what is actually on disk is ugly. An unreadable, unreportable blank row is
    // worse, and there is nothing else left to show.
    expect(formatSidDisplayName("___.sid").title).toBe("___.sid");
    expect(formatSidDisplayName("_.sid").title).toBe("_.sid");
  });

  it("prefers a parsed SID header chip count over the file-name marker", () => {
    // The header is what the player obeys. A file named without the marker, or named with the wrong
    // one, must not override it.
    expect(formatSidDisplayName("Some_Tune.sid", 3).chipCount).toBe(3);
    expect(formatSidDisplayName("Some_Tune_2SID.sid", 3).chipCount).toBe(3);
  });

  it("reports no chip count for a single-chip tune, from either source", () => {
    // Every tune on this screen is a SID. Saying so on the ~99.5% of tunes that use one chip costs a
    // row of space and tells the listener nothing, so one chip is reported as "nothing to show".
    expect(formatSidDisplayName("Some_Tune.sid", 1).chipCount).toBeNull();
    expect(formatSidDisplayName("Some_Tune_1SID.sid").chipCount).toBeNull();
    expect(formatSidDisplayName("Some_Tune.sid").chipCount).toBeNull();
  });

  it("carries a chip count past three rather than assuming three is the maximum", () => {
    // No HVSC tune uses four today. The count is read from a file this app did not write, and a
    // number merely larger than expected must still reach the badge instead of vanishing.
    expect(formatSidDisplayName("Some_Tune.sid", 4).chipCount).toBe(4);
    expect(formatSidDisplayName("Some_Tune_4SID.sid")).toEqual({ title: "Some Tune", chipCount: 4 });
    expect(formatSidDisplayName("Some_Tune_12SID.sid")).toEqual({ title: "Some Tune", chipCount: 12 });
  });

  it("ignores a chip count that is not a number and falls back to the file name", () => {
    expect(formatSidDisplayName("Some_Tune_2SID.sid", null).chipCount).toBe(2);
    expect(formatSidDisplayName("Some_Tune_2SID.sid", Number.NaN).chipCount).toBe(2);
  });

  it("leaves the input untouched", () => {
    const fileName = "Bossa_in_Do_2SID.sid";
    formatSidDisplayName(fileName);
    expect(fileName).toBe("Bossa_in_Do_2SID.sid");
  });
});

describe("resolveTrackDisplayName", () => {
  it("renames SIDs when the preference is on", () => {
    expect(resolveTrackDisplayName({ label: "Bossa_in_Do_2SID.sid", category: "sid", friendlyNames: true })).toEqual({
      title: "Bossa in Do",
      chipCount: 2,
    });
  });

  it("returns the file name unchanged when the preference is off", () => {
    expect(resolveTrackDisplayName({ label: "Bossa_in_Do_2SID.sid", category: "sid", friendlyNames: false })).toEqual({
      title: "Bossa_in_Do_2SID.sid",
      chipCount: null,
    });
  });

  it.each(["prg", "crt", "disk", "mod"] as const)("leaves a %s entry exactly as it was", (category) => {
    // The requirement is that nothing but a SID changes, whatever the preference says: these names
    // were chosen by whoever made the file and carry no convention this module can read.
    const label = "SOME_Program_File.prg";
    expect(resolveTrackDisplayName({ label, category, friendlyNames: true })).toEqual({
      title: label,
      chipCount: null,
    });
    expect(resolveTrackDisplayName({ label, category, friendlyNames: false })).toEqual({
      title: label,
      chipCount: null,
    });
  });

  it("suppresses the badge for a non-SID even when a chip count is supplied", () => {
    expect(resolveTrackDisplayName({ label: "Game.prg", category: "prg", friendlyNames: true, chipCount: 2 })).toEqual({
      title: "Game.prg",
      chipCount: null,
    });
  });
});

describe("sid chip badge text", () => {
  it.each([
    [2, "2SID", "Plays through two SID chips"],
    [3, "3SID", "Plays through three SID chips"],
    [4, "4SID", "Plays through four SID chips"],
  ] as const)("labels %i chips", (chipCount, label, description) => {
    expect(sidChipBadgeLabel(chipCount)).toBe(label);
    expect(sidChipBadgeDescription(chipCount)).toBe(description);
  });

  it("falls back to the numeral when the count is past the spelled-out range", () => {
    expect(sidChipBadgeLabel(12)).toBe("12SID");
    expect(sidChipBadgeDescription(12)).toBe("Plays through 12 SID chips");
  });
});

describe("the generated English word list", () => {
  it("covers the three- and four-letter band and nothing else", async () => {
    // The band is the whole point: two letters and under are protected outright, five and over are
    // shouting on length, so this is the only place the list is ever asked. A regenerated list that
    // reached wider would be paying bundle size for a decision nothing takes.
    const { SHORT_ENGLISH_WORDS } = await import("@/generated/titleCaseWords");
    expect(SHORT_ENGLISH_WORDS.size).toBeGreaterThan(3000);
    for (const word of SHORT_ENGLISH_WORDS) expect(word).toMatch(/^[a-z]{3,4}$/);
  });

  it("holds the words that decide the cases length cannot", async () => {
    const { SHORT_ENGLISH_WORDS } = await import("@/generated/titleCaseWords");
    for (const word of ["the", "last", "plus", "exit", "love", "fame", "jazz", "mix"]) {
      expect(SHORT_ENGLISH_WORDS.has(word), `${word} should be a word`).toBe(true);
    }
    for (const word of ["init", "ntsc", "quod", "nop", "dxpp", "fli", "bzt"]) {
      expect(SHORT_ENGLISH_WORDS.has(word), `${word} should not be a word`).toBe(false);
    }
  });

  it("excludes roman numerals, which the dictionary lists as words", async () => {
    // Admitting them would have "Strange Visitor III" rendered as "Strange Visitor Iii".
    const { SHORT_ENGLISH_WORDS } = await import("@/generated/titleCaseWords");
    for (const numeral of ["iii", "vii", "viii", "xii", "xiii", "xiv", "xix", "xxx"]) {
      expect(SHORT_ENGLISH_WORDS.has(numeral), `${numeral} should not be treated as a word`).toBe(false);
    }
  });
});
