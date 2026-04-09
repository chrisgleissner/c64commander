# Device Switcher UX Recommendations

Date: 2026-04-09

## Goal

Define the calmest device-switching UX for small screens.

The preferred solution should:

- avoid adding permanent UI for the single-device majority
- keep routine multi-device switching fast
- use progressive disclosure correctly
- keep diagnostics focused on diagnostics
- let the primary switching surface optimize for device names, not technical metadata

## Inputs Reviewed

Documents reviewed in full:

- `docs/research/device-switcher/device-switch-spec.md`
- `docs/research/device-switcher/plan.md`
- `docs/research/device-switcher/prompt.md`
- `docs/research/device-switcher/v2/ux-recommendations-2026-04-09.md`

Screenshots reviewed:

- `docs/img/app/home/profiles/medium/01-overview.png`
- `docs/img/app/diagnostics/switch-device/01-picker.png`
- `docs/img/app/diagnostics/01-overview.png`
- `docs/img/app/settings/sections/02-connection.png`

## Executive Decision

The most elegant interaction model is:

1. Tap the badge to open Diagnostics, as today.
2. Long press the badge to open a compact device picker.
3. Show no persistent device-switcher section inside Diagnostics.
4. Keep device management in Settings and Diagnostics overflow.

This is the strongest solution because it preserves the badge as the single entry point for device context while separating two intents cleanly:

- tap = inspect status
- long press = switch target

It also removes the need for a permanently visible switch surface that would otherwise compete with Home content and with Diagnostics content.

## Why This Is Better Than an Inline Switcher

### 1. It removes the space tax completely

The earlier inline-switcher direction solved the extra-tap problem, but it still introduced a permanent UI block for multi-device users.

That is still a cost:

- another section to scan
- another container in Diagnostics
- another competing block above Activity

The long-press picker removes that cost entirely.

### 2. It uses the badge as the natural home for device-level actions

The badge already communicates:

- current device identity
- current health state

That makes it the correct home for both:

- inspection of the current device
- switching to another device

The interaction difference can be carried by gesture instead of by extra layout.

### 3. It applies progressive disclosure correctly

Users do not always need to see a list of devices.

They only need it at the moment they intend to switch.

Therefore the switch list should appear only on demand.

This is exactly what progressive disclosure is for.

### 4. It keeps diagnostics focused

Diagnostics should answer:

- what am I connected to
- is it healthy
- what just happened

It should not also have to carry a dedicated switcher block unless there is no better home.

With the badge long press, there is a better home.

### 5. It makes the switch list as concise as it should be

When the picker is summoned intentionally, it can be ruthlessly minimal.

For switching, the user mostly needs device names.

They do not need to keep seeing:

- hostnames
- ports
- product-family codes
- unique-id fragments

Those details remain available elsewhere when needed.

## Core UX Principles

### 1. No permanent UI without permanent value

If the user has one device, no switching UI should be visible.

If the user has multiple devices, switching UI should appear only when the user explicitly asks to switch.

### 2. One anchor, two intents

The badge should be the single anchor for device-level actions.

- tap opens Diagnostics
- long press opens the device picker

This is cleaner than splitting device actions across multiple permanent surfaces.

### 3. The primary switching surface should be name-first

The switching picker should optimize for recognition, not diagnosis.

The primary item content should be the device name.

### 4. Technical detail belongs behind disclosure

Technical detail remains important, but it should live in the right places:

- Health for the current selected device
- `Connection details` from overflow
- Settings for full saved-device definitions

### 5. Gesture should reduce UI, not hide essential understanding

Long press is appropriate here because it opens an intentional action list tied to one obvious object: the badge.

The user does not have to learn a hidden gesture to access critical status information, because normal tap still opens Diagnostics.

## Recommended Interaction Model

### Case A: Exactly 1 Saved Device

Behavior:

- tap badge opens Diagnostics
- long press on the badge does nothing, or produces no switcher because there is nothing to switch to
- no Devices section appears in Diagnostics

Diagnostics overflow should include:

- `Manage device`
- `Edit current device`
- `Connection details`

Settings remains the full management surface.

### Why this is correct

This keeps the single-device experience maximally calm.

There is no permanent switch affordance because no switch is possible.

### Case B: 2 or More Saved Devices

Behavior:

- tap badge opens Diagnostics
- long press badge opens a compact picker of saved devices
- tapping a device in that picker switches immediately
- Diagnostics contains no always-visible switcher section

This preserves a very low interaction burden without paying with permanent chrome.

## Device Picker Design

