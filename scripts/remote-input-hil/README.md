# Remote Input → C64U HIL verification harness

Drives the app's **Remote Input** surface (joystick + keyboard) with **real
Android touch** and asserts the input actually reaches the connected Ultimate,
monitored over the device's own REST API. This is hardware-in-the-loop tooling —
it needs a physical phone and a live Ultimate, so it does not run in CI.

## What it proves

| Verifier | Drives | Monitors | Proves |
|---|---|---|---|
| `verify-joystick` | D-pad up/down/left/right + FIRE (real touch) | `GET /v1/machine:input` held state | app → C64U delivery (firmware holds the exact input) |
| `verify-keyboard` | types a phrase (real touch) | screen RAM `$0400` (READY echoes keys) | keystrokes reach the actual C64 (KERNAL processed + echoed) |
| `verify-joystick-screen` | directions + FIRE (real touch) | a 6502 monitor mirroring CIA `$DC00` → `$0400` and counting FIRE edges at `$0428` | **gold standard**: input reaches the running C64 program via the CIA |

Together they cover the full chain: touch → app → `machine:input` POST →
firmware → CIA → 6502.

## Prerequisites

- A phone on `adb` with the app installed and foregrounded (open the Remote
  Input sheet, or the harness will open it).
- A reachable Ultimate. Set `C64U_HOST` (default `u64`) and `C64U_PASSWORD` if
  the device needs one.
- `node` (uses the built-in global `WebSocket`) and `adb` on PATH.

## Usage

```bash
C64U_HOST=u64 ./run.sh all              # joystick + keyboard + gold-standard
C64U_HOST=u64 ./run.sh joystick         # just one
```

`run.sh` finds the app's WebView CDP socket, forwards it, discovers the debugger
URL, and runs the verifier(s). Each prints per-control PASS/FAIL. The
gold-standard test resets the C64 and installs its 6502 monitor, so it leaves
the machine in that monitor's loop — reset the C64 afterwards for a clean state.

## Files

- `cdp.mjs` — minimal Chrome DevTools Protocol client (read state, dispatch input).
- `c64u.mjs` — Ultimate REST client: `readMem`/`writeMem`/`reset`/`getInput` + screen-code decoder.
- `app-touch.mjs` — locates controls by `data-testid` (via CDP) and taps/holds them with real `adb input` touch.
- `joystick-monitor.mjs` — the 6502 monitor bytes + a joystick-byte decoder.
- `verify-*.mjs` — the three verifiers above.
- `run.sh` — one-command runner with WebView-socket auto-discovery.

## Reusing the pieces

Everything is small and composable: import `c64u.mjs` to read/write machine
state from any script, `app-touch.mjs` to drive any `data-testid` with real
touch, and follow a `verify-*.mjs` as a template for a new assertion (e.g. a new
control or a new on-screen effect).
