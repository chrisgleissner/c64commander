# The Play page: what is missing

Written from the point of view of somebody who listens to SID music every day, and who has to defend
each of these to a maintainer. The test each one has to pass is not "would this be nice" but: does it
strengthen what is already here, does it fit the language the page already speaks, and is it whole?
A half-built version of any of these would be worse than its absence.

## What the page already does well

Worth stating, because it constrains what belongs here. The Now Playing card reads
source → tune → controls → settings. Rows carry a title, a subtitle and a quiet third line. Actions
that change what plays sit under the transport. Metadata is prose, not a table. Anything added has to
join that, not sit beside it.

## The ten

**1. "Play all N tunes in this file".** A SID is not a track, it is a small album: nineteen tunes
under one file, and the one worth hearing is routinely not the default. The app already says so —
the credits line reads "Tune 1 of 19" — and then offers no verb for it on the card at all. A subsong
selector does exist, but it is in the settings panel below the fold, and it asks the listener to hunt
one at a time.

The right shape is not a stepper. It is a single self-explanatory action that appears only when the
file holds more than one tune, and adds them to the queue: the SID becomes an album and every
control that already exists — next, previous, shuffle, repeat, the playlist itself — works on it
unchanged. No new concept, no new screen, one CTA that says exactly what it does. The stepper stays
where it is for the person who wants to pick one.

Everything needed is already in hand: `subsongCount`, `songNr`, per-subsong durations from
songlengths, and an engine that already takes a song index.

**2. STIL, in two parts — and only two.** The SID Tune Information List is a hand-curated file in
HVSC's `DOCUMENTS/` folder. It is editorial rather than technical: written by the archive's editors,
not extracted from the files, and carried per file _and per subsong_.

Everything the card shows today comes from the SID header, which tells you who did the C64 version
and what hardware it wants. Two things a header structurally cannot say:

- **That a tune is an arrangement, and of whose music.** A large share of C64 music is a cover of
  something — pop, film scores, other games — and the header's author is the person who converted
  it. STIL's `ARTIST:` is the only record of the original. Not derivable from anything else we hold.
- **What the tunes inside a file are.** This one got stronger while the rest of this was being
  built. "Play all N tunes" now puts nineteen rows in the playlist that read identically and differ
  only by length. STIL's per-subsong `TITLE:` is what turns those into _Title screen_, _High score_,
  _Game over_ — the difference between a usable list and one you can only navigate by trial.

Where each goes, given that the credits line is already full: the per-subsong title belongs in the
**playlist row's existing subtitle slot**, which is where the problem actually is and costs no new
chrome. A cover credit belongs on the **credits line** as one short clause and only when present —
"Rob Hubbard · after Jean-Michel Jarre". Neither adds a surface.

**What to leave out.** STIL's free `COMMENT:` prose. Quality varies wildly, length is unbounded, and
"trivia behind a tap" is the kind of thing that reads well in a proposal and clutters in practice.
Taking two-thirds of STIL and refusing the third is what keeps this from becoming a second screen.

**Blocked on a prerequisite, checked on the device (2026-07-31):** the installed archive's
`DOCUMENTS/` folder contains `Songlengths.md5` and nothing else. `STIL.txt` is not extracted by the
ingestion at all, so there is nothing on disk to parse. Doing this properly therefore starts in the
archive ingestion — extracting and storing the file — before any of the parse, index and display
work begins. That is a materially larger change than it looks from the outside, and it is why this
was not built alongside the other two: half of it, against an archive that does not carry the file,
would be worse than its absence.

**3. Recently played.** A station is endless and strictly one-way. A tune goes by, you think "what
_was_ that", and it is gone — Liked Tunes only holds what you reacted to in time. A short history
with the same row and the same two actions as the search results (play it, or seed a station from
it) costs one list and no new concepts, because the components exist.

**4. The composer as a destination.** "Rob Hubbard" is printed everywhere and is inert. For a person
who thinks in composers, tapping the name and getting their work is the most natural verb on the
page. The archive search added this session already answers the query; this is a link, not a feature.

**5. Up next.** The station keeps ten tunes queued and shows none of them. Two or three, with the
ability to drop one, would let people steer without the blunt instrument of ✕-skip.

**6. Per-voice mute and solo.** The SID has three voices. Muting one to hear what the bass is doing
is the most characteristic thing a SID enthusiast does, and the on-device engine is ours — this is a
register write away. It is also honestly scoped: it applies to local playback only, which the page
already has language for ("Listen on").

**7. An oscilloscope tied to the three voices.** The emotional centre of SID listening is watching
the channels. The app already carries audio analysis plumbing for Live View. Per-voice needs engine
support; a single scope does not, and even that is worth more than it costs.

**8. Sleep timer / stop after this tune.** An endless station and a bedside phone are a bad
combination. "Stop after this tune" is one line of existing auto-advance logic; the timed version is
a deadline the page already knows how to hold.

**9. Show what is already rendered.** The engine caches whole tunes; the progress bar already draws
the render head. Extending that idea to the queue — which upcoming tunes will start instantly — makes
a real behaviour visible instead of mysterious.

**10. Share a tune.** An HVSC path or an `.sid` out to another app. Small, and the thing people
actually want to do when they find something.

## The three I would insist on

**"Play all N tunes in this file" (1).** The cheapest of the three and the one that changes daily
use most. The data and the engine parameter are already there; this is one button and a queue
append. Without it the app plays one nineteenth of a large part of the archive by default and leaves
the rest behind a control most people will never find. It is also the most _conservative_ of the
three: it adds an action, not a surface, and everything downstream of it already works.

**STIL's per-subsong titles and cover credits (2).** Architecturally a known quantity — the same
discovery, parse, index and lookup path the songlengths already take — and both land inside UI that
already exists. Rated higher than when this was first written, because "play all N tunes" shipped
and created the nineteen-identical-rows problem the per-subsong titles solve. Rated narrower too:
the free comment prose is deliberately not part of it.

**Blocked on a prerequisite, checked on the device (2026-07-31):** the installed archive's
`DOCUMENTS/` folder contains `Songlengths.md5` and nothing else. `STIL.txt` is not extracted by the
ingestion at all, so there is nothing on disk to parse. Doing this properly therefore starts in the
archive ingestion — extracting and storing the file — before any of the parse, index and display
work begins. That is a materially larger change than it looks from the outside, and it is why this
was not built alongside the other two: half of it, against an archive that does not carry the file,
would be worse than its absence.

**Recently played (3).** The smallest of the three and the one that removes a genuine, repeated
frustration created by the station itself. It is pure reuse: the row, the play action and the
seed-a-station action all exist as of this session. Shipping the station without it leaves a
one-way door.

## Status

Built and verified on the Pixel 4 on 2026-07-31: **(1) "Play all N tunes in this file"** and
**(3) recently played**. (2) STIL is blocked on the ingestion prerequisite above. The rest of the ten
are untouched.

## The rule these are judged against

Less is more. Each of these has to be one obvious action with a name that explains itself, reusing a
surface that already exists. Anything needing a new screen, a new vocabulary or a settings toggle to
explain it has failed the test — which is why "play all tunes in this file" beats a subsong browser,
and why recently played is a list of the same rows rather than a history feature.

## What I deliberately left out

Playback speed and PAL/NTSC switching (a correctness trap dressed as a feature), waveform export,
"smart" playlists, and any form of social layer. Each is either a gimmick at this scale or a second
product.
