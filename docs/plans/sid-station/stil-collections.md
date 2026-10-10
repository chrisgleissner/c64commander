# SID Radio collections — stations built from STIL

**Status:** Implemented (2026-10-10), revised after review (2026-10-11). Extends the SID Radio specification in `spec.md`.
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
| `screen` | Movie & TV themes | Title contains `[from the … movie / film / TV series / TV show / television / cartoon / animated series / anime / musical` | 1,719 | 1,702 |
| `games` | Games from other machines | Title contains `[from the arcade game` or `[from the <machine> … game`, where the machine is not the C64 (NES, SNES, Amiga, PC, Atari, Spectrum, MSX, Mega Drive, Game Boy, PC Engine, …) | 1,888 | 1,860 |
| `pioneers` | Electronic pioneers | Artist is Jean-Michel Jarre, Kraftwerk, Vangelis, Mike Oldfield, Giorgio Moroder, Yellow Magic Orchestra, Isao Tomita, Tangerine Dream, Klaus Schulze, Gershon Kingsley, Hot Butter, Jan Hammer or Harold Faltermeyer | 895 | 890 |
| `synthpop` | Synth-pop | Artist is one of a list of synth-pop and Italo/Euro acts (Depeche Mode, New Order, Pet Shop Boys, a-ha, Alphaville, Laserdance, Koto, Trans-X, …) | 759 | 753 |
| `classical` | Classical | Artist names a composer from a list of classical composers (Bach, Beethoven, Mozart, Tchaikovsky, Chopin, Grieg, Dvořák, …), after removing the names Walter Schumann, Jack Wagner and Le Mele Verdi | 1,328 | 1,375 |
| `remixes` | C64 remixes | The comment says `Covers`, `Remix of`, `Cover of`, `Arrangement of`, `Remake of` or `Covers the version in` followed by an HVSC path | 501 | 493 |
| `christmas` | Christmas | Title or artist matches a list of Christmas songs and writers (Jingle Bells / James Lord Pierpont, Silent Night / Joseph Mohr, Rudolph / Johnny Marks, …) | 340 | 336 |

Counts are STIL members, measured with `STIL_COLLECTIONS_VERSION` 2. The launcher shows the number of
those members that the installed library can play (§7); against the matching HVSC release the two are
equal, because every STIL path is in `Songlengths.md5` and no two members share an `md5_48` and tune.

**The credited music must open the tune.** Every rule that reads a credit (all but `winners` and
`remixes`) also requires the first credit to start at the beginning of the tune: no section time, or
one that starts at `0:00`. STIL times sections in play order, so a first credit timed `(0:30-0:45)`
means the opening of the tune is something else; on v84 that excluded 86 Movie & TV members, 44
Classical, 36 Electronic pioneers, 33 Christmas, 24 Synth-pop and 15 Games members. A medley whose
opening section matches is kept even when later sections do not (113 members on v84). Most of
them carry the collection's music for most of their length, such as Axel F interrupted by a Rob
Hubbard section, and dropping them would lose more true members than false ones.

**Names that only contain a composer's surname** are removed before the Classical match: "Miklós
Rózsa & Walter Schumann" (the Dragnet theme, 25 tunes), "Jack Wagner" and the band "Le Mele Verdi".
"Johann Sebastian Bach & Walter Schumann" would still match Bach. Electronic pioneers match "Isao
Tomita" rather than any "Tomita", which excluded Shigeru Tomita, an MSX game composer.

The rules live in `src/lib/hvsc/stilCollections.ts`. The labels and tile texts live in
`src/lib/sidRadio/stilCollectionCatalog.ts`. Christmas is offered from December 1 to January 6. The
`games` collection is labelled "Games from other machines" rather than "Arcade & console": on v84,
804 of its members come from arcade games, 489 from consoles and 580 from home computers (Amiga,
PC, ZX Spectrum, MSX and others).

Precision was judged by reading random samples of 15 members per collection, and afterwards by
listing every distinct first-credit artist of Classical and Electronic pioneers, which found the
false names above. C64 remixes are all remixes or covers, but about a third remix music that was not
first written for the C64.

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
rules that preceded §2, so the sizes differ from §2):

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
   bundle: `trackCount` plus an FNV-1a hash of `<md5_48>#<songNr>` modulo 2^30
   (`unknownMemberOrdinal`). The ordinal is persisted in the station's played set, so it depends only
   on the member's identity, not on its position in the pool. Two such members whose hashes collide
   are assigned in the order of their identities, the second taking the next free ordinal. Such a
   member still plays, but takes no part in the likes weighting.
