# TOOLING-001 — A debug install points the app at a reserved machine and a stale address

- Severity: TOOLING
- Priority: P1
- Product area: Build and rig setup
- Build identity: `1.0.5-rc1-6ba84`, debug APK, package `uk.gleissner.c64uremote`
- Pixel 4 identity: `9B081FFAZ001WX`
- First reproduced UTC: `2026-09-19T08:37:45Z`
- Reproduction rate: 1/1, and on every debug install this helper has ever produced

## Previous behaviour

`build_debug_saved_devices_bootstrap_json` in `scripts/lib/build-fast-path.sh` emitted two fixed
entries: `u64` at `192.168.1.13` first, and `c64u` at `192.168.1.167` second. `build` exports that
JSON as `VITE_DEBUG_SAVED_DEVICES_JSON` for every debug APK, and the app seeds its saved-device
list from it on first launch, selecting the first entry.

## The defect

The first entry named the U64, which `AGENTS.md` and this hunt's brief both reserve for another
agent, including probes. A debug install therefore selected the reserved machine and probed it at
startup; the app's own log records `Reachable active device observed; promoting connection` against
`192.168.1.13` at `08:37:45Z` on a run that was supposed to touch `c64u` only.

The second entry's address had not been the C64 Ultimate's for some time — `/etc/hosts` on this
host carries `192.168.1.167` only as a commented-out former address, and the current one is
`192.168.1.146`. So the one device a HIL session was allowed to drive was seeded with a host that
answers nothing.

This is the build-script form of the trap recorded as "app pointed at the wrong Ultimate": the
harness probes one machine while the app is selected on another, and the stages that follow report
zero frames and zero tone bursts with no fault in the code under test.

## The implemented change

The helper now resolves each device name through the host database at build time
(`getent hosts`, preferring an IPv4 answer because the app builds `http://<host>/` by
concatenation). The default list is `c64u u2`. A name that does not resolve is left out rather than
baked in as an address that used to be right. `BUILD_DEBUG_SAVED_DEVICE_NAMES` overrides the list,
and an empty value injects nothing.

## How the change was verified

`tests/unit/scripts/buildFastPath.test.ts` gained four cases: a resolvable name carries the address
`getent` reports for it, an unresolvable name is left out, an empty list injects nothing, and the
output contains neither of the two previously hardcoded addresses. Reverting the whole of
`scripts/lib/build-fast-path.sh` to its previous content fails all four.

## User impact

None directly — this is a developer and rig defect. Its cost is measured in HIL sessions: a run
seeded this way produces confident, wrong diagnoses about the app.
