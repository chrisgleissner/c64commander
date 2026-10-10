# SID Radio collections — stations built from STIL

**Status:** Implemented (2026-10-10). Extends the SID Radio specification in `spec.md`.
**Data source:** `DOCUMENTS/STIL.txt` (SID Tune Information List), shipped inside every HVSC release.
**Measured against:** STIL v85 (June 28, 2026), cross-checked against STIL v84 (December 25, 2025).

## 1. What a collection is

A mood station (`spec.md` §2.3) walks the similarity graph and plays tunes that sound like its seed.
A **collection** is a closed list of tunes taken from STIL, such as competition winners or movie
themes. A collection station plays its members and nothing else.

The two kinds are offered side by side in the launcher and explained there in one line each:

- **Moods:** "Tunes that sound like the mood you pick."
- **Collections:** "Only tunes from the collection, as listed in the HVSC tune notes."

## 2. The collections

Membership is decided per STIL block. A `(#N)` block puts only tune N into a collection. A file-level
block puts the file's first tune in. "Title" and "artist" below mean the first credit of the block
(`primaryCredit` in `src/lib/hvsc/stilParser.ts`).

| Id | Label | Rule | v85 | v84 |
| --- | --- | --- | ---: | ---: |
| `winners` | Competition winners | The comment records a first place in a music competition (§3) | 423 | 413 |
| `screen` | Movie & TV themes | Title contains `[from the … movie / film / TV series / TV show / television / cartoon / animated series / anime / musical` | 1,805 | 1,788 |
| `games` | Arcade & console | Title contains `[from the arcade game` or `[from the <machine> … game`, where the machine is not the C64 (NES, SNES, Amiga, PC, Atari, Spectrum, MSX, Mega Drive, Game Boy, PC Engine, …) | 1,903 | 1,875 |
| `pioneers` | Electronic pioneers | Artist is Jean-Michel Jarre, Kraftwerk, Vangelis, Mike Oldfield, Giorgio Moroder, Yellow Magic Orchestra, Tomita, Tangerine Dream, Klaus Schulze, Gershon Kingsley, Hot Butter, Jan Hammer or Harold Faltermeyer | 932 | 927 |
| `synthpop` | Synth-pop | Artist is one of a list of synth-pop and Italo/Euro acts (Depeche Mode, New Order, Pet Shop Boys, a-ha, Alphaville, Laserdance, Koto, Trans-X, …) | 783 | 777 |
| `classical` | Classical | Artist names a composer from a list of classical composers (Bach, Beethoven, Mozart, Tchaikovsky, Chopin, Grieg, Dvořák, …) | 1,451 | 1,445 |
| `remixes` | C64 remixes | The comment says `Covers`, `Remix of`, `Cover of`, `Arrangement of`, `Remake of` or `Covers the version in` followed by an HVSC path | 501 | 493 |
| `christmas` | Christmas | Title or artist matches a list of Christmas songs and writers (Jingle Bells / James Lord Pierpont, Silent Night / Joseph Mohr, Rudolph / Johnny Marks, …) | 373 | 369 |

The rules live in `src/lib/hvsc/stilCollections.ts`. The labels and tile texts live in
`src/lib/sidRadio/stilCollectionCatalog.ts`. Christmas is offered from December 1 to January 6.

Precision was judged by reading random samples of 15 members per collection. Movie & TV themes,
Classical, Electronic pioneers and Christmas showed no false members. C64 remixes are all remixes or
covers, but about a third remix music that was not first written for the C64.

Rejected candidates, with their measured size and the reason:

- **Pop and rock covers** (any artist credit that is not game, film, classical or traditional): 9,150
  tunes, about 65% precise, because many game-composer credits carry no source tag.
- **Traditional and folk:** 509 tunes of anthems, hymns and folk songs that do not belong together.
- **Medleys:** 429 tunes with no common sound.
- **Unreleased, unused and previews:** 182 tunes, about 55% precise.
- **James Bond:** 60 tunes, too few for a station.

## 3. Competition placings

STIL has no field for a placing. Results appear only as comment prose, in two forms:

- Sentences written by the HVSC editors, which are regular: "Won first place at <party> <year> …"
  (235 winner sentences), "Won the <party> <year> music competition." (158), and variants such as
  "Won the shared first place …", "Winner of …" and "Placed 1st in …".
- Composer quotes in `"…" (XY)` form: "Got 1st place at The Party 1994.", "Placed 1st.", "It finished
  #1."