2. Members already played (`exclude`) and members marked Not for me are removed.
3. Each remaining member gets a weight. It starts at 1. A liked member gets 4, a direct neighbour of
   a liked tune 2.5, and a tune two hops away 1.75; the highest applies. The weight is multiplied by
   0.35 for each neighbouring Not-for-me tune (`DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale`).
4. The order is the existing weighted permutation: key = −ln(u) / weight, with u drawn from
   `perOrdinalRandom(shuffleSeed, ordinal)`. The same shuffle seed gives the same order.
5. Each candidate carries only its own ordinal in `fileTrackOrdinals`, so the queue provider does not
   retire the other tunes of its file. A collection can list two tunes of one file, and both play.

The station plays every member once, however short. The minimum tune length from Settings (15 s by
default) applies to mood stations only: a collection is a curated list, and its tile states how many
tunes it holds. Under the mood stations' rule, 820 of the v84 members would never have played while
still being counted as heard, among them 402 of the 1,860 Games members; 82 members are shorter than
3 s and one is shorter than 1 s. No lower bound is applied.

When no members remain, the refill reports `exhausted`. That refill runs while several tunes are
still queued, so the app waits until the last queued tune is playing before it shows "You have heard
every tune in this collection. Start it again for a new order." Starting it again draws a new
shuffle seed.

## 6. Where the data comes from and how it is cached

The STIL ingestion already parses the whole document once per HVSC install or update and stores it as
64 shards (`src/lib/hvsc/stilStore.ts`). Collections are derived in the same place:

- `writeStilShards` calls `deriveStilCollections` on the parsed entries and writes
  `hvsc/stil/collections.json` before `index.json`. `index.json` is written last and remains the
  marker of a complete store. It records `collectionsVersion`.
- `collections.json` holds one sorted path table and, per collection, `[pathIndex, songNr]` pairs.
  For v85 it is 322 KB, with 5,963 paths.
- `readStilCollections` reads it once per session. When the stored `collectionsVersion` differs from
  `STIL_COLLECTIONS_VERSION`, or the file is missing or unreadable, it derives the collections again
  from the 64 shards on disk and rewrites the file and the manifest. This needs no network.
  `STIL_STORE_VERSION` is not bumped for collection changes, because a store-version mismatch makes
  `ensureStilReady` download STIL again. Version 2 of the rules (§2) is derived again this way on
  existing installs.
- The re-derivation requires every one of the 64 shards. If a shard is missing or unreadable it logs
  a warning naming the shard, writes nothing, and returns null; a null result is not cached, so the
  next read tries again.
- Store writes are serialized: storing a new STIL document, writing a re-derivation, and clearing the
  store each run after the previous write has settled. Storing a new document forgets the cached
  manifest before it resets the store and bumps the store generation both before and after its
  writes. A re-derivation checks the generation before and after each of its writes and discards its
  result when the store was replaced meanwhile, so it cannot leave a partial `collections.json` or the
  previous release's manifest behind.
- A new HVSC release replaces STIL through the existing paths (the archive during ingestion, or
  `ensureStilReady` when `manifest.release` is older than the installed release), and the
  collections are derived again with it.
- `loadCollectionPool` (`src/lib/sidRadio/collectionPool.ts`) maps member paths to `md5_48` through
  the songlengths index (`md548ForVirtualPath`), leaves out members that are not installed, and counts
  a duplicate file (same `md5_48` and tune number) once. It reads only what is on disk and never
  downloads, because a station calls it on every refill. The pool is cached per collection until STIL
  or the installed library changes.
- `prepareCollectionNotes` runs once per collection start. When STIL is missing or older than the
  installed release it reports that a download is needed (the app then shows "Fetching tune notes…")
  and calls `ensureStilReady({ retryNow: true })` once. It then reports `ready`, or why STIL is not
  available: no library, Demo Mode's library, or a download that did not succeed.
- `ensureStilReady` bounds the download: one 60 s deadline (`STIL_FETCH_TIMEOUT_MS`) covers both
  URLs and aborts the request when it passes. After a failed download, callers that only want notes
  for the playing tune wait 5 minutes (`STIL_FETCH_RETRY_AFTER_MS`) before the next attempt; a
  collection start passes `retryNow`, because the listener asked. Nothing is downloaded without an
  installed library, or for Demo Mode's library, whose tunes the published STIL does not describe.

