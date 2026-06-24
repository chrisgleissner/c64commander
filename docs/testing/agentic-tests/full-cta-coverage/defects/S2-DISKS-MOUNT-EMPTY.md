# S2-DISKS-MOUNT-EMPTY

- ID: `S2-DISKS-MOUNT-EMPTY`
- Title: Drive-specific Mount disk flow opened an empty or generic disk sheet instead of a populated Drive A/B mount sheet
- Severity: `S2`
- Priority: `P0`
- Product area: Disks
- Route: Disks
- Overlay/dialog: Drive A/B Mount disk sheet
- CTA fingerprint: content-desc `Drive A Mount disk`, bounds `[841,390][1009,500]`
- Control label: Drive A Mount disk
- Input method: DroidMind touch; Back recovery with `DroidmindClient.pressKey(4)`
- Build identity: fixed in `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`
- Git SHA: `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, app-visible connected
- First reproduced UTC: 2026-06-24T22:34:00Z
- Last reproduced UTC: 2026-06-24T23:01:00Z
- Reproduction count: 2
- Reproduction rate: 2/2 before fix
- Preconditions: Pixel 4 on Disks route, active device `c64u`, disk library initially empty or later populated with C64U D64 fixtures
- Exact DroidMind semantic actions: open Disks, tap semantically identified `Drive A Mount disk`, capture hierarchy/screenshot, press Back for recovery
- Exact command that generated the artifact: `node --input-type=module` logged at `c64scope/artifacts/cta-20260624T222959Z-pixel4-c64u-414ec2a965d6/logs/commands/droidmind-drive-a-mount-sheet-exact.stdout.log`
- Expected result: Drive-specific sheet titled `Mount disk to Drive A` with available disks or an in-sheet Add disks recovery CTA when empty
- Actual result: before fix, the empty state lacked an actionable in-sheet import path; after disks existed, the Drive A mount control opened the generic `All disks` sheet
- User impact: user cannot confidently mount a disk to a specific drive from the visible Drive A/B control
- State before: connected `c64u`, Drive A no disk mounted
- State after: recovered to Disks, Drive A no disk mounted
- Recovery performed: Back dismissed overlays; Drive A was later ejected after mount proof
- Cleanup status: Drive A ejected; three temporary disk-library entries retained for continuing Disks coverage
- Suspected component: `src/components/disks/HomeDiskManager.tsx`
- Evidence supporting suspected component: Drive mount sheet used `SelectableActionList` with nested `viewAllTitle="All disks"` and had no empty-state Add disks CTA
- Remaining uncertainty: none for the fixed user-visible Drive A sheet; broader Drive B and repetition coverage remains part of the exhaustive pass
- Replay command: rerun `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log` script pattern with current artifact root
- Linked screenshots: `screenshots/mount-fix-02-empty-mount-sheet.png`, `screenshots/drive-a-mount-sheet-exact-open.png`, `screenshots/drive-a-mount-sheet-fixed-open.png`
- Linked UI hierarchies: `hierarchies/mount-fix-02-empty-mount-sheet.xml`, `hierarchies/drive-a-mount-sheet-exact-open.xml`, `hierarchies/drive-a-mount-sheet-fixed-open.xml`
- Linked `actions.jsonl`: not emitted for this targeted script; command log contains semantic actions
- Linked `checkpoint.jsonl`: not emitted for this targeted script
- Linked `coverage.json` row: pending final exhaustive CTA ledger row
- Linked `results.json` entry: pending final exhaustive CTA ledger row
- Linked `issue-groups.json`: pending final exhaustive issue grouping
- Linked logcat: not captured for this targeted sheet-only fix
- Linked DroidMind logs: `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log`
- Linked C64Scope timeline: not used for this targeted proof
- Linked C64Bridge log: not used
- Linked diagnostics export: not used
- Full stdout/stderr command log path: `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log`, `logs/commands/droidmind-drive-a-mount-sheet-fixed.stderr.log`

Relevant log excerpts:

```json
{
  "step": "open",
  "checks": {
    "driveTitle": true,
    "genericTitle": false,
    "availableDisks": true,
    "boulderDash": true,
    "frogger": true,
    "interfaceHarness": true,
    "emptyState": false
  }
}
```

## Fix Verification

The current APK opens `Mount disk to Drive A` directly, lists `Boulder Dash 2.d64`, `Frogger.d64`, and `interface-harness.d64`, does not show the generic `All disks` title, and dismisses cleanly with Back.

