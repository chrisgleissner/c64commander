# Content Explorer — Initiative

A cohesive, feature-flagged extension that lets C64 Commander do things it cannot
do today:

1. **Look *inside* a disk image** and launch any single program from it (not just mount the whole disk).
2. **Search across the contents of disk images**, not only their filenames.
3. **Hear and (optionally) see the running machine**, with audio and video mirrored **independently** so a weak CPU can run audio-only.
4. **Launch software safely** on cartridge setups that today reboot into a menu, and **create blank disks** on the device.

Everything is additive and gated behind feature flags, so it ships incrementally
without touching existing happy paths. The deep-dive docs are grounded in the
concrete device-firmware behaviour (endpoints, wire formats, byte layouts,
timings) so the build doesn't re-derive the protocol.

## Documents in this folder

| Doc | Purpose | Status |
|-----|---------|--------|
| [`overview.md`](./overview.md) | Master plan: motivation, principles, six capabilities, cross-cutting architecture, **firmware surface reference**, phasing, testing, risks | Draft |
| [`01-disk-explorer.md`](./01-disk-explorer.md) | Browse inside images; Run/Load/Mount & Load any file — parser, extraction rule, launch sequences | Draft |
| [`02-launch-safety.md`](./02-launch-safety.md) | Cartridge-parked direct launches + optional boot-menu answer for Mount & Load | Draft |
| [`03-in-image-search.md`](./03-in-image-search.md) | Media-index v2 with in-image child entries, keyed by path+size+mtime; scoped, time-budgeted search | Draft |
| [`04-live-mirror.md`](./04-live-mirror.md) | Audio Mirror (first-class) and Video Mirror (optional, CPU-budgeted) — wire formats, decode, recording, Callback 8020 budget | Draft |
| [`05-new-disk.md`](./05-new-disk.md) | Create a formatted blank image on the device (endpoint confirmed) | Draft |

## Capabilities → flags

| Capability | Flag | Notes |
|-----------|------|-------|
| A Disk Explorer | `disk_explorer_enabled` | anchor; enables C |
| B Launch Safety | `launch_safety_enabled` | + optional boot-menu answer (the folded-in reset-key behaviour) |
| C In-Image Search | `in_image_search_enabled` | depends on A |
| D Audio Mirror | `audio_mirror_enabled` | cheap, first-class, runs on constrained hardware |
| E Video Mirror | `video_mirror_enabled` | optional, default-off on low-power targets |
| F New Disk | `new_disk_enabled` | independent |

## How to enrich this folder

- Add an "As-built" note at the top of a capability's doc when it ships, recording
  deviations from the plan (mirrors the WORKLOG convention used elsewhere in
  `docs/plans`).
- Cross-link back to `overview.md` (esp. its §7 firmware surface reference) instead
  of restating protocol details.
- If a capability grows its own sub-tasks, add `NN-topic-detail.md` beside its
  parent doc and list it here.

## One-line status

Planning. No code written. Each capability has its own feature flag and can be
delivered and reverted independently.
