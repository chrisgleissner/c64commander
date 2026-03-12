# Volume Control Model For Play Files

## Executive Summary

The converged model is:

- The C64U `Audio Mixer` values are the only authoritative volume state.
- The Play page slider does not represent a virtual global volume. It is a linked editor that writes a real value to each enabled SID volume on the device.
- The Play page mute button is the only temporary app-side abstraction. It works by capturing the current enabled SID volumes, writing `OFF` to those same SIDs, and later restoring the captured values.
- Playback lifecycle events must not restore old volume values. Stopping playback, changing track, leaving the page, or reopening the app must not roll back device volume settings.
- The Play page must distinguish three states that are currently conflated:
  - device volumes are all `OFF`
  - device volumes are mixed
  - a reversible Play mute session is active

This removes the current reliability problems because it eliminates the fake playback-session override model, removes most shadow state, and makes every page render the same device-backed data.

## Current Architecture Analysis

### Device-backed reads

The Play page volume hook, [`src/pages/playFiles/hooks/useVolumeOverride.ts`](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/useVolumeOverride.ts), reads:

- `Audio Mixer` SID volume items
- `SID Sockets Configuration`
- `SID Addressing`

Those reads come from `useC64ConfigItems`, which is backed by the React Query key `["c64-config-items", category, itemKey]` in [`src/hooks/useC64Connection.ts`](/home/chris/dev/c64/c64commander/src/hooks/useC64Connection.ts).

From those responses, the Play page derives:

- the set of enabled SID outputs
- the available volume steps
- a local `volumeState` reducer with `index`, `muted`, and `reason`

### Local Play-page state

The Play page keeps substantial local shadow state:

- `manualMuteSnapshotRef`
- `pauseMuteSnapshotRef`
- `volumeSessionSnapshotRef`
- `volumeSessionActiveRef`
- `previousVolumeIndexRef`
- `volumeUpdateSeqRef`
- `volumeUiTargetRef`
- `resumingFromPauseRef`

That means the Play page is not rendering straight from device state. It is rendering a local interpretation of device state plus several temporary snapshots and guards.

### Write path

The Play page writes through `useC64UpdateConfigBatch`, which sends `POST /v1/configs` with `immediate: true`.

Important detail: `useC64UpdateConfigBatch` invalidates `["c64-category", category]` and `["c64-all-config"]`, but it does not invalidate the `["c64-config-items", ...]` queries that the Play page actually observes. That mismatch exists in [`src/hooks/useC64Connection.ts`](/home/chris/dev/c64/c64commander/src/hooks/useC64Connection.ts).

Home avoids part of this problem because it maintains explicit `configOverrides` and invalidates `c64-config-items` directly in [`src/pages/home/hooks/useConfigActions.ts`](/home/chris/dev/c64/c64commander/src/pages/home/hooks/useConfigActions.ts). Play does not.

### Event ordering today

For slider movement on Play:

1. The slider updates local UI immediately.
2. The shared slider component throttles async change callbacks.
3. `useVolumeOverride` adds another 200 ms timer before sending the batch update.
4. The batch mutation resolves.
5. The Play page waits for device-backed query data to drift into agreement with the local reducer.
6. A sync effect may keep, clear, or defer UI correction based on `volumeUiTargetRef`.

For mute/unmute:

1. Play captures a local snapshot.
2. Play writes `OFF` or restore values to the device.
3. A local reducer flips between muted and unmuted.
4. A separate sync effect later tries to infer the same state again from device responses.

For playback lifecycle:

- playback start may call `ensureUnmuted`
- pause writes `OFF` to SID volumes and marks volume state as muted
- resume restores a pause snapshot and marks volume state as unmuted or muted
- stop, navigation, and playback end call `restoreVolumeOverrides`, which restores an earlier session snapshot

### UI state ownership today

Volume state is effectively owned by multiple places at once:

- the device `Audio Mixer`
- React Query cache
- the `volumeState` reducer
- manual mute snapshot state
- pause mute snapshot state
- playback-session snapshot state

That is the core architectural problem.

## Failure Analysis

### 1. The Play page has two competing truths

The device is supposed to be authoritative, but the Play page keeps a separate reducer and multiple snapshots. The sync effect in `useVolumeOverride` continuously tries to reconcile local state with device reads. That is why controls can appear to revert or ignore user input.

### 2. Successful writes do not reliably refresh the queries Play is using

`useC64UpdateConfigBatch` does not invalidate the `c64-config-items` queries used by Play. Because those queries have `staleTime: 30000`, Play can keep rendering stale values for a long time. That stale read then feeds the sync effect and can pull the slider back to an older value.

This is a direct explanation for the observed slider snap-back and unreliable mute feedback.

### 3. The Play page compresses four independent values into one synthetic index

