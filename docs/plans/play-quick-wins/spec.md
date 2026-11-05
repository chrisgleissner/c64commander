# Play page quick wins: specification

Status: ready for implementation. Baseline: `origin/main` at `cf6cdcef0` (2026-10-30). Line counts and file
references below were measured there. Requirement IDs (`QW-…`) are stable; commits, tests and the PR cite them.

## Summary

Five small improvements to the SID listening experience. Each one reuses a surface the Play page already has,
adds at most one control, and adds no permanent height to any card:

| ID | Feature | Where it appears | Platforms | Estimate |
| --- | --- | --- | --- | --- |
| QW-LS | Lock screen, notification and headset: Previous, position and seek bar | System media control | Android | 1–2 days |
| QW-ALL | Play all search results | "Find a tune" sheet, on the existing match-count line | All | 0.5–1 day |
| QW-Q | Play next, Move up, Move down for playlist rows | Playlist row menu (⋮) | All | 1 day |
| QW-SH | Share a tune | "About this tune" row on the Now Playing card, and the playlist row menu | All (system share sheet on native, copy link on web) | 1 day |
| QW-SC | Waveform view on the Spectrum card | Spectrum card header (view switch) and canvas | Android, like the Spectrum card | 2–3 days |

Prerequisite work (`QW-PF`) creates room in two files that are at their size ceilings. It must land first.

What is deliberately out of scope, with the reason:

- **Per-voice view, voice mute/solo, savestate seeking.** These need engine changes (register capture per frame in
  two renderers, a mute patch for libSidplayEZ) and are not quick wins.
- **"Play all" for Liked tunes.** Pressing any row in Liked tunes already plays the whole liked list from that row
  (`LikedTunesList.tsx`, `buildLikedTunePlaylistItems`), and Shuffle already exists on the transport.
- **"Up next" for SID Radio.** A running station already owns the playlist (`stationPlaylistHandover.ts`), so its
  queued tunes are already the visible playlist rows.
- **iOS now-playing.** iOS builds only in CI and cannot be validated on the rig.
- **Named playlists and drag reordering.** Medium effort. QW-Q covers the common case without a drag gesture.

## Design rules for all five

These rules apply to every requirement below. A requirement that seems to conflict with one of them is wrong, and
the rule wins.

1. **No new card, no new screen, no permanent height.** Each feature reuses an existing row, menu, header or canvas.
   QW-ALL adds at most 24 px to a line that scrolls with the results; nothing else adds height.
2. **Consistency with what exists.**
   - Menu entries use the existing `ActionListMenuItem` `"action"` type.
   - Header controls use `CollapsibleSection` `actions`, the same slot the Sound card uses for its On/Off switch.
   - Sharing reuses the `@capacitor/share` pattern and the `isShareCancelled` handling in
     `src/lib/config/settingsExportShare.ts`.
   - Transport commands travel the existing `TransportCommand` path (`latchedCommandBus.ts` →
     `runTransportCommand`).
3. **Compact and keypad first.**
   - Every new control works with the focus ring alone, scrolls into view when selected, and has a 44×44 CSS px
     target.
   - Every new control fits the `compact` profile (320×426 CSS px) without horizontal scroll.
   - Text stays at or above 14 px (16 px for body text); nothing shrinks to fit.
   - Verify on the keypad handset with the `c64u-remote` APK.
4. **Wording.** Sentence case and American English. Use product names as they are (SID Radio, Live View, HVSC).
   Labels are verbs that say exactly what happens.
5. **No silent catch.** Every caught error is logged at WARN or ERROR with context, or rethrown with context.
6. **Documentation.**
   - `docs/cta-inventory.md` is updated in the same commit as each CTA change; `npm run lint:reference-docs` must
     pass.
   - Screenshots are regenerated only for the surfaces whose visible output changed.
7. **Test-driven, and each test proven able to fail.**
   - Every requirement gets its narrowest deterministic test, written first and seen failing.
   - Before the commit, revert the production change and confirm the test fails again.
   - Tests call the production symbol; they never reimplement the logic.

## QW-PF Make room first

Two files cannot take a single added line without exceeding their size ceiling:

- `src/pages/PlayFilesPage.tsx`: 3189 lines. Its recorded ceiling in `scripts/check-file-sizes.mjs` `GRANDFATHERED`
  is 3165, and the allowance is 25 lines, so the limit is 3190.
- `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt`: 999 lines. It is not
  grandfathered, and the hard limit is 1000.

### QW-PF-01 Extract the Play page's sheet wiring and transport wiring

- **Change:** move three blocks out of `PlayFilesPage.tsx` into hooks or components under `src/pages/playFiles/`,
  with no change in behavior:
  - the `useTransportCommands(...)` block and its comment (around line 690), into a hook `usePlayTransportCommands`
    that takes the handlers;
  - the `HvscSearchSheet` element and its handlers (`playFoundTune`, `playRecentItem`, `startStationFromFoundTune`),
    into a component `PlaySearchSheet`;
  - any other self-contained block needed to reach the target.
- **Target:** lower `PlayFilesPage.tsx` by at least 80 lines. Lower its `GRANDFATHERED` entry to the new count; the
  ceiling only ratchets down.
- **Tests:** the existing Play page unit and Playwright suites pass unchanged. `npm run lint:file-sizes` passes.
- **Verification:** `npm run lint`, `npm run test`.

### QW-PF-02 Extract the MediaSession code from the background service

- **Change:** move the MediaSession callback, `buildPlaybackState`, `publishPlaybackState` and
  `publishNowPlayingMetadata` from `BackgroundExecutionService.kt` into a new class `MediaSessionPublisher.kt` in the
  same package. The service owns one instance and delegates to it. No change in behavior.
- **Target:** the service falls to 900 lines or fewer.
- **Tests:** the existing `BackgroundExecutionServiceTest.kt` passes. A new `MediaSessionPublisherTest.kt` covers
  the moved state building, so later changes have a test to extend.
- **Verification:** `cd android && ./gradlew testDebugUnitTest` (JDK 21 from sdkman).

## QW-LS Lock screen, notification and headset

### Current behavior (verified)

- `BackgroundExecutionService.kt` publishes the title, artist and duration (`publishNowPlayingMetadata`).
- The playback state carries `PLAYBACK_POSITION_UNKNOWN` and these actions: PLAY, PAUSE, PLAY_PAUSE, STOP and
  SKIP_TO_NEXT.
- The callback handles `onPlay`, `onPause`, `onStop` and `onSkipToNext`. There is no `onSkipToPrevious` and no
  `onSeekTo`.
- The notification shows Play or Pause, then Next and Stop, with all three in the compact view.

As a result, Android shows no seek bar and no Previous button, a Bluetooth or car "previous" press does nothing, and
the lock screen cannot show elapsed time.

### QW-LS-01 Previous

- **Requirement:**
  - Add `PlaybackState.ACTION_SKIP_TO_PREVIOUS` to the actions whenever SKIP_TO_NEXT is offered.
  - Add `onSkipToPrevious`, which relays a new transport command `"previous"`.
  - Add a Previous action to the notification. Action order: Previous, Play/Pause, Next, Stop. Compact view:
    Previous, Play/Pause, Next.
  - The stale-session branch (`livenessStale`) is unchanged: it offers Stop only.
- **Web side:**
  - Add `"previous"` to `TransportCommand` (`src/lib/input/latchedCommandBus.ts`).
  - Add `previous` to `TransportCommandHandlers` (`src/pages/playFiles/transportCommands.ts`).
  - Wire it to the same `handlePrevious` the on-screen Previous button uses. Its existing rule, which restarts
    the current tune near the start of the order, then applies unchanged.
- **Acceptance:** a headset, Bluetooth or lock-screen Previous does exactly what the on-screen Previous does,
  including while a SID Radio station runs.
- **Tests:**
  - `transportCommands.test.ts`: `"previous"` calls `handlers.previous` and nothing else.
  - `MediaSessionPublisherTest.kt`: the actions include SKIP_TO_PREVIOUS while live and exclude it while stale; the
    callback relays `"previous"`.
  - `nativeMediaButtons.test.ts`: a relayed `"previous"` reaches the transport bus.

### QW-LS-02 Position, so Android draws a seek bar and elapsed time

