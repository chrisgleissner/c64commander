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

**2. STIL.** HVSC ships the SID Tune Information List beside `Songlengths.md5` — per-tune and
per-subsong notes, and the cover/original relationships that are half the pleasure of the archive
("this is Rob Hubbard's Commando; subsong 2 is the high-score tune"). The app already ingests one
sidecar file from that archive on a discovery hook; this is the same shape of problem, solved a
second time. It turns the credits line from a specification into a story, and it is the single
richest thing the archive knows that the app currently ignores.

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

**STIL (2).** The one that makes the app feel like it belongs to the SID world rather than merely
reading its files. It is a known quantity architecturally — the same discovery, parse, index and
lookup path the songlengths already take — and it lands entirely inside an existing UI surface.
This is the highest ceiling of the ten.

**Recently played (3).** The smallest of the three and the one that removes a genuine, repeated
frustration created by the station itself. It is pure reuse: the row, the play action and the
seed-a-station action all exist as of this session. Shipping the station without it leaves a
one-way door.

## The rule these are judged against

Less is more. Each of these has to be one obvious action with a name that explains itself, reusing a
surface that already exists. Anything needing a new screen, a new vocabulary or a settings toggle to
explain it has failed the test — which is why "play all tunes in this file" beats a subsong browser,
and why recently played is a list of the same rows rather than a history feature.

## What I deliberately left out

Playback speed and PAL/NTSC switching (a correctness trap dressed as a feature), waveform export,
"smart" playlists, and any form of social layer. Each is either a gimmick at this scale or a second
product.