The device has four independent SID volumes. Play reduces them to one slider index, usually by choosing the most common active value. That means:

- mixed device states cannot round-trip cleanly
- the UI can pretend there is one value when there is not
- unmute fallback logic can overwrite distinct per-SID values with one shared value

This is not a faithful model of the device.

### 4. The current mute model mutates the restore snapshot

While muted, slider movement edits `manualMuteSnapshotRef` instead of device state. That mixes two different concepts:

- pre-mute values that should be restored
- a new target value chosen while muted

That makes mute/unmute harder to reason about and creates hidden state the user cannot see on other pages.

### 5. Playback lifecycle restoration violates device truth

`volumeSessionSnapshotRef` captures earlier device values and restores them on stop, navigation, or playback end. That turns a persistent device configuration into a temporary Play-page override.

This creates several bad outcomes:

- a Play-page volume change can disappear after playback stops
- a Home or Config change made during playback can be overwritten later
- the app is no longer MVC-consistent because playback lifecycle becomes an invisible writer

### 6. Pause/resume reuses the same mute state machine

Pause currently writes `OFF` to SID volumes and reuses the Play mute state. That introduces another actor into the same reducer and snapshot system. Manual mute and pause mute therefore interfere with each other.

## Design Principles

1. Device truth only. Persistent SID volumes live only on the C64U.
2. One meaning per control. The Play slider edits device SID volumes. The Play mute button creates or clears a reversible mute session.
3. No playback-lifecycle rollback. Start, stop, pause, resume, next, previous, navigation, and remount must not restore old volume values.
4. Minimal shadow state. The only app-side state allowed is transient UI draft state plus the explicit mute restore snapshot required for reversibility.
5. External changes win. If Home, Config, or the device itself changes volume state, Play must adopt that state instead of trying to restore older assumptions.
6. Mixed states must be visible. The UI must not pretend there is a single volume when the device has multiple different values.
7. Writes must be confirmed against the same queries the UI renders.

## Proposed Architecture

### Authoritative source of truth

The authoritative source is the device `Audio Mixer` category, filtered by the current SID enablement from:

- `SID Sockets Configuration`
- `SID Addressing`

The React Query cache is only a transport cache for that device state.

### What the Play page controls

The Play page controls actual SID volumes on the device.

It must not implement:

- a derived global multiplier
- a playback-session override
- a UI-only fake mute

The slider is a linked editor:

- it targets the enabled SID outputs only
- on commit, it writes the chosen value to every enabled SID volume
- the resulting device state is persistent and visible on Home and Config immediately after confirmation

### Derived read model

For the enabled SID set, Play derives one of these display states:

1. `unavailable`
   No enabled SID outputs. Disable the slider and mute button.

2. `uniform`
   All enabled SID volumes have the same device value. Show that exact value on the slider.

3. `mixed`
   Enabled SID volumes differ. Show a mixed state instead of a fake single value.

4. `play-muted`
   A validated Play mute session exists and the device still matches the muted postcondition for the SIDs muted by that session.

Important rule: `all OFF` is not the same as `play-muted`.

If all enabled SID volumes are `OFF` because the device is simply configured that way, Play shows a normal device state, not a reversible mute state.

### Local app state allowed

Only two local state buckets are justified:

1. `pendingWrite`
   Tracks an in-flight Play volume or mute mutation so the UI can hold the user’s last committed intent until the read-after-write confirmation returns.

2. `playMuteSession`
   A shared store keyed by device identity that contains:
   - exact pre-mute values per SID name
   - the SID names that this mute session actually muted
   - the device identity and creation time

This store may live in a small shared app store plus `sessionStorage` so it survives route changes. On restore, it must be validated against current device state before being trusted.

No playback-session volume snapshot is allowed.

## Mute/Unmute Strategy

### Mute

When the user taps `Mute`:

1. Read the latest confirmed enabled SID volumes.
2. Capture the exact per-SID values into `playMuteSession`.
3. Send one batch update that writes `OFF` to the enabled SID set.
4. Read back the same `c64-config-items` queries used by the page.
5. Mark the session active only for the SIDs confirmed to be `OFF`.

If the readback does not confirm the full mute, retain only the SIDs that actually reached `OFF` in the session store and show a partial-failure message.

### Unmute

When the user taps `Unmute`:

1. Build restore updates from `playMuteSession` for still-enabled SIDs only.
2. Send one batch update with those exact saved values.
3. Read back device state.
4. Remove restored SIDs from the session store.
5. Clear the mute session when all tracked SIDs are restored or no longer eligible.

### Snapshot invalidation rules

The mute session must be cleared, fully or partially, when device truth has moved on:

- If a tracked muted SID is no longer `OFF`, some other writer changed it. Drop that SID from the mute session.
- If a tracked SID becomes disabled or unmapped, drop it from the mute session.
- If the session becomes empty, the button returns to `Mute`.