- **Requirement:**
  - Add a plugin method `setPlaybackPosition({ positionMs, playing, seekable })` to `BackgroundExecutionPlugin`
    (TypeScript type in `src/lib/native/backgroundExecution.ts`, a no-op in `backgroundExecution.web.ts`, Kotlin
    in `BackgroundExecutionPlugin.kt`).
  - Native side: `PlaybackState.setState(state, positionMs, playing ? 1.0f : 0.0f, SystemClock.elapsedRealtime())`.
    Android advances the bar by itself, so the web layer does not poll.
  - The web side publishes the position only on these edges:
    - playback starts (tune start or subsong change),
    - pause and resume,
    - a seek completes (local or on the C64),
    - the duration becomes known or changes.
  - The position source is `playbackTimeStore` (`elapsedMs`); it is the same number the on-screen counter shows.
  - Add a manager function `setBackgroundExecutionPosition` in `backgroundExecutionManager.ts`. It sits beside
    `setBackgroundExecutionNowPlaying`, follows the same dedupe and retry-on-failure pattern, and logs failures at
    ERROR with context.
- **Acceptance:**
  - The lock screen shows elapsed time that matches the on-screen counter within 1 s after 60 s of playback.
  - It freezes on pause.
  - It jumps to the new position within 1 s of a seek.
- **Tests:**
  - `backgroundExecutionManager.test.ts`: one publish per edge; an identical repeat is deduped; a failed publish
    stays retryable.
  - `MediaSessionPublisherTest.kt`: the published state carries the position and speed 1.0 while playing, and
    speed 0 while paused.

### QW-LS-03 Seek from the lock screen

- **Requirement:**
  - When `seekable` is true, add `PlaybackState.ACTION_SEEK_TO` and handle `onSeekTo(pos)` by emitting a native
    event `backgroundSeekRequest { positionMs }`.
  - `seekable` comes from the same condition that enables the on-screen seek bar. Today that condition is inline in
    `PlayFilesPage.tsx` (the `remoteSeek.handlers ?? { onSeekToFraction: localEngineActive && … }` expression,
    around line 2594). Extract it into one exported function, for example
    `resolveSeekToFraction(...) => ((fraction) => void) | undefined`. Both the transport props and the lock-screen
    publisher must use that function, so they cannot disagree.
  - The web side converts `positionMs / durationMs` to a fraction and calls the resolved function.
  - The seek request is **not** latched. A seek that arrives while Play is unmounted is dropped and logged at WARN,
    because replaying a stale position later is wrong.
    - Use a separate non-latched channel, not `transportCommandBus`.
- **Acceptance:**
  - On phone playback of a SID with a known length, dragging the lock-screen bar seeks there.
  - On C64 playback, the drag works only on firmware where on-screen seeking is enabled; elsewhere the bar is shown
    without seeking (no ACTION_SEEK_TO).
  - Disks and programs are never seekable.
- **Tests:**
  - A unit test of `resolveSeekToFraction` covers: local SID with a duration, local SID without one, the C64 with
    and without seek support, and a disk.
  - A unit test shows that a seek event with no subscriber is dropped and logged, and not replayed to a later
    subscriber.

### QW-LS-04 Subsong in the media metadata

- **Requirement:** put the existing "Tune 3 of 19" text into `METADATA_KEY_ALBUM` when the file has more than one
  tune; omit it otherwise. Pass it through `NowPlayingInfo` as a new nullable field `album`.
- **Tests:** `backgroundExecutionManager.test.ts` dedupes on the new field; `MediaSessionPublisherTest.kt` puts the
  album only when present.

### QW-LS verification on hardware

- **Pixel 4,** default edition, phone playback (media volume 5 of 25 or lower; never above 10):
  - `droid_device.run_shell("dumpsys media_session")` shows the actions SKIP_TO_PREVIOUS and SEEK_TO and a position
    that advances.
  - `run_shell("cmd media_session dispatch previous")` (or `input keyevent KEYCODE_MEDIA_PREVIOUS`) goes back one
    tune.
  - Pull down the shade, drag the seek bar with `droid_input.swipe`, and confirm the on-screen counter follows.
    Take a screenshot.
  - Repeat the dispatch on C64 playback against `c64u`.