`src/lib/hvsc/stilCompetition.ts` classifies each sentence. A sentence is split only at `.`, `!` or
`?` followed by whitespace and a capital letter, so "www.c64.sk" and "Was That Rob Hubbard? compo"
stay whole. The rank is taken from, in order: "won … <ordinal> place/prize"; a winner phrasing; a
numbered placing. A sentence counts only in a competition context: it names a competition or a
party, it is the editors' "Won first place at/prize" form, or the comment names a competition and
the sentence starts with the tune as its subject ("It finished #1.").

A placing is rejected when the sentence places something other than this tune in a scene music
competition:

| Rejection | Example from STIL |
| --- | --- |
| A production that used the tune won | "…used in the demo that won the C64 demo competition…" |
| The demo placed | "The demo (One-Der) got 2nd place at The Party 1997." |
| Not a music competition | demo, intro, graphics, game, 4K, one-file or wild compo, unless the sentence also says "music" |
| A 4K intro placed | "This 4K shorty got 1st place at Mekka Symposium 2000." |
| Not a scene music competition | Eurovision Song Contest, singing contests, Tour de France, awards |
| Negated | "Unfortunately none of them won the competition at the Vision party." |
| Uncertain | "…I made second or first place with that tune (not sure)." |
| Someone else placed | "I hate Crest for stealing us the first place at Mekka Symposium 2000!" |

On v85 this yields 423 winners, 451 tunes on the podium and 506 with any accepted placing. Only 3
winners are stated inside `(#N)` blocks. A review of every non-editorial winner sentence and of the
whole reject list found no remaining false positive.

## 4. Why a collection is not a similarity walk

The station engine can restrict a walk to a set of tunes (`admit` in
`src/lib/sidRadio/stationEngine.ts`). Driven that way against the shipped similarity bundle, with
each collection as the admitted set and 5 runs from a random member (measured with the exploratory
rules, whose sizes differ from §2 by a few members):

| Collection | Tunes | Have a member as a direct neighbour / within 2 hops | Served before "exhausted" | Next tune was a neighbour of the previous one |
| --- | ---: | --- | --- | ---: |
| Electronic pioneers | 932 | 19% / 49% | 619–756 (66–81%) | 10% |
| Competition winners | 423 | 10% / 38% | 156–275 (37–65%) | 4.5% |
| Christmas | 375 | 18% / 37% | 102–216 (27–58%) | 11% |
| Classical | 1,451 | 44% / 75% | 640–1,256 | 21% |
| Movie & TV themes | 1,805 | 25% / 62% | 1,154–1,557 | 11% |

The bundle keeps 3 neighbours per tune, and members of a collection are rarely each other's
neighbours. A walk therefore reports a collection exhausted while a third to two thirds of it has
not played, and it barely orders the tunes it does serve. Similarity is used only to apply the
listener's likes (§5).

## 5. How a collection station plays

`computeCollectionStation` in `src/lib/sidRadio/collectionEngine.ts` runs in the SID Radio worker:

1. Each member resolves to the bundle's ordinal for its `md5_48` and tune number. A member the
   bundle does not know, or a tune number it has no track for, gets an ordinal past the end of the
   bundle (`trackCount + pool index`). It still plays, but takes no part in the likes weighting.
2. Members already played (`exclude`) and members marked Not for me are removed.
3. Each remaining member gets a weight. It starts at 1. A liked member gets 4, a direct neighbour of
   a liked tune 2.5, and a tune two hops away 1.75; the highest applies. The weight is multiplied by
   0.35 for each neighbouring Not-for-me tune (`DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale`).
4. The order is the existing weighted permutation: key = −ln(u) / weight, with u drawn from
   `perOrdinalRandom(shuffleSeed, ordinal)`. The same shuffle seed gives the same order.
5. Each candidate carries only its own ordinal in `fileTrackOrdinals`, so the queue provider does not
   retire the other tunes of its file. A collection can list two tunes of one file, and both play.

The station plays every member once. When none remain, the refill reports `exhausted` and the app
shows "You have heard every tune in this collection. Start it again for a new order." Starting it
again draws a new shuffle seed.

## 6. Where the data comes from and how it is cached

The STIL ingestion already parses the whole document once per HVSC install or update and stores it as
64 shards (`src/lib/hvsc/stilStore.ts`). Collections are derived in the same place:

- `writeStilShards` calls `deriveStilCollections` on the parsed entries and writes
  `hvsc/stil/collections.json` before `index.json`. `index.json` is written last and remains the
  marker of a complete store. It records `collectionsVersion` and `collectionCounts`.
- `collections.json` holds one sorted path table and, per collection, `[pathIndex, songNr]` pairs.
  For v85 it is 342 KB, with 6,188 paths.
- `readStilCollections` reads it once per session. When the stored `collectionsVersion` differs from
  `STIL_COLLECTIONS_VERSION`, or the file is missing or unreadable, it derives the collections again
  from the 64 shards on disk and rewrites the file and the manifest. This needs no network.
  `STIL_STORE_VERSION` is not bumped for collection changes, because a store-version mismatch makes
  `ensureStilReady` download STIL again.
- A new HVSC release replaces STIL through the existing paths (the archive during ingestion, or
  `ensureStilReady` when `manifest.release` is older than the installed release), and the
  collections are derived again with it.
- `loadCollectionPool` (`src/lib/sidRadio/collectionPool.ts`) maps member paths to `md5_48` through
  the songlengths index (`md548ForVirtualPath`) and leaves out members that are not installed. It
  calls `ensureStilReady` first, so a library installed before STIL was stored fetches STIL once,
  the first time a collection starts. The pool is cached per collection until STIL or the installed
  library changes.

Measured on a desktop i7-6700K under a load average of 16–33 (minimum and median of 7 runs): parsing
STIL took 125–261 ms, deriving all collections 58–91 ms, and parsing `collections.json` 1.9 ms. On
the smallest supported phone a 5–10× slower JavaScript engine would put derivation at roughly
0.3–0.9 s, once per install or update, inside the background ingestion. This phone figure is an
estimate, not a measurement.

## 7. User interface

- **Launcher** (`SidRadioLauncherSheet`): a **Moods** heading over the existing likes toggle and
  style tiles, then a **Collections** section (`sid-radio-collections`) with one tile per collection
  in season (`sid-radio-collection-<id>`). Each tile shows its label, a one-line description and,
  once STIL has been read, "N tunes" (`sid-radio-collection-<id>-size`). A collection with no
  members shows "None in this release" and is disabled. All tiles are disabled while no HVSC music
  is installed. The sheet reads the counts each time it opens.
- **Source row** (`SidRadioChip`): "<Label> Radio" and, once the pool is known, "<heard> of <total>"
  (`sid-radio-collection-progress`). "Heard" counts members taken from the pool, minus those still
  queued ahead of the playing tune. Members marked Not for me are never taken, so a finished
  collection can stop short of its total. The provenance line reads "In the <Label> collection".
- **Notices** (`sidRadioNotices.ts`): `no-radio-for-collection` when STIL cannot be loaded or the
  collection resolves to nothing; `collection-ended` when every member has played.
- **Session restore:** the descriptor stores `{ kind: "collection", collectionId }`. A restored
  station loads its pool on the first refill. An unknown id produces `no-radio-for-collection`.

## 8. Tests

| Layer | File |
| --- | --- |
| Placing classifier, every accepted form and every rejection above | `tests/unit/hvsc/stilCompetition.test.ts` |
| Collection rules, `(#N)` mapping, path table | `tests/unit/hvsc/stilCollections.test.ts` |
| Storage, version-driven re-derivation from shards, failure handling | `tests/unit/hvsc/stilStore.test.ts` |
| Membership, full coverage then `exhausted`, likes and Not-for-me weighting, unknown members | `tests/unit/sidRadio/collectionEngine.test.ts` |
| Path → `md5_48` pool, cache invalidation | `tests/unit/sidRadio/collectionPool.test.ts` |
| Hook: start, progress, refusal, finished notice, resume, counts | `tests/unit/sidRadio/useSidRadioCollections.test.tsx` |
| Launcher tiles, season, counts; source row | `tests/unit/sidRadio/SidRadioCollectionsUi.test.tsx` |
| Worker message contract for a pooled request | `tests/contract/sidRadioWorker.contract.test.ts` |

## 9. Attribution

STIL is written by the HVSC team and ships inside HVSC. It carries no licence of its own, and
`DOCUMENTS/Disclaimer.txt` covers only the tunes. The app derives collections on the device from the
user's own copy of STIL and redistributes none of it. The data notices in `THIRD_PARTY_NOTICES.md`
(generated by `scripts/generate-third-party-notices.mjs`) say so, and the manual names the HVSC tune
notes as the source of the lists.
