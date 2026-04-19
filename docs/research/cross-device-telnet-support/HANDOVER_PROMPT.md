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

- `c64u` REST responds as `C64 Ultimate`, firmware `1.1.0`.
- `u64` previously responded as `Ultimate 64 Elite`, firmware `3.14e`.
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
- U64 reachability is currently unstable:
  - `curl http://u64/v1/info` repeatedly returned `Recv failure: Connection reset by peer`
  - repeated live Telnet session attempts to `u64:23` failed with `ECONNRESET`

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

Known validation caveats:

- `npm run lint` is blocked by an unrelated existing worktree change in `playwright/uiMocks.ts` that currently fails Prettier.
- A previous completed `npm run test:coverage` pass succeeded with global branch coverage `92.01%`, but that pass completed before the final standalone-submenu parser fix.
- A fresh post-fix `npm run test:coverage` rerun was started and was still in progress when this handover prompt was requested. Re-run it from scratch and record the final numbers in the work log before declaring the task complete.

## Remaining work

The implementation is not done until the live-device proof is closed honestly.

### 1. Finish validation bookkeeping

- Re-run `npm run test:coverage` on the current tree and record the final coverage summary in `WORKLOG.md`.
- Re-run `npm run lint` only to confirm the blocker remains limited to the unrelated `playwright/uiMocks.ts` worktree change.
- Do not rewrite `playwright/uiMocks.ts` unless explicitly instructed by the user.

### 2. Complete U64 live discovery proof

Use app-side runtime discovery, not ad hoc static inspection.

Goal:

- prove that the shared discovery architecture works on live `u64`
- prove `powerCycle` resolves unsupported on U64 `3.14e`
- prove supported actions such as `rebootClearMemory`, `printerFlush`, `saveC64Memory`, `saveReuMemory`, `driveAReset`, or `iecReset` resolve correctly if the menu graph exposes them

Notes:

- You can use the temporary `vite-node` probe pattern that was already used during this task:
  - stub `window`, `localStorage`, and `CustomEvent`
  - create a minimal Node `TelnetTransport` with `node:net`
  - use `createTelnetSession(...)`
  - call `discoverTelnetCapabilities(...)`
- Because `u64` REST is currently resetting, it is acceptable to build the live discovery cache key from the already verified device identity facts:
  - product `Ultimate 64 Elite`
  - firmware `3.14e`
  - menu key `F5`
- If `u64` continues to hard-reset both REST and Telnet after reasonable retries, log that precisely as an external blocker instead of pretending the proof was completed.

### 3. Complete U64 live action execution proof

The original implementation prompt requires:

- at least one supported U64 machine action executes successfully
- at least one supported U64 drive or printer action executes successfully

Recommended order:

1. `printerFlush`
2. a low-risk machine action if available and truly safe to automate

Be careful here:

- avoid needlessly disruptive actions if a lower-risk supported machine action exists
- if the only app-supported machine actions available are destructive or operationally unsafe, stop and record that as a product or environment blocker rather than guessing

### 4. Decide whether screenshot refresh is still required

Current state:

- the Home semantics changed
- screenshots were not regenerated during this task

You must decide one of these and record it explicitly:

- update only the minimal affected screenshot set under `docs/img/`, or
- record that screenshot refresh is intentionally deferred and therefore the task is not yet visually closed

### 5. Final documentation and closure

Before final completion:

- update `docs/research/cross-device-telnet-support/WORKLOG.md` with:
  - the parser fix for clipped standalone submenu frames
  - the post-fix `npm run test` result
  - the final `npm run test:coverage` result
  - the live C64U proof result
  - the live U64 proof result or exact blocker
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