- **Keypad handset:** record whether the system shows media controls at all. Not an acceptance gate; this is
  information for the manual.

## QW-ALL Play all search results

### Current behavior (verified)

- The "Find a tune" sheet (`HvscSearchSheet.tsx`) shows one count line (`hvsc-search-count`, "87 matches" or
  "100 of 412 matches"), then rows that each offer only Play or Start station.
- The search returns at most `RESULT_LIMIT = 100` hits (`useHvscArchiveSearch.ts`).
- The composer link on the Now Playing card opens this sheet with the composer's name as the query. So "every tune by
  Rob Hubbard" is one search away, but has to be played one tune at a time.

### QW-ALL-01 The count line becomes the action

- **Requirement:** when there are two or more hits, the count line becomes a full-width button (44 px tall). It
  still scrolls with the results; it is not a sticky header.
  - Label: "Play all 87" when all matches are shown, and "Play these 100" when the list is capped.
    - The capped wording keeps the "of N matches" information: "Play these 100 of 412". The 100 shown are the best
      ranked.
  - Leading `Play` icon; trailing text in `text-muted-foreground` for the count part.
  - With one hit, or none, the line stays plain text as today.
- **Behavior:**
  - Insert all hits, in ranked order, directly after the current tune, using `buildFoundTuneItem` for each hit
    (each gets a unique id).
  - Then start the first inserted item with `startPlaylist(items, index, { replaceQueue: true })` and close the
    sheet.
  - This is the same path `playFoundTune` takes for one hit, generalized. Add a pure function
    `insertAllAfterCurrent(playlist, currentIndex, items)` beside `insertAfterCurrent` in `insertTuneNext.ts`.
- **While a SID Radio station runs:** behave exactly like a single found tune does today: the hits play next, and the
  station "keeps its place and carries on afterward" (the existing sheet copy).
- **Acceptance:**
  - From the composer link, one press plays every listed tune by that composer, in ranked order, with Next and
    Previous working over them.
  - The playlist that was there before is still there, after the inserted block.
  - On the compact profile with the keyboard up, the change costs at most one 44 px line.
- **Tests:**
  - `insertTuneNext.test.ts` covers `insertAllAfterCurrent` with an empty playlist, current at the end, current in
    the middle, and no current tune.
  - `HvscSearchSheet.test.tsx` covers:
    - the button appears only with two or more hits;
    - the label is correct for both the capped and uncapped case;
    - pressing it calls the new `onPlayAll` with every hit in ranked order and closes the sheet.
  - Playwright: a keypad-only walk reaches the button from the input with Down and activates it with OK.
- **Docs:** `cta-inventory.md` gets a new entry, `hvsc-search-play-all`, under the Find a tune sheet.

## QW-Q Play next, Move up, Move down

### Current behavior (verified)

- Playlist rows (`usePlaylistListItems.tsx`) have a menu (`menuItems`). It holds a "Details" group of info rows and
  a "Config" group with four config actions at the bottom. There is no way to reorder the playlist.
- Shuffle is a seeded traversal over playlist ids (`seededShuffleIds`, `resolveNextPlaylistIndex` in
  `playFilesUtils.ts`); it does not reorder the playlist.
- A running station's queue is the playlist. `isStationQueueEdited` compares id sets only, so reordering does not
  count as editing the station.

### QW-Q-01 Three queue actions at the top of the row menu

- **Requirement:** the row menu opens with three actions, then a separator, then the existing Details and Config
  groups unchanged:
  - **Play next.** Moves this row directly after the playing tune. If nothing is playing, it moves the row to the
    top. Disabled when the row is the playing tune or already directly after it.
  - **Move up.** Disabled on the first row.
  - **Move down.** Disabled on the last row.
- **Placement:** the actions come first, so a keypad user reaches them in one or two presses. The info rows are not
  focusable and stay below.
- **Shuffle on:** the three actions are shown disabled, and the menu shows one line of text above them: "Turn off
  Shuffle to change the order". Seeded shuffle derives its order from the playlist order, so a move would silently
  reshuffle every tune still to come.
- **Filter active:** while the playlist text filter or a type filter hides rows, Move up and Move down are disabled
  with "Clear the filter to change the order". A move swaps with a neighbor the user cannot see. Play next stays
  enabled.
