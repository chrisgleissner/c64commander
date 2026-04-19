# Cross-Device Telnet Support Handover Prompt

Date: 2026-04-19
Type: Strict continuation prompt
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Read first

- `docs/research/cross-device-telnet-support/PLANS.md`
- `docs/research/cross-device-telnet-support/WORKLOG.md`
- `docs/research/cross-device-telnet-support/prompt.md`
- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`

Do not touch root `PLANS.md` or root `WORKLOG.md`. They are occupied by other work. Keep planning artifacts only under `docs/research/cross-device-telnet-support/`.

## Current implemented state

This work is already substantially implemented.

Completed areas:

- U64 scraper/parser hardening was implemented.
- Runtime Telnet capability discovery was added and is keyed by device identity plus firmware.
- Action execution was refactored to use discovered targets instead of static family-specific click paths.
- Home UI now shows unsupported Telnet actions as visible disabled controls with explanation instead of silently hiding them.
- U64 mirrored extracted docs were renamed from `c64u-*` to `u64e-*`, and the extraction tools now infer the mirrored filename prefix from the probed device family automatically.
- Coverage harness temp-dir failures in `scripts/run-unit-coverage.mjs` were fixed.

Key changed code paths already in place:

- `scripts/dump_c64u_config.py`
- `scripts/dump_c64_telnet_screens.py`
- `scripts/run-unit-coverage.mjs`
- `scripts/test_dump_c64u_config.py`
- `scripts/test_dump_c64_telnet_screens.py`
- `src/lib/telnet/telnetCapabilityDiscovery.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetScreenParser.ts`
- `tests/unit/scripts/runUnitCoverage.test.ts`
- `tests/unit/telnet/telnetCapabilityDiscovery.test.ts`
- `tests/unit/telnet/telnetMenuNavigator.test.ts`
- `tests/unit/telnet/telnetScreenParser.test.ts`

Current mirrored U64E docs now use the correct filenames:

- `docs/c64/devices/u64e/3.12a/u64e-config.yaml`
- `docs/c64/devices/u64e/3.14a/u64e-config.yaml`
- `docs/c64/devices/u64e/3.14d/u64e-config.yaml`
- `docs/c64/devices/u64e/3.14e/u64e-config.yaml`
- `docs/c64/devices/u64e/3.14e/u64e-telnet.yaml`

## Important live findings already verified

Treat these as the current known facts unless the live device now contradicts them:

- Earlier in the task, `c64u` REST responded as `C64 Ultimate`, firmware `1.1.0`.
- On the latest probe from this machine, `c64u` was unreachable over REST and timed out on raw Telnet.
- `u64` currently responds as `Ultimate 64 Elite`, firmware `3.14e`.
- C64U `F1` opens a nested action-menu screen:
  - level 0 visible menu: filesystem/browser entries
  - deeper actionable menu: global action categories such as `Power & Reset`
- On C64U, opening `Power & Reset` via `RIGHT` produces a standalone submenu frame whose top border is clipped:
  - the frame starts with `q...k`, not `l...k`
  - this was the root cause of the parser miss that has now been fixed
- After the parser fix, live C64U app-side discovery resolves:
  - `powerCycle` supported
  - `rebootClearMemory` supported
  - `printerFlush` supported
  - `driveAReset` supported
- Current reachability split:
  - `u64` REST currently succeeds and raw Telnet connects
  - `c64u` REST currently fails to connect and raw Telnet currently times out
- Latest app-side live U64 discovery proof result:
  - the repo-root `vite-node` runtime probe works and reaches `discoverTelnetCapabilities(...)`
  - `powerCycle` resolves `unsupported` as expected
  - unexpectedly, `saveReuMemory`, `printerFlush`, and `driveAReset` also resolve `unsupported`
  - first live execution attempt then aborts because `printerFlush` has no resolved target
  - this points to a remaining runtime parser/discovery gap on live U64 submenu extraction, not a raw connectivity failure

## Validation status at handover time

Confirmed on the updated tree:

- `python3 -m unittest scripts/test_dump_c64u_config.py` passed
- `python3 -m unittest scripts/test_dump_c64_telnet_screens.py` passed
- `npm run test -- --run tests/unit/telnet/telnetScreenParser.test.ts` passed
- `npm run test -- --run tests/unit/telnet/telnetMenuNavigator.test.ts tests/unit/telnet/telnetScreenParser.test.ts` passed
- `npm run test` passed on the current tree:
  - `525` test files
  - `6079` tests
- `npm run build` passed on the current tree
- `npm run lint` now passes on the current tree with warnings only

Known validation caveats:

- The last known successful full coverage result remains the earlier pass with global branch coverage `92.01%`.
- A fresh rerun of `npm run test:coverage` was attempted on the current tree and did not complete cleanly:
  - it retried a shard-write `ENOENT` under `.cov-unit/jsdom-3/.tmp/coverage-1.json`
  - it then failed on unrelated jsdom test timeouts and a Vitest worker timeout before producing a final merged percentage
- Because of that, there is no fresh final post-rerun coverage number to record honestly from the latest attempt.

## Remaining work

The implementation is not done until the live-device proof is closed honestly.

### 1. Finish validation bookkeeping

- Re-run `npm run test:coverage` on the current tree and record the final coverage summary in `WORKLOG.md`.
- Re-run `npm run lint` only to confirm the blocker remains limited to the unrelated `playwright/uiMocks.ts` worktree change.
- Do not rewrite `playwright/uiMocks.ts` unless explicitly instructed by the user.

### 2. Fix or document the remaining U64 live discovery gap

Use app-side runtime discovery, not ad hoc static inspection.

Goal:

- prove that the shared discovery architecture works on live `u64`
- prove `powerCycle` resolves unsupported on U64 `3.14e`
- prove supported actions such as `rebootClearMemory`, `printerFlush`, `saveC64Memory`, `saveReuMemory`, `driveAReset`, or `iecReset` resolve correctly if the menu graph exposes them

Current reality:

- `powerCycle` already resolves unsupported on live `u64`
- the blocker is that submenu-backed actions that should be supported per mirrored U64 YAML are still resolving unsupported in the app-side runtime probe

Notes:

- You can use the temporary `vite-node` probe pattern that was already used during this task:
  - stub `window`, `localStorage`, and `CustomEvent`
  - create a minimal Node `TelnetTransport` with `node:net`
  - use `createTelnetSession(...)`
  - call `discoverTelnetCapabilities(...)`
- The repo-root `vite-node` probe path is confirmed to work in this workspace when the script lives under `tmp/`.
- `u64` no longer appears to be the connectivity blocker; the remaining blocker is runtime discovery/parsing.

### 3. Complete U64 live action execution proof only after discovery resolves supported targets

The original implementation prompt requires:

- at least one supported U64 machine action executes successfully
- at least one supported U64 drive or printer action executes successfully

Current blocker:

- the latest app-side live probe aborts before execution because `printerFlush` has no resolved target
- do not claim execution proof until at least one supported target resolves through runtime discovery first

Recommended order:

1. `printerFlush`
2. a low-risk machine action if available and truly safe to automate

Be careful here:

- avoid needlessly disruptive actions if a lower-risk supported machine action exists
- if the only app-supported machine actions available are destructive or operationally unsafe, stop and record that as a product or environment blocker rather than guessing

### 4. Screenshot closure decision

Current state:

- the Home semantics changed
- screenshots were not regenerated during this task

Current decision already recorded in `WORKLOG.md`:

- screenshot refresh is not required for the current task state because the existing documented Home screenshots still accurately depict a connected C64U-supported surface and do not claim to show the new U64-specific disabled state

### 5. Final documentation and closure

Before final completion:

- update `docs/research/cross-device-telnet-support/WORKLOG.md` with:
  - the parser fix for clipped standalone submenu frames
  - the post-fix `npm run test` result
  - the latest `npm run test:coverage` outcome and exact blocker
  - the live C64U proof result or exact reachability blocker
  - the live U64 proof result or exact runtime discovery blocker
- update `PLANS.md` only if the closure state materially changes

## High-priority technical context

### Parser bug that was fixed last

`src/lib/telnet/telnetScreenParser.ts` now detects bordered menus whose top-left corner is clipped off, as seen on the live C64U standalone submenu frame after `RIGHT` from `Power & Reset`.

Locked-in regression:

- `tests/unit/telnet/telnetScreenParser.test.ts`
  - `detects a standalone submenu when the top-left corner is clipped off the frame`

This fix is what restored live C64U `powerCycle` / `rebootClearMemory` discovery.

### Why C64U discovery had looked broken

There were two separate live-model issues:

1. C64U `F1` shows a deeper actionable category menu beneath a visible filesystem menu.
2. The submenu frame opened from `RIGHT` on that category menu was present on-screen but missed by the parser because its top border started with `q` instead of `l`.

Both are now addressed in code.

### Remaining uncertainty

The main unresolved risk is not the static architecture anymore. It is live `u64` reachability and live action-proof completion.

## Suggested commands

### Required validation reruns

```bash
npm run test:coverage
npm run lint
```

### Basic live probes

```bash
curl -fsS --max-time 5 http://c64u/v1/info
curl -fsS --max-time 5 http://u64/v1/info
python3 - <<'PY'
import socket
for host in ("u64", "c64u"):
    try:
        sock = socket.create_connection((host, 23), timeout=3)
        print(host, "telnet connected")
        sock.close()
    except Exception as exc:
        print(host, "telnet failed:", exc)
PY
```

### Files to keep aligned

- `docs/research/cross-device-telnet-support/PLANS.md`
- `docs/research/cross-device-telnet-support/WORKLOG.md`
- `docs/research/cross-device-telnet-support/HANDOVER_PROMPT.md`

## Completion rule

Do not call this task complete until one of these is true:

- the U64 live discovery and execution proof has been completed honestly, or
- the exact external blocker preventing that proof is documented clearly enough that the user can act on it without further re-tracing.
