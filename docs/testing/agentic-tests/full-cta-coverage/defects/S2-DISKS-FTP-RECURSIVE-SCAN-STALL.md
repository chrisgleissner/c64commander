# S2-DISKS-FTP-RECURSIVE-SCAN-STALL

- ID: `S2-DISKS-FTP-RECURSIVE-SCAN-STALL`
- Title: C64U broad folder import stalls scanning `/USB2/test-data` at zero items
- Severity: `S2`
- Priority: `P1`
- Product area: Disks
- Route: Disks
- Overlay/dialog: Add items progress overlay
- CTA fingerprint: C64U picker selection `/USB2/test-data` then `Add to library`
- Control label: Add to library
- Input method: DroidMind touch
- Build identity: observed before final drive-sheet fix; current APK `0.8.9-1ce6a` still requires replay during Disks performance/reliability pass
- Git SHA: `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, C64U picker `/USB2/test-data`
- First reproduced UTC: 2026-06-24T22:54:00Z
- Last reproduced UTC: 2026-06-24T23:57:00Z
- Reproduction count: 1
- Reproduction rate: 1/1 for broad folder selection
- Preconditions: Pixel 4 connected to `c64u`, Disks Add items picker opened, C64U source selected
- Exact DroidMind semantic actions: open `/USB2`, select `/USB2/test-data`, tap `Add to library`, observe progress, cancel through visible Cancel control
- Exact command that generated the artifact: `logs/commands/droidmind-disks-import-add-to-library.stdout.log`
- Expected result: recursive scan discovers mountable disk images or reports a bounded error/timeout with recovery
- Actual result: progress overlay stayed at `Scanning... 0 items` for at least 1m52s before manual cancel
- User impact: selecting a broad fixture/library folder appears hung and gives no useful progress
- State before: source picker selected `/USB2/test-data`
- State after: scan cancelled; app returned to Disks route and remained recoverable
- Recovery performed: visible Cancel control tapped from semantic bounds
- Cleanup status: no files mounted or changed by the failed broad scan
- Suspected component: C64U FTP/source recursive scan path used by Disks import
- Evidence supporting suspected component: specific direct D64 selection from `/USB2/test-data/d64` succeeded immediately, isolating the stall to broad recursive scanning rather than connection or mount capability
- Remaining uncertainty: needs replay on current `0.8.9-10c4b` APK during the Disks performance pass to determine whether this is data-volume behavior, missing progress accounting, or a recursion bug
- Replay command: rerun the C64U broad folder import targeted DroidMind flow against `/USB2/test-data`
- Linked screenshots: `screenshots/disks-import-stuck-scan-before-cancel.png`, `screenshots/disks-import-stuck-scan-after-semantic-cancel.png`
- Linked UI hierarchies: `hierarchies/disks-import-stuck-scan-before-cancel.xml`, `hierarchies/disks-import-stuck-scan-after-semantic-cancel.xml`
- Linked `actions.jsonl`: not emitted for this targeted script
- Linked `checkpoint.jsonl`: not emitted for this targeted script
- Linked `coverage.json` row: pending final exhaustive CTA ledger row
- Linked `results.json` entry: pending final exhaustive CTA ledger row
- Linked `issue-groups.json`: pending final exhaustive issue grouping
- Linked logcat: not captured for this targeted import attempt
- Linked DroidMind logs: `logs/commands/droidmind-disks-import-add-to-library.stdout.log`, `logs/commands/droidmind-disks-import-semantic-cancel-scan.stdout.log`
- Linked C64Scope timeline: not used for this targeted proof
- Linked C64Bridge log: not used
- Linked diagnostics export: not used
- Full stdout/stderr command log path: `logs/commands/droidmind-disks-import-add-to-library.stdout.log`, `logs/commands/droidmind-disks-import-add-to-library.stderr.log`

Relevant evidence:

- The stuck overlay screenshots show `Scanning... 0 items`.
- The later specific-file import proof shows `3 items` in the library from `/USB2/test-data/d64`, proving the target and fixture path are usable when selected at file granularity.