- **Playlist loading:** all three are disabled, as the config actions already are (`isPlaylistLoading`).
- **Pure logic:** add a module `src/pages/playFiles/playlistReorder.ts` with
  `moveItem(playlist, id, delta)` and `moveAfterCurrent(playlist, currentIndex, id)`.
  - Both return `{ items, currentIndex }`, so the playing tune keeps playing and stays highlighted after a move.
  - Both return the input unchanged (same reference) for a no-op, so React does not re-render.
- **Wiring:**
  - Add a hook `usePlaylistQueueActions` that wraps `setPlaylist` and `setCurrentIndex`.
  - Pass it to `usePlaylistListItems` as one new option, `queueActions`.
  - `PlayFilesPage.tsx` gains at most five lines, which QW-PF-01 has made room for.
- **Focus:** after a move, the focus ring stays on the moved row, and the row is scrolled into view. Use the
  focus-follow mechanism the playlist list already uses; read `docs/plans/follow-focus/` before adding a new one.
- **Persistence:** the playlist repository already saves on change; a reordered playlist survives a relaunch.
- **Tests:**
  - `playlistReorder.test.ts` covers:
    - moving at the edges;
    - moving the playing row, and moving across it (the current index follows the playing id);
    - Play next with nothing playing, and when the row is already next;
    - the no-op identity.
  - `usePlaylistListItems.test.tsx` checks the menu order (three actions, then Details), the disabled reasons for
    shuffle, filter and loading, and that each action calls the handler with the row id.
  - Playwright: keypad-only, open a row menu, Move down twice, and the row order changes. Relaunch, and the order is
    kept.
- **Docs:** `cta-inventory.md` adds the three entries under the playlist row menu, with their disabled conditions.

## QW-SH Share a tune

### Current behavior (verified)

- `@capacitor/share` is used for settings export, diagnostics and trace export. There is no tune sharing.
- DeepSID's link format, read from its source (`js/main.js`, `updateURL` and `_playFromURLNow`):
  `https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid&subtune=3`.
  - The `/High Voltage SID Collection` prefix is omitted.
  - `subtune` is **1-based**, and DeepSID writes it only for files with more than one tune.
- HVSC virtual paths in the app already have that shape (`/MUSICIANS/H/Hubbard_Rob/Commando.sid`).

### QW-SH-01 What is shared

- **Requirement:** a pure function `buildTuneShare({ title, composer, released, virtualPath, songNr, subsongCount })`
  in `src/lib/playback/tuneShare.ts` returns `{ title, text, url }`:
  - `title`: the tune title.
  - `text`, in two lines:
    - Line 1: `Commando by Rob Hubbard (1985)`. The composer and year are omitted when unknown.
    - Line 2, only for a multi-tune file: `Tune 3 of 19`.
  - `url`: the DeepSID link. Encode each path segment with `encodeURIComponent` and keep the slashes. Add
    `&subtune=N` only when `subsongCount > 1`.
- **Scope:** only tunes whose HVSC path is known (`request.source === "hvsc"`, or a found or recent tune built by
  `buildFoundTuneItem`). Other sources have no public link, and sharing a phone-local file path would leak a private
  path. For those, the Share control is not rendered.
- **Tests:** `tuneShare.test.ts` covers:
  - single-tune and multi-tune files;
  - unknown composer and unknown year;
  - path segments with spaces and `&`, checked against DeepSID's own encoding of a real HVSC path containing a space.

### QW-SH-02 Where Share appears

- **Now Playing card:** on the "About this tune" row (`TuneDetails.tsx`). Today that row's toggle is `w-fit`, so the
  right side of the row is empty. Put a ghost button there, right-aligned on the same line:
  - icon `Share2` and the visible label "Share", with a 44 px target;
  - `data-testid="tune-share"`, accessible name `Share {title}`.
  - It is visible while the tune details are collapsed and adds no height.
- **Playlist row menu:** a fourth action, "Share", directly after QW-Q's three actions, for shareable rows only.
- **Behavior:**
  - Native: `Share.share({ title, text, url, dialogTitle: "Share tune" })`.
  - Web: `navigator.share` when available. Otherwise copy `text + "\n" + url` to the clipboard and show the toast
    "Link copied".
  - A cancel is logged at INFO through the existing `isShareCancelled` helper. Any other error is logged at ERROR
    with the tune path and shows the toast "Could not share this tune".
  - Share never contacts DeepSID or any other server.
