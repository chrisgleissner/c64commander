# S5 — Home's System info button is not in the focus ring

- Severity: S3
- Priority: P2
- Product area: Keypad navigation
- Route: Home
- Control: `home-system-info` (App / Device / Firmware versions)
- Build identity: `1.0.5-rc1-1c68d`, package `uk.gleissner.c64uremote`
- Geometry: 320 x 426.7 CSS px, `compact` profile
- Reproduction rate: 2/2 — the automated sweep and a hand walk of the ring

## Previous behaviour

An element carrying `data-section-label` becomes an implicit focus group, and
`FocusDiscoveryEngine.collectRingNodes` dropped a group with no in-scope interactive descendant as
empty chrome.

## The defect

`SystemInfo` renders a `<button data-testid="home-system-info" data-section-label="System info">`
whose only children are spans. It is therefore discovered as a group, found to be empty, and
dropped from the ring. No key reaches it.

Hand-verified on the handset: 34 consecutive Down presses walked the whole Home ring twice. The
order runs `... home-stream-status, home-config-actions, tab-home, tab-play, ...` — the ring goes
straight from the Config card to the tab bar, and `home-system-info` never appears. The element is
present and laid out (304 x 58 px at y 634) and is a real `<button>`.

The code comment at that filter said an interactive group element "falls through to a leaf via the
next pass (isGroup recomputed in assemble())". It does not: the node is removed from the array, so
`assemble` never sees it.

## The implemented change

A group with no in-scope descendant is demoted to a leaf when the element is itself focusable or
carries an explicit registration, and dropped only when it is neither — which is what "empty
chrome" was meant to mean.

## How the change was verified

`tests/unit/lib/input/focusDiscovery.test.ts` gained a case with three siblings: a labelled section
with a button inside it, a labelled `<button>` with no interactive children, and a labelled empty
`<div>`. The ring must contain the first two and not the third, and the labelled button must be a
leaf rather than a card to descend into. Reverting the whole of `src/lib/input/focusDiscovery.ts`
fails it with `expected [ 'streams', 'edit' ] to include 'system-info'`.

## What a user does differently now

They can reach the versions of the app, the device and its firmware with the keypad, which is what
they are asked for when reporting a problem.