This prevents Play from restoring stale values over newer changes from Home, Config, or the device.

### Slider behavior while muted

While a Play mute session is active, the slider should be disabled.

Reason:

- it keeps mute semantics explicit
- it removes the hidden “change the future unmute target” behavior
- it reduces shadow state
- it makes unmute strictly reversible

## UI Behaviour Specification

### Control states

- No enabled SID outputs:
  - slider disabled
  - mute button disabled
  - helper text: no active SID outputs

- Uniform device state:
  - slider shows the exact device value
  - mute button label is `Mute`

- Mixed device state:
  - slider shows `Mixed`
  - first committed slider move writes one chosen value to all enabled SID outputs
  - mute button label is `Mute`

- Play mute session active:
  - mute button label is `Unmute`
  - slider disabled
  - other pages still show actual `OFF` values because those are the current device values

- All enabled SIDs already `OFF` without a Play mute session:
  - show the device as `OFF`
  - do not show `Unmute`
  - the state is not reversible because Play did not create it

### Slider write behavior

- Dragging updates local UI only.
- Device write happens on commit, not on every intermediate move.
- If a later commit occurs while one write is in flight, serialize mutations and keep only the last committed value.

This is the simplest deterministic model for rapid interaction.

### Feedback

- Button and slider enter a pending state while a write is in flight.
- The pending state clears only after read-after-write confirmation.
- If confirmation fails, the UI reverts to the last confirmed device state and shows an error.

## Synchronization Model

### Cross-page consistency

Home, Config, and Play must all render the same device-backed categories.

Every Audio Mixer volume write must invalidate and refetch:

- the exact `c64-config-items` query for `Audio Mixer`
- the exact `c64-config-items` queries for SID enablement
- any broader category queries that are also visible elsewhere

Play must not depend on `c64-category` invalidation alone.

### Rendering rule

Every page renders from the latest confirmed device state.

Play applies one extra layer only:

- validated `playMuteSession`

That layer is allowed only to decide whether the button should say `Unmute` and which saved values to restore. It is not allowed to override the displayed device volumes.

### External updates

If Home or Config changes a SID volume while Play is visible:

- the device-backed query refresh updates Play
- Play moves to `uniform`, `mixed`, or `OFF` based on the new device state
- any conflicting mute-session entries are dropped

## Edge Cases

### Device disconnect

- keep showing the last confirmed device state
- disable new writes
- preserve `playMuteSession` so unmute can be retried after reconnect
- on reconnect, validate the session against current device state before offering `Unmute`

### Partial SID availability

- only enabled SIDs are controlled
- disabled or unmapped SIDs are ignored for slider writes
- if a SID becomes disabled while muted, drop it from the mute session instead of trying to restore it

### Concurrent updates

- external device changes always win
- after each Play write, confirm with a fresh read
- if confirmation disagrees with the requested target, show actual device state and do not force a rollback

### Rapid slider movement

- use commit-only writes
- serialize commits
- last committed value wins

### Partial device failures

- treat every mutation as tentative until readback confirms it
- if only some SIDs changed, render the resulting mixed state from the device
- preserve mute restore data only for SIDs still muted by the active Play session

## Implementation Guidance

1. Remove the playback-session volume override model.
   Delete the logic built around `volumeSessionSnapshotRef`, `volumeSessionActiveRef`, and `restoreVolumeOverrides`.

2. Stop using the volume reducer as a second truth source.
   Replace it with derived selectors from confirmed device state plus a small `pendingWrite` state.

3. Introduce a shared `playMuteSession` store.
   Scope it by connected device identity. Persist it only for the current app session. Validate it on every mount and reconnect.

4. Split `all OFF` from `play-muted`.
   `Unmute` must appear only when a valid Play mute session exists.

5. Fix query invalidation.
   Audio Mixer writes must invalidate and refetch the exact `c64-config-items` queries that Play and Home use, not just `c64-category`.

6. Use read-after-write confirmation.
   A Play write is complete only after the same observed queries show the expected result or a confirmed partial result.

7. Disable the slider while a Play mute session is active.
   That keeps mute reversible and removes hidden future-state editing.

8. Decouple pause/resume from Play mute.
   Pause must not dispatch into the same mute state machine. The simplest option is to let pause control only machine execution, not persistent SID volume settings.

9. Preserve mixed states in the UI.
   The Play page must expose that the device currently has multiple different SID volumes instead of collapsing them to a majority vote.

This design satisfies the stated objectives:

- reliable because device reads confirm every visible state
- simple because Play has one real slider and one explicit mute session
- MVC-consistent because playback lifecycle no longer rewrites configuration behind the user’s back
- minimal in duplicated state because only the reversible mute snapshot remains on the app side