Measured on a desktop i7-6700K under a load average of 16–33 (minimum and median of 7 runs): parsing
STIL took 125–261 ms, deriving all collections 58–91 ms, and parsing `collections.json` 1.9 ms. On
the smallest supported phone a 5–10× slower JavaScript engine would put derivation at roughly
0.3–0.9 s, once per install or update, inside the background ingestion. This phone figure is an
estimate, not a measurement. The download path (a library installed before STIL was stored) still
parses, stores and derives on the main thread after the download; that runs once per install.

## 7. User interface

- **Launcher** (`SidRadioLauncherSheet`): a **Moods** heading over the existing likes toggle and
  style tiles, then a **Collections** section (`sid-radio-collections`) with one tile per collection
  in season (`sid-radio-collection-<id>`). Each tile shows its label, a one-line description and,
  once STIL has been read, "N tunes" (`sid-radio-collection-<id>-size`). N is the size of the pool
  the station plays (`loadCollectionSizes`), so it is the same number as the total on the source
  row. Until the songlengths index has been read it is the number of STIL members; that happens only
  while no library is installed, when the tiles are disabled anyway. A collection with no installed
  members shows "None installed" and is disabled. All tiles are disabled while no HVSC music is
  installed. The sheet reads the counts each time it opens, 500 ms after opening so that a
  re-derivation does not stall its slide-in animation.
- **Source row** (`SidRadioChip`): "Radio: <Label>", the same form as "Radio: Tunes you like", and,
  once the pool is known, "<heard> of <total>" (`sid-radio-collection-progress`). "Heard" counts
  members taken from the pool, minus those still queued ahead of the playing tune. Members marked Not
  for me are never taken, so a finished collection can stop short of its total. A station restored
  after a restart reads its pool size when it resumes, so the progress shows before the first
  refill. While a collection start waits for STIL to download, the row shows "Fetching tune notes…"
  (`sid-radio-preparing`) in place of the station or playlist name. The provenance line reads "In
  the <Label> collection".
- **Notices** (`sidRadioNotices.ts`): `collection-notes-unavailable` when STIL could not be
  downloaded or read; `no-hvsc` when no library is installed; `no-radio-for-collection` ("None of
  this collection's tunes are in the installed HVSC library.") when the pool is empty, for Demo
  Mode's library, and for a saved id this build does not know; `collection-ended` when every member
  has played. A start that is refused is also shown as a toast.
- **Superseded start:** a collection start that is waiting for STIL is abandoned when the listener
  starts another station or stops the current one meanwhile.
- **Session restore:** the descriptor stores `{ kind: "collection", collectionId }`. A restored
  station loads its pool on the first refill.

## 8. Tests

| Layer | File |
| --- | --- |
| Placing classifier, every accepted form and every rejection above | `tests/unit/hvsc/stilCompetition.test.ts` |
| Collection rules, `(#N)` mapping, path table, partial quotes, false composer names | `tests/unit/hvsc/stilCollections.test.ts` |
| Section start times | `tests/unit/hvsc/stilParser.test.ts` |
| Storage, version-driven re-derivation from shards, missing shard, writes racing an ingestion | `tests/unit/hvsc/stilStore.test.ts` |
| Download deadline, back-off, Demo Mode, whether a download is needed | `tests/unit/hvsc/stilService.test.ts` |
| Membership, full coverage then `exhausted`, likes and Not-for-me weighting, unknown members and their stable ordinals | `tests/unit/sidRadio/collectionEngine.test.ts` |
| Path → `md5_48` pool, duplicates, sizes, no download on refill, preparation once per start | `tests/unit/sidRadio/collectionPool.test.ts` |
| Hook: start, short members, progress, refusals, "Fetching tune notes…", superseded start, finished notice, resume, counts | `tests/unit/sidRadio/useSidRadioCollections.test.tsx` |
| Launcher tiles, season, counts after the animation; source row | `tests/unit/sidRadio/SidRadioCollectionsUi.test.tsx` |
| Worker message contract for a pooled request | `tests/contract/sidRadioWorker.contract.test.ts` |

## 9. Attribution

STIL is written by the HVSC team and ships inside HVSC. It carries no licence of its own, and
`DOCUMENTS/Disclaimer.txt` covers only the tunes. The app derives collections on the device from the
user's own copy of STIL and redistributes none of it. The data notices in `THIRD_PARTY_NOTICES.md`
(generated by `scripts/generate-third-party-notices.mjs`) say so, and the manual names the HVSC tune
notes as the source of the lists.