- **Tests:**
  - `TuneDetails.test.tsx`:
    - the button renders only for a shareable tune;
    - it is on the toggle's row, with no extra block element;
    - pressing it calls the share function with the built payload.
  - A unit test for the share helper covers the native path, the web share path, the clipboard fallback, cancel,
    and error.
  - Playwright: keypad-only, the ring reaches Share from the About this tune toggle with Right, and on a 320 px
    viewport the toggle and Share stay on one line.
- **Docs:** `cta-inventory.md` entries for `tune-share` and the row-menu Share.

## QW-SC Waveform view on the Spectrum card

### Current behavior (verified)

- `SpectrumCard.tsx` (186 lines) draws per-channel level meters above a 48-band spectrum on one canvas. The canvas
  height comes from the display profile: compact 110 px, medium 190, expanded 240, plus the meter area.
- The data comes from the native `SpectrumAnalyzer.kt` (521 lines) through `readSpectrum`, which is served by
  `AudioProcessingBridge.kt` (94 lines).
- `SpectrumAnalyzer` already keeps a downmixed mono history ring, aligned to the speaker position for phone
  playback. For the Live View audio mirror, it is fed before the jitter ring.
- The card exists only where the native analyzer exists (Android), and it covers every source that reaches the
  phone's speaker: libSidplayEZ, reSIDfp in WASM, SIDLite, and Live View audio. The analysis happens after
  rendering, so no engine change is needed.

### QW-SC-01 Native waveform window

- **Request:** `readSpectrum` accepts a new optional flag `wave: true`.
- **Window:** when the flag is set, the frame carries `wave`: 256 points covering 1024 mono samples (21.3 ms at
  48 kHz). Each point is the mean of 4 samples.
- **Encoding:** base64 of an `Int8Array` (value × 127, clamped). That is 344 characters per frame, so the extra
  bridge cost is negligible next to the existing bands array.
- **Trigger:** within the 2048 samples that end at the frame's speaker-aligned position (or the newest sample for
  the mirror), start the window at the first rising zero crossing:
  - the previous sample is at or below −0.02 and the current sample is at or above 0;
  - this keeps a steady tone still on screen;
  - if there is no crossing, use the newest 1024 samples and set `waveTriggered: false`.
- **Cost control:** when `wave` is requested and the card is in Waveform view, the request also sends
  `bands: false`. The FFT is then skipped, and only the meters and the window are computed. In Spectrum view nothing
  changes.
- **Where the code goes:**
  - window extraction and triggering go in a new `dsp/WaveWindow.kt`, called from `SpectrumAnalyzer`;
  - the JSON field is added in `AudioProcessingBridge.kt`;
  - `StreamUdpPlugin.kt` (grandfathered at 1175) is not touched.
- **Tests:** `WaveWindowTest.kt` covers:
  - a 440 Hz sine yields a triggered window that starts within one sample of an upward crossing;
  - DC and silence yield `waveTriggered: false`;
  - full scale maps to ±127;
  - the window never reads beyond the samples held (the reach and shortfall rules of `SpectrumAnalyzer`).
  
  `SpectrumAnalyzerTest.kt` checks that `bands: false` skips the FFT and still returns the meters.

### QW-SC-02 The view switch, in the card header

- **Requirement:** the Spectrum card header (`CollapsibleSection` `actions`, the slot the Sound card uses for its
  switch) gets a two-option group, "Bars" and "Wave":
  - two buttons in `role="group"` with `aria-label="Spectrum view"`, each `aria-pressed`, each 44 px tall;
  - the same visual treatment as the Shuffle and Repeat buttons (outline, accent fill when pressed);
  - `data-testid`: `spectrum-view-bars`, `spectrum-view-wave`.
- **Visibility:** the group is shown only while the card is open, so the closed card stays one row with no new
  controls.
- **Fit:** on the compact profile, the title "Spectrum", the group and the chevron fit on one row with no horizontal
  scroll. If measurement shows they do not fit at 320 px, the summary line is dropped before anything else. Text is
  never shrunk.
