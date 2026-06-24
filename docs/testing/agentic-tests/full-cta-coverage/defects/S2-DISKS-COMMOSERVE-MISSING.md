# S2-DISKS-COMMOSERVE-MISSING

- ID: `S2-DISKS-COMMOSERVE-MISSING`
- Title: Disks Add items source picker omitted CommoServe
- Severity: `S2`
- Priority: `P0`
- Product area: Disks
- Route: Disks
- Overlay/dialog: Add items source picker
- CTA fingerprint: Disks library `Add disks` / `Add more disks` source picker
- Control label: Add disks
- Input method: DroidMind touch
- Build identity: fixed in `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`
- Git SHA: `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, app-visible connected after Save-and-Connect recovery
- First reproduced UTC: 2026-06-24T22:43:00Z
- Last reproduced UTC: 2026-06-24T23:49:00Z
- Reproduction count: 1 before fix; 1 passing verification after fix
- Reproduction rate: 1/1 before fix
- Preconditions: Pixel 4 on Disks route, Add items popup opened
- Exact DroidMind semantic actions: open Disks, tap Add disks/Add more disks, capture source picker
- Exact command that generated the artifact: targeted DroidMind source proof logged in current artifact root
- Expected result: source picker includes Local, C64U, and CommoServe
- Actual result: before fix only Local and C64U were visible; after fix all three sources are visible
- User impact: users cannot import disk images from CommoServe into the Disks library
- State before: Disks route connected to `c64u`
- State after: source picker dismissed/recovered; app remained connected
- Recovery performed: Back dismissed the source picker
- Cleanup status: no persistent setting mutation from source proof
- Suspected component: `src/components/disks/HomeDiskManager.tsx`
- Evidence supporting suspected component: Disks source groups did not share Play's archive source wiring
- Remaining uncertainty: Archive runtime-file persistence across app relaunch still needs broader Disks coverage
- Replay command: rerun the targeted `commoserve-library-source` DroidMind proof pattern
- Linked screenshots: `screenshots/commoserve-library-source-01-source-picker.png`
- Linked UI hierarchies: `hierarchies/commoserve-library-source-01-source-picker.xml`
- Linked `actions.jsonl`: not emitted for this targeted script
- Linked `checkpoint.jsonl`: not emitted for this targeted script
- Linked `coverage.json` row: pending final exhaustive CTA ledger row
- Linked `results.json` entry: `results-disks-commoserve-library-source.json`
- Linked `issue-groups.json`: pending final exhaustive issue grouping
- Linked logcat: not captured for this targeted source proof
- Linked DroidMind logs: targeted source proof command log in current artifact root
- Linked C64Scope timeline: not used for this targeted proof
- Linked C64Bridge log: not used
- Linked diagnostics export: not used
- Full stdout/stderr command log path: current artifact `logs/commands/` source proof logs

Relevant evidence:

- The source picker screenshot contains `Local`, `C64U`, and `CommoServe`.
- Unit regression `HomeDiskManager Dialogs > shows CommoServe in the Disks Add items picker and imports archive disk images` passed.

## Fix Verification

The Disks Add items popup exposes CommoServe and the archive import path downloads a selected disk image into the disk library as a runtime `File`.

