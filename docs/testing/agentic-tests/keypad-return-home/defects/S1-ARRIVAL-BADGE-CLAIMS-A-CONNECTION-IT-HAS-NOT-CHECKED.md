# S1 — On arrival the app claims a connection it has not checked

- Severity: S2
- Priority: P1
- Product area: Connection state and the health badge
- Route: every route; the badge is in the app bar
- Build identity: baseline `1.0.5-rc1-6ba84`, fixed `1.0.5-rc1-81a3b`, package `uk.gleissner.c64uremote`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, `192.168.1.146`

## Previous behaviour

Three things together decided what the app believed on arrival:

- `ConnectionController`'s background probe schedule returns early unless the state is
  `DEMO_ACTIVE` or `OFFLINE_NO_DEMO`, so nothing probes the device at all while the app believes it
  is connected.
- Both `visibilitychange` handlers — `ConnectionController`'s and `networkTransitions`' — act only
  on those same two states, so returning to the foreground while connected ran no probe.
- `deriveConnectivityState` maps `REAL_CONNECTED` to `Online` with no staleness bound, and
  `getBadgeAriaLabel` then reads "Connected to c64u, system healthy".

The app learned it had lost the device only when one of its own requests failed.

## The defect

The user's phone sleeps in a pocket and leaves the network. The app is not running while it sleeps.
On return, the connection state is as old as the last time the app spoke to the device, and the
badge asserts it. Nothing corrects it until the user presses something that fails, which is the
opposite of what the badge is for: it exists so they know before they press.

## The implemented change

Returning to the foreground while the state reads `REAL_CONNECTED` runs one probe.
`connectionRevalidation` carries a flag while that probe is in flight, and
`deriveConnectivityState` maps `REAL_CONNECTED` plus that flag to `Checking`, so the badge reads
"Connecting to c64u" rather than asserting a connection nothing has confirmed. A probe that answers
leaves the state alone. One that does not goes through the existing two-probe confirmation and
shows the device offline.

The flag lives in its own module rather than in `ConnectionSnapshot` because
`connectionManager.ts` is one of the grandfathered oversized files and the field pushed it past
its ceiling.

## How the change was verified

On the handset, with the radio still off at the moment of arrival — so the only correct answer is
"offline" — the badge read "Offline, device not reachable" 322 ms after the app appeared.

`tests/unit/connection/networkTransitions.test.ts` covers three cases against the shared fake
Ultimate: the app checks on return and stays connected when the device answers, it shows the device
offline when the device stopped answering while the app was away, and the badge says it is checking
while the probe is in flight. Reverting the whole of `src/lib/connection/networkTransitions.ts`
fails all three, the decisive one with `expected 'REAL_CONNECTED' to be 'OFFLINE_NO_DEMO'`.
Reverting `src/lib/diagnostics/healthModel.ts` alone fails the badge case with
`expected 'Online' to be 'Checking'`.

The test that stood here before asserted the previous behaviour — "does nothing on return to the
foreground while still connected", including that it sent no request. That expectation is what was
wrong, so it now asserts the check.

## What a user does differently now

They look at the badge when they walk in and it tells them whether the machine is reachable,
instead of telling them what was true before they left.