- **Persistence:** the chosen view is remembered per device in UI preferences (`src/lib/uiPreferences.ts`), wrapped
  in try/catch with WARN logging, like the card's open state.
- **Keypad:** Left and Right move between the two buttons, and OK selects. The selected view applies at once.

### QW-SC-03 Drawing the waveform

- **Requirement:**
  - In Waveform view the canvas keeps its height. The meters stay on top; the spectrum area shows the waveform
    instead. Nothing on the card moves or resizes when switching views.
  - Draw one polyline in the spectrum foreground color from `spectrumColors.ts`, so every palette and theme
    applies.
  - Draw a faint center line, and show `waveTriggered: false` as a dimmer stroke.
  - Put the drawing in a new `src/lib/audio/spectrum/waveRenderer.ts`. `spectrumView.ts` is 664 lines and must not
    grow by more than the dispatch between the two renderers.
- **Unchanged:** the card's power rules. No analysis runs while the card is closed, off screen, paused or the
  document is hidden (`setSpectrumDemand`, `ScreenActivityWatch`). The `prefers-reduced-motion` handling and frame
  tiers of `spectrumView.ts` apply to both views.
- **Accessibility:**
  - The canvas `aria-label` follows the view: "Audio channel meters, with the waveform of the sound below".
  - The screen-reader readout of levels is unchanged.
  - The "Spectrum is available for sound played on this phone" message also applies to Waveform view.
- **Tests:**
  - `waveRenderer.test.ts`: base64 decoding and scaling to the canvas height, and the triggered and untriggered
    stroke.
  - `spectrumCard.test.tsx`:
    - the group renders only while open;
    - switching views sends `wave: true, bands: false`, and switching back stops sending them;
    - the choice persists.
  - Playwright `smallScreenErgonomics`: the header row fits at 320 px and the targets are at least 44 px.
    `keypadOnlyNavigation` reaches both buttons.
- **Docs:** update the Spectrum card entry in `cta-inventory.md` (it currently says the body "adds one control"; it
  now adds the view group in the header). Regenerate the Spectrum screenshots for the open card in both views.

### QW-SC verification on hardware

- **Pixel 4,** phone playback, media volume 5 of 25:
  - Play the tone-ladder SID (`tools/hil/make_tone_ladder_sid.py`). In Waveform view the trace holds still on each
    note.
  - Live View audio from `c64u` also draws.
  - Screenshot both.
- **Keypad handset** (`c64u-remote` APK): open the card, walk to the group with the keypad, and switch views. The
  header fits; record a screenshot at 320×427.

## Delivery

- **Branch:** `feat/play-quick-wins` from `origin/main`, in a git worktree. Never commit to `main`, and never touch
  the main checkout's uncommitted files.
- **Commit order:** QW-PF-01, QW-PF-02, then one commit (or a small series) per feature: QW-LS, QW-ALL, QW-Q,
  QW-SH, QW-SC. Each commit builds and passes `npm run lint` and `npm run test` on its own. QW-Q and QW-SH both touch
  the row menu, so QW-Q goes first.
- **Gates before the PR:**
  - `npm run lint` and `npm run test`.
  - `cd android && ./gradlew testDebugUnitTest`.
  - The targeted Playwright specs, then `npm run test:e2e`.
  - `npm run coverage:gate`: 93% lines and 85% branches merged. Patch coverage must be at least 94%, measured
    against the merged LCOV, not inferred from totals.
  - `npm run screenshots` for the changed surfaces only. Revert the other drift with explicit paths, never a bulk
    checkout.
- **Hardware:**
  - Deploy the default APK to the Pixel 4 and the `c64u-remote` APK to the keypad handset through droidctl.
  - Run the verification steps above.
  - Run the merge gate:
    `node tools/hil/merge_gate.mjs --host c64u --iface <lan ip> --json artifacts/hil-gate.json`.
  - The Pixel volume never goes above 10 of 25; the gate's audible stages run at 5.
- **PR description:** follows the user's PR rules. For each QW ID, state:
  - the previous behavior;
  - the change;
  - the test, and what was reverted to show that it fails;
  - the device evidence.