The device picker should be a decision interstitial, not a management surface.

That means:

- compact
- short-lived
- singular purpose
- no secondary admin actions inside it

Under the current UX guidelines, this is best treated as a modal decision surface.

## Picker Content

The picker should contain:

- title: `Switch device`
- a vertical list of saved devices
- optional cancel affordance if required by the shared modal pattern

The picker should not contain:

- `Manage`
- add/delete actions
- edit controls
- helper paragraphs
- hostnames in the default row
- product codes in the default row
- unique-id fragments in the default row

## Device Row Design

Each picker row should default to a single purpose and a single dominant datum:

- device name

Trailing treatment may show:

- selected checkmark
- `Verifying`
- `Offline`
- `Mismatch`

That is enough.

In the healthy idle state, the row should be name-only plus selection state.

## Progressive Disclosure Rules

### Default picker state

Show only device names plus minimal state.

Examples:

- `Studio`
- `Office U64`
- `Bench`

### When more detail is justified

Only surface more detail inline when the state is exceptional or ambiguous, for example:

- mismatch
- offline target
- duplicate or unclear labels not yet cleaned up

Even then, the detail should be minimal and temporary.

### Where technical details live instead

- Health card for the currently selected device
- Diagnostics overflow via `Connection details`
- Settings for host, ports, label editing, and deeper management

If users cannot switch confidently by name, the product should improve naming guidance rather than permanently polluting the switcher with network identifiers.

## Switch Flow

Recommended flow:

1. user long presses the badge
2. picker opens immediately
3. user taps the target device name
4. selection state updates immediately from local metadata
5. verification begins in the background
6. picker dismisses or transitions cleanly according to the chosen motion model
7. final state resolves to `Connected`, `Offline`, or `Mismatch`

This keeps the switching action compact and intentional.

## Diagnostics Role After This Change

Diagnostics should no longer be the primary switching surface.

Its role becomes:

- inspect current health
- inspect current device details
- review activity and problems
- access secondary actions through overflow

This is a cleaner use of the sheet.

## Settings Role After This Change

Settings remains the source of truth for device administration:

- add device
- edit host and ports
- rename
- delete
- short label authoring
- deeper connection management

The picker should never drift into CRUD.

## Discoverability Guidance

Long press is elegant here, but discoverability still needs to be handled deliberately.

Recommended approach:

- do not add permanent instructional copy to the main UI
- consider a one-time hint, onboarding note, or release note that teaches `Long press badge to switch device`
- reinforce the model in Settings or help text rather than in the primary browsing surfaces

The product should not sacrifice calmness just to explain the gesture continuously.

## Consistency Guidance

### 1. Keep the badge semantics stable

The badge remains the device-context object everywhere.

Users should learn one pattern:

- tap for status
- long press for switching

### 2. Keep names aligned across surfaces

The same device naming should appear in:

- badge label
- picker rows
- Health card
- Settings saved-device list

If the names are not good enough for confident switching, fix the names.

### 3. Avoid fallback creep

Do not reintroduce an inline Diagnostics switcher unless real usage proves the long-press model is failing.

The default assumption should be that the picker is enough.

## Why This Fits the Reviewed Screens

### From the Home screenshot

The badge already sits in the strongest possible place for a device-context action.

Using a long press there avoids adding any new visual weight to the page.

### From the Diagnostics screenshots

The current Devices card adds bulk and duplicates responsibilities.

Removing it simplifies the Diagnostics layout immediately.

### From the Settings screenshot

Settings already owns saved-device administration well.

That makes it unnecessary to embed management or switching controls in multiple places.

## Final Recommendation

Ship the following UX:

1. Keep tap on the badge mapped to Diagnostics.
2. Add long press on the badge to open a compact `Switch device` picker.
3. Remove the persistent Devices switcher section from Diagnostics.
4. Make the picker name-first: in the healthy idle state, rows should show device names plus minimal selection state only.
5. Keep hostnames, product-family codes, and identity details behind progressive disclosure in Health, overflow details, and Settings.
6. Keep device management in Settings and Diagnostics overflow, not in the picker.

This is the calmest and most elegant solution.

It removes permanent switcher chrome, preserves fast access for multi-device users, and uses the badge as the single coherent anchor for device status and device switching.

## Screenshot Recommendations If Implemented

If this direction is implemented, the documentation set should cover:

1. Home with the standard badge state.
2. The `Switch device` picker opened from a badge long press.
3. Picker state during `Verifying` after selection.
4. Diagnostics without a Devices section.
5. Settings connection section as the management destination.
