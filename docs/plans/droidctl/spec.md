# droidctl — Specification

Status: proposed. Companion documents: `plan.md` (how to build it), `prompt.md` (kickoff for the
implementing agent).

---

## 1. Summary

`droidctl` is an MCP server, hosted in this repository alongside `c64scope/`, that deploys and drives
the C64 Commander Android app on a device under test. It replaces the third-party `droidmind` server,
which stopped working when its dependency range admitted a breaking release of the MCP Python SDK.

It exposes one tool interface over two transports:

- **`adb`** — the Pixel 4 on USB, Android emulators, and Waydroid containers.
- **`sailfish`** — a device running Sailfish OS with Jolla's Android compatibility layer, reached over
  SSH rather than over `adb`.

The name states what is controlled — the Android app — rather than the transport, so it stays accurate
for the Sailfish target. The `ctl` suffix follows `systemctl` / `journalctl` / `kubectl`.

The tool surface is derived from what this repository already does with `adb`. Thirty-nine files under
`tools/hil/` and `scripts/` mention `adb`, and about 242 lines across the repository are actual `adb`
invocations. §8 covers the operations those lines use and nothing else.

**One requirement is structural rather than convenient: every tool takes an explicit target and refuses
to guess.** §6 gives the incident behind it and the four places in the repository where the unsafe
pattern still lives.

---

## 2. Goals

1. Restore the capability `droidmind` provided, on a dependency surface this repository controls.
2. Give one tool interface that works against `adb` targets and, when such a device exists, a Sailfish
   target — so a caller does not branch on transport.
3. Make wrong-device targeting impossible by construction rather than by convention.
4. Consolidate the `adb` invocations currently copy-pasted across `scripts/` and `tools/hil/` into one
   implementation with one set of timeouts, retries and error messages.
5. Write evidence into conventions this repository already validates, so the existing magic-byte
   evidence checks keep working.
6. Be testable without hardware: the transport is an interface a test can substitute.

## 3. Non-goals

- **A general Android automation framework.** Anything not already used by a script in this repository
  is out of scope. No gesture recorder, no accessibility-service driver, no device farm support.
- **Replacing CDP.** The HIL harnesses drive the app through the WebView DevTools socket, clicking real
  `data-testid` elements (`tools/hil/README.md:3-6`). That stays. `droidctl` owns the layer beneath —
  install, lifecycle, raw input, capture, logs — and provides the port forward the CDP layer needs.
- **Replacing Maestro.** The 51 flows in `.maestro/` keep running under the Maestro CLI. `droidctl` does
  not interpret flow files.
- **Replacing c64scope.** `c64scope` owns sessions, evidence timelines and assertion records.
  `droidctl` is the device-driving peer it calls, exactly as `droidmind` was.
- **Driving the C64 Ultimate.** That is `c64bridge`.
- **Provisioning.** `droidctl` does not create emulators, install Sailfish, or enable developer mode.

---

## 4. Why droidmind is being replaced

`droidmind` is a third-party MCP server consumed straight from git. Its package metadata declares
`mcp[cli]>=1.25.0` with no upper bound (`droidmind/pyproject.toml:22`, reachable here through the
`droidmind` symlink at the repository root). When the MCP Python SDK published a 2.x release with
breaking changes, `uvx` resolved the new major version and the server failed to start.

The `--with mcp<2` argument now present in `.mcp.json` is a stopgap added here to pin the resolver back
below the break. It is a local patch to somebody else's dependency declaration, and it stops working the
day `droidmind` needs a 2.x API.

Two further reasons make an in-repo replacement worth the work rather than a fork:

1. **The surface actually used is small.** `c64scope/src/validation/droidmindClient.ts` is the only
   programmatic consumer, and it uses five tools: `android-device` (`list_devices`), `android-app`
   (`start_app`, `stop_app`), `android-ui` (`tap`, `swipe`, `press_key`, `input_text`), `android-shell`,
   and `android-screenshot`. `c64scope/src/cta/capabilities.ts:27-37` states that list as a hard
   requirement and fails preflight when any of it is missing. All eleven CTA gate runners in
   `c64scope/src/cta/` drive the device only through that client — there is no raw `adb` string
   anywhere in that directory.
2. **Its failure modes had to be worked around here anyway.** `droidmindClient.ts` carries a 30-second
   per-call deadline, a three-attempt retry around `uiautomator dump`, and a settle-poll on the dump file
   size, all added after a wedged dump blocked a gate runner for over five minutes (INFRA-003, recorded
   in the comments at `droidmindClient.ts:24-28` and `:230-234`). Those behaviours belong in the server.

Nothing here is a criticism of the project. An unbounded dependency range is a routine packaging choice
that happens to be unsafe for a tool a release gate depends on.

---

## 5. Targets and transports

### 5.1 The rig that exists

`AGENTS.md:999-1001` states it exactly: **the Pixel 4 (adb), the C64U, and the U64.** The Pixel 4's
serial is `9B081FFAZ001WX`; `AGENTS.md:159` refers to it by the prefix `9B0`, and
`scripts/lib/build-fast-path.sh:90` hard-codes that prefix as a preference.

Other `adb` targets appear on the same host: `./build --android-tests` starts a local emulator
(`build:804-815`), `scripts/android-emulator.sh` starts one directly, and `scripts/waydroid-smoke.sh`
brings up a Waydroid LXC container reached with `adb connect` (`waydroid-smoke.sh:186`). All three are
the `adb` transport and are addressed by serial like any other target.

### 5.2 The `adb` transport

Well understood and already in use. `droidctl` shells out to the `adb` binary with an explicit
`-s <serial>` on every invocation, without exception.

### 5.3 The `sailfish` transport — what is established, and what is not

**No Sailfish device exists on this bench.** The handset this transport exists for is unreleased;
`AGENTS.md:1004-1015` forbids writing any task, gate or acceptance criterion whose venue is that
handset, and the Pixel 4 stands in for it. This section therefore records researched facts and their
confidence, and §7.4 keeps the implementation off the critical path.

**Established, from Jolla's own documentation:**

- The Android layer is called **AppSupport**; "Aliendalvik" survives as an internal name in service
  and path names. It is a modified Android running in an **LXC container** sharing the host kernel, with
  each Android app surfacing as a Wayland surface in the Sailfish compositor. It is proprietary and
  licence-gated.
- Sailfish OS **5.0** ships AppSupport based on **Android 13 / API 33**; older devices run API 30. This
  matches the repository's working assumption of an API-33 ceiling
  (`docs/agentic/callback8020/handover/*`).
- **Developer mode** enables SSH. The USB address is `192.168.2.15`, WLAN is also supported, the user is
  `defaultuser` (`nemo` before Sailfish 3.4.0), and root is `devel-su` with the same password.
- **A command can be run inside the container**: `appsupport-attach <cmd>` on Sailfish 4.5 and later,
  `lxc-attach -n aliendalvik -- <cmd>` before that. Both need `devel-su` first. Jolla documents
  `appsupport-attach /system/bin/pm list packages` and
  `appsupport-attach /system/bin/logcat` explicitly.
- **Logcat is fully solved and vendor-documented.** `logcat`, including `-c` to clear, works under
  `appsupport-attach`.
- **A screenshot can be taken from the Sailfish side** with a session D-Bus call to lipstick:
  `org.nemomobile.lipstick.saveScreenshot`. It works over SSH, but it must run in the user's session
  with `DBUS_SESSION_BUS_ADDRESS` set, not blindly under `devel-su`.
- **There is no official screen-recording CLI.** The documented mechanism is `lipstick2vnc`, a VNC
  server that grabs frames from the compositor on port 5900 with no authentication, bound to localhost
  and the USB network. Community recorders are ffmpeg wrappers around it.
- **Sailfish ships no `adb` binary.** An adb client must run on the workstation.

**Established as a negative, and it is the most useful single fact here:** `appsupport-attach` is **not**
equivalent to `adb shell`. A first-hand report has `uiautomator dump` under `appsupport-attach`
returning **exit code 0 while writing no file**, both as root and as uid 2000, while the same command
over adb worked. `logcat` works fine under `appsupport-attach`. So the failure is specific to
UI-session-dependent tools, and **an exit code of 0 is not evidence of success on this platform**. Any
Sailfish backend must verify by artifact, not by exit status.

**Likely but not vendor-documented:**

- `apkd-install <file.apk>` installs an APK from the command line. Jolla documents only GUI install
  routes, gated on an "Allow untrusted software" setting. Whether a raw `pm install` inside the
  container is an acceptable substitute is unknown — `apkd` also does host-side integration (launcher
  entry, icon, sharing plugins) that `pm install` would skip.
- **adb over TCP into the container works.** One detailed first-hand report describes enabling Developer
  Options inside AppSupport, turning on wireless debugging, then `adb connect <ip>:5555` from a
  workstation and running `uiautomator dump` successfully. If this holds, the `sailfish` backend
  collapses to a connection helper and the entire `adb` backend applies unchanged. It is the single
  highest-value question in §14.

**Dead ends, recorded so nobody rediscovers them:** `aliendalvik-control`, a D-Bus daemon whose
interface (`sendTap`, `sendSwipe`, `sendKeyevent`, `sendInput`, `launchApp`, `forceStop`) is exactly
what a driver would want, was last released in October 2020 and is explicitly unsupported on Sailfish 4
and later; its implementation is closed `.so` plugins selected by Android API level, with nothing
targeting API 33. `qapreload`, the Appium port for Sailfish, injects into Qt/QML applications only and
has no Android support.

### 5.4 The target device's own constraints

Confirmed against this repository rather than against the vendor:

- **480x640 physical panel** at 3.25 inches, so about 246 ppi, which Android buckets as hdpi and hands
  the WebView **device pixel ratio 1.5** — the page gets **320 x 426.7 CSS pixels**. The derivation is
  in `playwright/displayProfileViewports.ts:7-11`; `tools/hil/simulate_vision.py:5` and
  `tests/unit/lib/displayProfiles.test.ts:81` repeat it. The Pixel 4 emulates it with
  `wm size 480x640; wm density 240` followed by a force-stop and relaunch
  (`tools/hil/keypad_reachability.mjs:362`).
- **No Google Mobile Services.** Enforced, not merely assumed: the `android-no-google-services` CI job
  (`.github/workflows/android.yaml:1550-1624`) runs the APK on an AOSP API-33 image, and
  `scripts/verify-apk-no-gms.mjs` rejects required Google `uses-library` / `uses-feature` entries.
- **No usable touchscreen.** The repository says this two ways and both should be cited rather than one
  picked: "a physical keypad with the touchscreen disabled by default"
  (`tools/hil/keypad_reachability.mjs:14`) and "the keypad handset has no touchscreen"
  (`variants/variants.yaml:105,113`). Everything downstream is built for the stronger reading — the
  variant ships the on-screen joystick hidden, and `keypad_reachability.mjs` dispatches no synthetic DOM
  events, so a touch-only control fails there. There is also **no IME**: physical keypad plus T9
  (`keypad_reachability.mjs:323-326`).

The practical consequence for `droidctl` is that `droid_input.press_key` is the primary input tool for
that target, not `droid_input.tap`.

---

## 6. Target selection safety

**Requirement: every tool that touches a device takes a required `target` argument. There is no default
target, no "the only connected device" fallback, and no prefix guess that resolves to one candidate.
Ambiguity is an error, not a decision.**

### 6.1 The incident

While a CI Android emulator was running on this machine, a bare `adb` command — one with no `-s` —
could have been routed to the emulator instead of the Pixel, part-way through an in-flight release
build. An `install -r` or a `pm clear` landing on the wrong target corrupts whatever that target was
doing.

### 6.2 Why this is not hypothetical

Across `tools/hil/`, `scripts/`, `tests/android-emulator/`, `ci/`, `.github/workflows/` and
`c64scope/src/`, roughly 141 `adb` call sites carry `-s` and roughly 98 do not. The second figure
over-counts, because it includes wrappers that inject `-s` one layer up — `scripts/android-keypad-smoke.sh:31`
defines `adb() { command adb -s "$SERIAL" "$@"; }`, so every apparently bare call in that file is in fact
targeted. Four distinct unsafe shapes remain.

**Bare `adb` with no serial anywhere in the file.** `tools/hil/merge_gate.mjs:115` defines the release
gate's entire adb helper as:

```js
const adb = (args) => execFileAsync("adb", args, { maxBuffer: 1 << 22 });
```

Through it the gate runs `devices`, `dumpsys audio`, `input keyevent` (which changes the phone's media
volume) and `wm size`. The same shape appears at `tools/hil/joystick_hold_hil.mjs:104`,
`tools/hil/joystick_rotation_hil.mjs:187`, `tools/hil/keypad_reachability.mjs:62`,
`tools/hil/thread_cpu.sh:12`, `scripts/measure-android-responsiveness.sh:16-35`,
`scripts/remote-input-hil/run.sh:16-24` and `scripts/remote-input-hil/app-touch.mjs:21`.
`scripts/smoke-no-google-services.sh` is the widest case: about thirteen bare sites including
`install -r -g`, `ime disable` and `pm disable-user`.

**"Exactly one device, so use it."** `scripts/build-android-apks.mjs:239-251`:

```js
if (serials.length === 1) return serials[0];
```

That function feeds a step list that can contain `adb uninstall`, `adb install -r -d` and
`adb shell pm clear` (`build-android-apks.mjs:162-190`). It does not exclude emulators.
`scripts/lib/build-fast-path.sh:95-102` is the same rule in shell — it does exclude `emulator-*`, so the
two helpers disagree about what a valid target is.

**A registry that picks a preferred device.** `c64scope/src/deviceRegistry.ts:79-105`
(`resolvePreferredPhysicalTestDeviceSerial`) walks a priority list and returns the first match, with a
comment describing the fallback as a feature. That registry also lists only two Samsung handsets and not
the Pixel 4, while every CTA run id in `c64scope/src/cta/` hard-codes `pixel4` — two sources of truth
about the same rig that already disagree.

**Optional serials.** `scripts/hil-screenshot-evidence.mjs:67-79`,
`scripts/startup/collect-android-startup-baseline.mjs`, `scripts/startup/stage-local-assets-adb.sh` and
`tools/hil/hil_stream_fixture.py:65` all build the `-s` argument only when a serial was supplied, so
omitting it is a supported call rather than an error.

A fifth hazard sits alongside these: **both application ids can be installed at the same time, and both
open a WebView DevTools socket.** A `head -1` over the socket list picks whichever came first, and the
other edition may still hold an `AudioTrack`, which corrupts an audio measurement. That is why §6.3 rule
7 requires an explicit package as well as an explicit target.

### 6.3 The rules

1. `target` is required on every tool except `droid_target.list_targets`. A missing `target` is a
   validation error naming the tool that enumerates targets.
2. A target is addressed by an opaque **target id** issued by `droid_target.list_targets`, not by a raw
   serial typed by the caller. The id encodes the transport.
3. `droid_target.list_targets` never returns a "default", "preferred" or "current" field. It returns
   every target it can see, each with transport, serial, model, API level, state and whether it is an
   emulator.
4. A target id that no longer resolves is an error. The server does not fall back to another target.
5. A target id that resolves to more than one device is an error listing the candidates.
6. Every `adb` invocation carries `-s <serial>`. This is enforced by a unit test over the argument
   builder, not by review (§11.2).
7. Every tool that names an application takes an explicit `package`. There is no default package,
   because the repository builds two application ids (`variants/variants.yaml`) and both can be present
   at once.

### 6.4 What this deliberately costs

A caller must make two calls to do anything: enumerate, then act. That is the point. The alternative —
saving one call by guessing — is the behaviour that made the incident possible.

---

## 7. Architecture

`droidctl/` is a sibling of `c64scope/`: its own `package.json`, its own `tsconfig.json`, its own
`node_modules`, launched from `.mcp.json` through a `scripts/start.mjs` bootstrap that installs its own
dependencies on first start. It copies c64scope's structure closely enough that a reader of one can read
the other.

### 7.1 Module layout

| Module                         | Mirrors in c64scope      | Responsibility                                                        |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------- |
| `src/index.ts`                 | `src/index.ts`           | Shebang entrypoint; calls `runDroidctlServer()`.                      |
| `src/server.ts`                | `src/server.ts:47-160`   | Builds `Server`, registers the five request handlers, connects stdio. |
| `src/logger.ts`                | `src/logger.ts`          | stderr logger; debug gated on an env flag.                            |
| `src/types.ts`                 | `src/types.ts`           | `okResult` / `errorResult` envelope and run id creation.              |
| `src/tools/types.ts`           | `src/tools/types.ts`     | `defineToolModule`, `parseZodArgs`, `ToolDescriptor`.                 |
| `src/tools/errors.ts`          | `src/tools/errors.ts`    | `ToolValidationError`, `ToolExecutionError`, error results.           |
| `src/tools/responses.ts`       | `src/tools/responses.ts` | `textResult`, `jsonResult`.                                           |
| `src/tools/registry.ts`        | `src/tools/registry.ts`  | Collects modules, throws on a duplicate tool name at load.            |
| `src/tools/modules/target.ts`  | `modules/lab.ts`         | Enumerate and describe targets.                                       |
| `src/tools/modules/app.ts`     | —                        | Install, uninstall, launch, stop, clear data, app-private files.      |
| `src/tools/modules/input.ts`   | —                        | Tap, swipe, text, keyevent.                                           |
| `src/tools/modules/capture.ts` | `modules/capture.ts`     | Screenshot, UI dump, recording, logcat.                               |
| `src/tools/modules/assert.ts`  | `modules/assert.ts`      | Visibility assertions over the UI dump.                               |
| `src/tools/modules/device.ts`  | —                        | Readiness, shell, port forward, file transfer.                        |
| `src/artifacts.ts`             | `src/sessionStore.ts`    | Run directory allocation and the artifact index.                      |
| `src/resources.ts`             | `src/resources.ts`       | Static resources: keycode table, transport support matrix.            |
| `src/transport/adb.ts`         | —                        | The `adb` backend and its argument builder.                           |
| `src/transport/sailfish.ts`    | —                        | The `sailfish` backend; a stub until §14 is answered.                 |

### 7.2 The transport abstraction

One interface, two implementations, and nothing above it knows which is in use:

```ts
export interface Transport {
  readonly kind: "adb" | "sailfish";
  listTargets(): Promise<TargetInfo[]>;
  exec(target: ResolvedTarget, argv: readonly string[], opts?: ExecOptions): Promise<ExecResult>;
  pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer>;
  pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<void>;
  installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<void>;
  forwardPort(target: ResolvedTarget, localPort: number, remote: string): Promise<void>;
  capabilities(): TransportCapabilities;
}
```

`exec` runs a command **in the Android context** of the target. For `adb` that is `adb -s S shell …`;
for Sailfish it is `ssh … devel-su appsupport-attach …` or an adb connection into the container,
depending on how §14 Q4 is answered. Tool modules compose Android shell commands and never construct
transport-specific arguments.

`capabilities()` returns the support matrix in §8.15. A tool whose capability is unsupported returns a
structured `unsupported_on_transport` error naming the transport and the capability — never a silent
no-op and never a partial result.

### 7.3 The `adb` backend

- One argument builder, `adbArgs(serial, rest)`, used by every call. It is a pure function so a test can
  assert that `-s` is always present (§11.2).
- Every invocation carries a timeout. `scripts/smoke-android-emulator.sh` already wraps its calls in
  `timeout "$ADB_COMMAND_TIMEOUT"` for the same reason; `droidctl` makes it unconditional.
- Binary output uses `exec-out` with a buffer encoding, as `scripts/hil-screenshot-evidence.mjs:67-79`
  does, so a PNG is not corrupted by newline translation.

### 7.4 The `sailfish` backend

Delivered as an interface implementation with the transport-specific pieces isolated behind four
functions: connect, exec-in-Android-container, capture screen, capture logs. Until a device exists, the
shipped implementation returns `transport_unavailable` with the §14 probe procedure in its message, and
a fake stands in for it in the unit tests.

Two design rules come straight from §5.3 and should be written into the stub's comments so they survive
until somebody has the hardware:

1. **Verify by artifact, not by exit code.** `uiautomator dump` under `appsupport-attach` has been
   observed returning 0 while writing nothing.
2. **Prefer a container adb connection if one can be established.** If §14 Q4 resolves yes, the backend
   is a connection helper over the existing `adb` backend rather than a second implementation, and
   almost every unknown in §8.15 resolves with it.

---

## 8. The tool surface

### 8.1 Naming and shape

Tool names follow c64scope's convention — `<prefix>_<domain>.<verb>` — with the domain prefixed so names
stay unique when several MCP servers are loaded together, as `scope_session.start_session` and
`scope_capture.capture_stream` already are. Domains: `droid_target`, `droid_app`, `droid_input`,
`droid_capture`, `droid_assert`, `droid_device`. Over MCP these surface as
`mcp__droidctl__droid_capture_screenshot` and so on.

Every tool returns the c64scope envelope from `c64scope/src/types.ts`:

```json
{ "ok": true, "runId": "dc-20260831T142530Z", "timestamp": "<ISO-8601>", "data": {} }
{ "ok": false, "runId": "…", "timestamp": "…", "error": { "code": "…", "message": "…", "details": {} } }
```

Inputs are declared as JSON Schema for `tools/list` and validated with the matching zod schema at
`execute` time, the pair kept honest by the contract test in §11.3.

### 8.2 `droid_target.list_targets`

| Field      | Value                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Input      | `{ transports?: ("adb" \| "sailfish")[] }`                                                                                        |
| Output     | `{ targets: [{ targetId, transport, serial, model, apiLevel, state, isEmulator }] }`                                              |
| Failure    | `adb` binary missing; adb server unreachable. Reported per transport, so one failing transport does not hide the other's targets. |
| Transports | both                                                                                                                              |

`state` is `device`, `offline`, `unauthorized` or `booting`. Offline and unauthorized targets are
returned, not filtered — a caller that cannot see them cannot report why its target vanished.
Evidence: `adb devices` or `devices -l` parsing appears in at least fourteen places, including
`c64scope/src/deviceRegistry.ts:41-50`, `c64scope/src/preflight.ts:53`,
`scripts/build-android-apks.mjs:241` and `scripts/lib/build-fast-path.sh:81`. `adb connect` for a
container target is at `scripts/waydroid-smoke.sh:186`.

### 8.3 `droid_target.describe_target`

| Field      | Value                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Input      | `{ targetId }`                                                                                                                      |
| Output     | `{ targetId, transport, serial, model, apiLevel, release, screen: { width, height, density, dpr }, sizeOverride, densityOverride }` |
| Failure    | Target not found; target offline.                                                                                                   |
| Transports | both (screen geometry only, on `sailfish`)                                                                                          |

`sizeOverride` and `densityOverride` are non-null when `wm size` or `wm density` reports an override.
That check exists at `tools/hil/merge_gate.mjs:761-766` because a leftover `wm size 480x640` /
`wm density 240` from a small-screen audit fails the input and clarity stages with no code fault at all.
Every caller should be able to see it without re-deriving the regex.

The `getprop` set is the union of what the repository already records into evidence:
`ro.product.model`, `ro.product.name`, `ro.hardware`, `ro.build.version.release`,
`ro.build.version.sdk`, `ro.build.characteristics` (`tools/hil/hil_stream_fixture.py:122-123`,
`c64scope/src/validation/runner.ts:176-179`).

### 8.4 `droid_app.install_app` / `uninstall_app` / `launch_app` / `stop_app` / `clear_app_data`

| Tool                       | Input                                                                                                | Output                              | Underlying operation                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `droid_app.install_app`    | `{ targetId, package, apkPath, reinstall?, allowDowngrade?, grantPermissions?, allowTestPackages? }` | `{ installed, package, apkSha256 }` | `install -r [-d] [-g] [-t]`, then `shell pm list packages <pkg>` to verify               |
| `droid_app.uninstall_app`  | `{ targetId, package, tolerateMissing? }`                                                            | `{ uninstalled }`                   | `uninstall <pkg>`                                                                        |
| `droid_app.launch_app`     | `{ targetId, package, activity?, waitForResume?, viaLauncherIntent? }`                               | `{ resumedActivity, totalTimeMs? }` | `shell am start -W -n pkg/act`, or `monkey -p pkg -c android.intent.category.LAUNCHER 1` |
| `droid_app.stop_app`       | `{ targetId, package }`                                                                              | `{ stopped }`                       | `shell am force-stop <pkg>`                                                              |
| `droid_app.clear_app_data` | `{ targetId, package, confirm: true }`                                                               | `{ cleared }`                       | `shell pm clear <pkg>`                                                                   |

Failure modes: APK not found; signature mismatch on reinstall
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), reported with the suggestion to uninstall first, which is what
`AGENTS.md:161` and `scripts/run-maestro.sh:219-220` do by hand today; package absent on
`clear_app_data`; activity not resumed within the wait.

`confirm: true` on `clear_app_data` is a second explicit act on the only tool that silently destroys
user state on a device that may be mid-run for somebody else.

`launch_app` returns `totalTimeMs` parsed from `am start -W`, because two callers already measure
startup that way (`scripts/startup/collect-android-startup-baseline.mjs:47-74`,
`scripts/measure-android-responsiveness.sh:18`).

Evidence for the flags: `install -r -d` at `scripts/build-android-apks.mjs:177`, `build:2000` and
`scripts/android-keypad-smoke.sh:40`; `install -r -g` at `scripts/smoke-no-google-services.sh:60`;
`install -r -t -d` at `scripts/run-maestro-gating.sh:526`; `pm clear` at
`scripts/build-android-apks.mjs:186` and `scripts/run-pixel4-c64u-soak.mjs:319`; `pm list packages`
verification at `scripts/build-android-apks.mjs:192-196`; `monkey` at `build:2003`; `am force-stop` at
`scripts/run-pixel4-c64u-soak.mjs:318` and `scripts/run-device-switch-soak.mjs:91`.

### 8.5 `droid_app.write_app_file` / `read_app_file`

| Tool                       | Input                                            | Output                     |
| -------------------------- | ------------------------------------------------ | -------------------------- |
| `droid_app.write_app_file` | `{ targetId, package, relativePath, content }`   | `{ bytesWritten, path }`   |
| `droid_app.read_app_file`  | `{ targetId, package, relativePath, maxBytes? }` | `{ content, bytes, path }` |

Reads and writes a file in the app's private storage through `run-as`. This is how the app is configured
before launch, and it is the least obvious operation in the whole inventory, so it gets a typed tool
rather than being left to `droid_device.run_shell`.

Four callers write a config file this way — `scripts/run-maestro-gating.sh:557`,
`scripts/run-maestro.sh:311`, `scripts/smoke-android-emulator.sh:770`,
`scripts/run-pixel4-c64u-soak.mjs:323` — all with the shape
`run-as <appId> sh -c 'mkdir -p files && cat > files/<name>'` and the payload on stdin. Four more read
results back: `scripts/run-hvsc-android-benchmark.sh:100,245,250,259`.

Failure modes: `run-as` refused, which happens on a non-debuggable build and reads as an empty result if
not checked — `c64scope/src/validation/cases/system.ts:53` already falls back to `pm dump` for exactly
this reason; path escaping outside the app's `files/` directory, which is rejected before the call.

### 8.6 `droid_input.tap` / `swipe` / `type_text` / `press_key`

| Tool                    | Input                                                          | Underlying operation                 |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `droid_input.tap`       | `{ targetId, x, y, units?: "physical" \| "css", dpr?, hold? }` | `shell input tap`, or `motionevent`  |
| `droid_input.swipe`     | `{ targetId, x1, y1, x2, y2, durationMs?, units?, dpr? }`      | `shell input swipe …`                |
| `droid_input.type_text` | `{ targetId, text }`                                           | `shell input text …`                 |
| `droid_input.press_key` | `{ targetId, keycode, longPress?, repeat? }`                   | `shell input keyevent [--longpress]` |

`units` exists because `adb shell input` speaks physical pixels while the DOM speaks CSS pixels, and
every caller converts by hand: `tools/hil/sid_radio_bug_bash_hil.mjs:190` and
`tools/hil/sid_radio_edge_cases_hil.mjs:118` both write `Math.round(g.cx * DPR)`, and
`tools/hil/joystick_hold_hil.mjs:325` documents the trap in a comment. When `units` is `"css"` the `dpr`
is required and the conversion happens once, in the server.

`hold` on `tap` selects `input motionevent DOWN` / `UP` with an explicit release rather than
`input tap`, which is what `scripts/remote-input-hil/app-touch.mjs:41-42` does for a press-and-hold on
the joystick. A tap and a hold are different gestures and the app treats them differently.

`keycode` accepts a number or an Android name (`KEYCODE_DPAD_DOWN`), since both forms are in use —
numbers at `tools/hil/keypad_reachability.mjs:62` and `scripts/android-keypad-smoke.sh:62`, the name
form at `scripts/remote-input-hil/run.sh:23`. The mapping is exposed as a resource so a caller reads it
rather than hard-coding a table. `longPress` maps to `input keyevent --longpress`
(`tools/hil/joystick_rotation_hil.mjs:250`).

`type_text` has no direct `adb` caller in the repository today: text entry goes through Maestro's
`inputText` or droidmind's `android-ui/input_text` (`droidmindClient.ts:211`). It is in the surface
because removing droidmind removes the second of those.

Failure modes: coordinates outside the reported screen bounds are rejected before injection, because an
off-screen tap silently does nothing and reads downstream as an app fault. `units: "css"` without `dpr`
is a validation error.

### 8.7 `droid_capture.screenshot`

| Field      | Value                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| Input      | `{ targetId, name, reviewWidth?, maxDimension? }`                                          |
| Output     | `{ rawPath, reviewPath, raw: { width, height }, review: { width, height } }`               |
| Failure    | Empty or non-PNG payload — checked against the PNG magic bytes before the file is written. |
| Transports | `adb`; `sailfish` by a different mechanism (§14 Q6)                                        |

Implements what `scripts/hil-screenshot-evidence.mjs` does today: `exec-out screencap -p` captured as a
buffer, written to `raw/<name>.png`, then a downscaled `review/<name>-review.png` at 480 px wide with a
1999 px hard cap (`hil-screenshot-evidence.mjs:18-19, 29-65`). The signature check mirrors
`scripts/validate-playwright-evidence.mjs:32-50`, so a zero-byte capture fails at the point of capture
rather than at evidence validation an hour later.

The three-step variant — `shell screencap -p /data/local/tmp/x.png`, `pull`, `rm` — used by
`c64scope/src/validation/helpers.ts:36-38` with one retry is the fallback when `exec-out` returns
nothing, which happens on a busy device.

### 8.8 `droid_capture.ui_hierarchy`

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Input      | `{ targetId, name?, settleTimeoutMs?, attempts? }`                   |
| Output     | `{ xmlPath, nodeCount, screen: { width, height } }`                  |
| Failure    | No `<hierarchy` root after N attempts; dump wedged past the timeout. |
| Transports | `adb`; `sailfish` unknown (§14 Q5)                                   |

The retry and settle logic is not optional. `droidmindClient.ts:213-267` retries three times, polls the
dump file size until it stops changing, and enforces a hard per-call deadline, all because a wedged
`uiautomator dump` blocked a gate runner for over five minutes. That behaviour moves into the server so
every caller gets it.

Three capture paths exist in the repository and all three should be supported, in this order: dump to
file then `exec-out cat` (`scripts/hil-screenshot-evidence.mjs:88-93`); `exec-out uiautomator dump
/dev/tty` with the trailing banner stripped (`scripts/bughunt-capture.sh:21`); and dump then `pull`
(`scripts/android-keypad-smoke.sh:63-64`). The file path is the default; `/dev/tty` is the fallback when
the device has no writable `/sdcard`.

### 8.9 `droid_capture.start_recording` / `stop_recording`

| Tool                            | Input                                                | Output                                      |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `droid_capture.start_recording` | `{ targetId, name, timeLimitSec?, bitRate?, size? }` | `{ recordingId, devicePath, timeLimitSec }` |
| `droid_capture.stop_recording`  | `{ recordingId }`                                    | `{ localPath, bytes }`                      |

`start_recording` spawns `shell screenrecord --time-limit N [--bit-rate B] <devicePath>` detached and
returns a handle; `stop_recording` sends `SIGINT` to the local adb child, waits for the MP4 to flush,
pulls the file and deletes it from the device. That is `scripts/smoke-android-emulator.sh:617-647` and
`c64scope/src/hilEvidenceRun.ts:271-302`, including the `--time-limit` default of 180 s
(`smoke-android-emulator.sh:33`) and the 6 Mbit/s bit rate (`hilEvidenceRun.ts:271`).

Failure modes: no file on the device at stop time, reported as a failed result with the paths rather
than an exception, because the surrounding flow's own result is still worth reporting — that is what
`stop_screenrecord` does today; the recording outliving its time limit, which is why the limit is
returned from `start_recording`; a `stop_recording` for an unknown `recordingId`.

The MP4 `ftyp` box is checked on pull, mirroring `scripts/validate-android-emulator-evidence.mjs:48-53`.

### 8.10 `droid_capture.logcat`

| Field      | Value                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| Input      | `{ targetId, name?, mode: "dump" \| "clear", lines?, format?, package?, tags?, filters? }` |
| Output     | `{ logPath, lineCount, matchedCount, matches }`                                            |
| Failure    | Buffer larger than the configured cap; adb timeout.                                        |
| Transports | `adb`; `sailfish` established but by a different command (§5.3)                            |

`mode: "clear"` is `logcat -c`, used before a measured window at `scripts/run-device-switch-soak.mjs:90`
and `scripts/run-pixel4-c64u-soak.mjs:335`. `mode: "dump"` is `logcat -d` with an optional `-t <lines>`
and `-v <format>`; `raw`, `brief`, `time` and `threadtime` are all in use
(`run-device-switch-soak.mjs:73,80`, `c64scope/src/validation/helpers.ts:61-73`). `package` resolves the pid
and adds `--pid`, as `helpers.ts:61-66` does. `tags` maps to `-s <TAG>:I`, as
`scripts/measure-live-view-fps.sh:40` does for `StreamUdpPlugin:I`.

`filters` is a list of regular expressions applied server-side and reported as `matchedCount` plus the
matching lines, because every caller greps the same way afterwards: `scripts/bughunt-capture.sh:25`
filters on `c64commander|AndroidRuntime|FATAL|ANR|chromium|Console`, `scripts/android-keypad-smoke.sh:73`
and `scripts/waydroid-smoke.sh:190` both filter on
`GooglePlayServicesNotAvailable|SERVICE_MISSING|FATAL EXCEPTION`, and
`scripts/run-pixel4-c64u-soak.mjs:414-424` filters for `C64U_HTTP` traffic and its failures. The full log
is still written; the filter decides only what is counted and returned inline.

The 32 MB buffer at `scripts/run-pixel4-c64u-soak.mjs:412` is the precedent for the cap.
`c64scope/src/validation/helpers.ts:61-73` additionally throws when a capture has no runtime content at all,
and that check moves into the server.

### 8.11 `droid_assert.assert_visible` / `assert_not_visible`

See §9 for the semantics. Summarised here for the surface:

| Field      | Value                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input      | `{ targetId, name, match: { resourceId?, text?, textPattern?, contentDesc?, className? }, requireEnabled?, requireOnScreen?, timeoutMs? }`          |
| Output     | `{ passed, matches: [{ resourceId, text, contentDesc, className, bounds, enabled, onScreen, rejectedBy }], evidence: { xmlPath, screenshotPath } }` |
| Failure    | Never throws for a false assertion — `passed: false` with evidence is the result. Throws only when the hierarchy cannot be captured.                |
| Transports | `adb`; `sailfish` follows `ui_hierarchy`                                                                                                            |

`assert_not_visible` is the same tool with the sense inverted, and it is not a convenience: the one check
that catches a whole-app crash is a negative assertion on "Something went wrong", because both `App.tsx`
and `PageErrorBoundary.tsx` render that exact title.

### 8.12 `droid_device.prepare_device`

| Field      | Value                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Input      | `{ targetId, waitForBoot?, dismissKeyguard?, stayOn?, disableAnimations?, requireNativeGeometry?, timeoutMs? }`              |
| Output     | `{ bootCompleted, keyguardShowing, stayOn, sizeOverride, densityOverride, resumedActivity, focusedWindow, animationScales }` |
| Transports | `adb`; `sailfish` partial                                                                                                    |

One tool for the readiness cluster that at least seven callers re-implement:

- `wait-for-device` and `getprop sys.boot_completed` — `scripts/run-maestro.sh:106-108`,
  `scripts/smoke-android-emulator.sh:426-433`, `scripts/android-emulator.sh:199-209`,
  `scripts/smoke-no-google-services.sh:29-35`.
- `wm dismiss-keyguard` — `scripts/run-maestro.sh:139`, `scripts/run-device-switch-soak.mjs:93`,
  `scripts/smoke-android-emulator.sh:457`.
- `svc power stayon usb` and `stayon false` — `scripts/run-maestro.sh:136,118`,
  `tools/hil/seek_latency_hil.py:408`.
- `dumpsys window policy` keyguard state — `scripts/run-maestro.sh:130`,
  `scripts/smoke-android-emulator.sh:464-467`, `tests/android-emulator/helpers/device.mjs:52-57`.
- `dumpsys window` focused window — `scripts/run-maestro-gating.sh:100`, `scripts/run-maestro.sh:124`.
- `dumpsys activity activities` resumed activity — `scripts/bughunt-capture.sh:14`,
  `scripts/smoke-android-emulator.sh:510`, `scripts/waydroid-smoke.sh:187`.
- `settings put global window_animation_scale|transition_animation_scale|animator_duration_scale 0` —
  `scripts/run-maestro-gating.sh:511-513`, read back at `:324-326`.
- `wm size` override — `tools/hil/merge_gate.mjs:761`.

`requireNativeGeometry: true` fails when `wm size` or `wm density` reports an override. The merge gate
already refuses to run in that state, and `tools/hil/README.md:19-40` explains why a hidden or locked
WebView produces symptoms that read exactly like an app hang: Chromium suspends timers in a hidden page,
so debounces never fire and `Filesystem.readFile` promises never settle, while `Runtime.evaluate` keeps
working and the page looks responsive.

### 8.13 `droid_device.run_shell`

| Field      | Value                                                            |
| ---------- | ---------------------------------------------------------------- |
| Input      | `{ targetId, command: string[], timeoutMs?, maxBytes?, stdin? }` |
| Output     | `{ stdout, stderr, exitCode, truncated }`                        |
| Transports | both                                                             |

The escape hatch, kept because `droidmindClient.ts` needed one and because a surface derived from
current usage will not anticipate the next harness. `command` is an argument array, not a string, so the
server never builds a shell line by concatenation. `stdin` exists because the `run-as` config-seeding
pattern needs it. It is not a substitute for the typed tools: a review rule, not a runtime one.

### 8.14 `droid_device.forward_webview` / `push_file` / `pull_file`

| Tool                           | Input                                                | Output                       |
| ------------------------------ | ---------------------------------------------------- | ---------------------------- |
| `droid_device.forward_webview` | `{ targetId, package, localPort, replaceExisting? }` | `{ localPort, socket, pid }` |
| `droid_device.push_file`       | `{ targetId, localPath, remotePath, recursive? }`    | `{ bytes, remotePath }`      |
| `droid_device.pull_file`       | `{ targetId, remotePath, localPath }`                | `{ bytes, localPath }`       |

`forward_webview` resolves the app's pid and forwards a local TCP port to
`localabstract:webview_devtools_remote_<pid>`, removing any existing forward on that port first. Eight
call sites do this by hand today, each with its own pid lookup: `scripts/run-pixel4-c64u-soak.mjs:57-60`,
`scripts/remote-input-hil/run.sh:24`, `scripts/bughunt-snap.sh:12-13`, `tools/hil/av_sync_hil.py:67-68`,
`tools/hil/hil_stream_fixture.py:64-65`, `tools/hil/sid_radio_hil.py:63-67`,
`tools/hil/input_latency_hil.py:51-52`, and `docs/agentic/hil-rc4/snap.sh:13`. Two resolution methods are
in use — `pidof <pkg>` and a regex over `cat /proc/net/unix` — and the second is the fallback when the
first returns more than one pid.

**`package` is required, and this is the reason.** When both application ids are installed, both open a
DevTools socket; picking the first one attaches to the wrong app, and the other edition may still hold an
`AudioTrack` and corrupt an audio measurement.

Every rebuild replaces the app process and invalidates the forward, which is why this is a tool rather
than a setup step performed once. Six harnesses require an existing forward and create none
(`tools/hil/merge_gate.mjs:61`, `keypad_reachability.mjs:36`, `joystick_hold_hil.mjs:47`,
`joystick_rotation_hil.mjs:49`, `hvsc_search_soak.mjs:29`, `scripts/bughunt-cdp.mjs:4`), so this tool is
the missing setup step they all document in a comment.

`push_file` and `pull_file` cover fixture staging: SID files into the HVSC tree
(`scripts/run-maestro.sh:248-252`), a whole asset directory
(`scripts/startup/stage-local-assets-adb.sh:32`), and the HVSC corpus archive
(`scripts/smoke-android-emulator.sh:268-278`).

### 8.15 Transport support matrix

| Tool                                               | `adb` | `sailfish`                                                             |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `droid_target.list_targets`                        | yes   | needs a connection method — §14 Q2, Q4                                 |
| `droid_target.describe_target`                     | yes   | partial — panel geometry is known, `wm size` availability is not       |
| `droid_app.install_app`                            | yes   | likely via `apkd-install` — §14 Q3                                     |
| `droid_app.uninstall_app` / `clear_app_data`       | yes   | unknown — §14 Q3                                                       |
| `droid_app.launch_app` / `stop_app`                | yes   | likely via `appsupport-attach /system/bin/am` — §14 Q4                 |
| `droid_app.write_app_file` / `read_app_file`       | yes   | unknown — `run-as` inside the container is untested                    |
| `droid_input.*`                                    | yes   | unknown, and the biggest gap — §14 Q5                                  |
| `droid_capture.screenshot`                         | yes   | likely, by the lipstick D-Bus call — §14 Q6                            |
| `droid_capture.ui_hierarchy`                       | yes   | unknown; known to fail under `appsupport-attach` — §5.3, §14 Q5        |
| `droid_capture.start_recording` / `stop_recording` | yes   | no direct equivalent; VNC capture is the candidate — §14 Q7            |
| `droid_capture.logcat`                             | yes   | **established** via `appsupport-attach /system/bin/logcat`             |
| `droid_assert.*`                                   | yes   | follows `ui_hierarchy`                                                 |
| `droid_device.prepare_device`                      | yes   | partial                                                                |
| `droid_device.run_shell`                           | yes   | established via `appsupport-attach`, with the exit-code caveat in §5.3 |
| `droid_device.forward_webview`                     | yes   | unknown — §14 Q9                                                       |
| `droid_device.push_file` / `pull_file`             | yes   | likely via `scp` plus a container copy                                 |

"Unknown" is reported at runtime as `unsupported_on_transport`, never approximated.

---

## 9. Assertion semantics

### 9.1 What the repository does today

Four mechanisms are in use, and they disagree with each other.

1. **Maestro `assertVisible` / `assertNotVisible`** against the Android accessibility tree — 77 and 24
   uses across the flows. Selectors: `text:` (161 uses, whole-element text) and `id:` (115 uses).
2. **`uiautomator dump` plus a grep.** `scripts/android-keypad-smoke.sh:65` decides "something has
   focus" with `grep -o 'focused="true"'`; `scripts/run-pixel4-c64u-soak.mjs:296-300` decides which fixed
   coordinate to tap with `dump.includes("Android app compatibility")`.
3. **`uiautomator dump` plus bounds parsing.** `c64scope/src/cta/uiHelpers.ts:27` has an `isVisible()`
   that parses `bounds="[x1,y1][x2,y2]"` and treats non-degenerate bounds as visible. **There is no
   on-screen-rectangle check anywhere in the repository**, so a node scrolled far off the viewport counts
   as visible today.
4. **CDP queries against the DOM** — every harness in `tools/hil/`, which is why they can address
   `data-testid`.

Three facts constrain the choice, all learned the hard way.

- **Maestro's `id:` matches the HTML `id` attribute, not `data-testid`.** It addresses elements through
  the accessibility tree, where Chrome fills `resource-id` from the HTML `id`. An element that sets only
  a testid is unaddressable that way. `.maestro/smoke-hvsc.yaml:57-59` documents that `CollapsibleSection`
  deliberately sets the HTML id to the same string as the testid so `id:` works at all.
- **A selector matches an element's whole text**, and the browser merges inline spans into the
  containing row. A word inside a row is not its own accessibility node, so asserting it fails while the
  word is plainly on screen.
- **Assertions on persistent chrome cannot fail.** A release shipped with a crashed page and a failed
  rename while the smoke run reported a clean walk, because the anchors matched the tab bar and a field
  label rather than page content.

Only one place in the whole harness accounts for partial occlusion: Maestro's `scrollUntilVisible` with
`visibilityPercentage: 50` and `centerElement: true` (`.maestro/smoke-hvsc.yaml:60-67`).

### 9.2 The decision

**`droid_assert.assert_visible` decides visibility from the UI hierarchy dump — the same accessibility
tree Maestro uses — and never from image comparison.**

Reasons, in order:

1. It is the only mechanism that works identically for a WebView element and a native dialog. Image
   comparison cannot tell an element apart from a screenshot of it, and this app renders almost
   everything in a WebView.
2. It is transport-portable in principle: if the container exposes `uiautomator`, the same assertion
   works there. An image comparison would need a reference per device geometry, and the small-screen
   target is a third one.
3. Screenshot comparison is already covered elsewhere. The Playwright corpus does pixel comparison for
   layout; a second device-side pixel oracle would produce a gate that fails for reasons neither tool
   can attribute.

A match is `passed: true` when at least one node satisfies every provided predicate:

- `resourceId` — exact match on the node's `resource-id`. The tool description states at the point of use
  that this is the HTML `id`, not `data-testid`, so the trap above is visible to the caller.
- `text` — exact match on the node's whole `text` attribute.
- `textPattern` — a regular expression against `text`, which is the supported way to match part of a
  merged row.
- `contentDesc`, `className` — exact match.
- `requireEnabled` (default true) — `enabled="true"`.
- `requireOnScreen` (default true) — the node's `bounds` intersect the screen rectangle reported by
  `droid_target.describe_target`, with non-zero area. This is the check the repository does not have
  today (§9.1 item 3), and it is the difference between "the element exists in the tree" and "a person
  could see it".

`timeoutMs` re-captures the hierarchy on an interval until the predicate holds or the deadline passes.
The default is a single capture; polling is opt-in so a negative assertion is not slow by default.

### 9.3 What the caller is told when it fails

A failed assertion is a result, not an exception, and it carries the evidence needed to diagnose it
without another round trip:

1. `xmlPath` — the full hierarchy dump, written to the run directory.
2. `screenshotPath` — a screenshot captured at the same moment.
3. `matches` — every node that satisfied _some_ predicate, each with `rejectedBy` naming the predicate
   that failed. That is what distinguishes "the element is not there" from "the element is there,
   disabled" and from "the element is there, off-screen" — three different bugs a bare `false` cannot
   tell apart.
4. `screen` and `bounds` for anything rejected by `requireOnScreen`.

### 9.4 What this does not do

It does not assert on rendered pixels, and it does not know about `data-testid`. A harness that needs a
testid keeps using CDP, with the port forward from `droid_device.forward_webview`. That boundary is
deliberate: the two oracles answer different questions and merging them would produce a tool that is
right for neither.

---

## 10. Evidence and artifacts

### 10.1 Where artifacts go

`droidctl` writes under a run root, defaulting to `artifacts/droidctl/<runId>/`, overridable per call and
by environment variable. `artifacts/` is gitignored (`.gitignore:47`). The run id follows c64scope's
`createRunId()` shape (`c64scope/src/types.ts:55-60`) with its own prefix: `dc-<YYYYMMDDTHHMMSSZ>`.

```
artifacts/droidctl/dc-20260831T142530Z/
  index.json          # every artifact this run produced, with tool, timestamp and target
  raw/<name>.png      # screenshots at native resolution
  review/<name>-review.png
  hierarchies/<name>.xml
  video/<name>.mp4
  logs/logcat/<name>.log
  logs/commands.jsonl # every transport invocation: argv, exit code, duration, target id
```

The `raw/` `review/` `hierarchies/` `logs/logcat/` split is `scripts/bughunt-capture.sh:12` and
`scripts/hil-screenshot-evidence.mjs:127-129` verbatim, so an existing reader knows where to look.

`commands.jsonl` is new and is part of the point. Today a failed HIL stage leaves no record of which
`adb` calls ran. Every entry names the target id, so a wrong-device incident is visible after the fact as
well as prevented before it.

### 10.2 Relationship to the existing conventions

- **c64scope sessions.** When a caller passes a `runRoot`, `droidctl` writes into it and returns paths a
  caller can hand to `scope_session.attach_evidence`. `droidctl` does not call c64scope itself; the
  orchestrating agent joins them, as it does today.
- **The evidence validators.** `scripts/validate-playwright-evidence.mjs` and
  `scripts/validate-android-emulator-evidence.mjs` check magic bytes for PNG, WEBM, ZIP and MP4, and
  reject zero-byte files. `droidctl` performs the same checks at capture time, so the failure surfaces
  where it happened.
- **The review-size screenshot.** Kept at 480 px wide with a 1999 px cap, matching
  `scripts/hil-screenshot-evidence.mjs:18-19`, so a captured PNG can be read by an agent without
  exceeding an image size limit.

---

## 11. Testing strategy

The requirement is that the tests can fail for the right reason. Each subsection states the mutation that
must turn it red.

### 11.1 Unit tests against a fake transport

A `FakeTransport` implements `Transport` with scripted responses and records every call. Every tool
module is tested through it, with no `adb` binary involved. `c64scope/tests/toolCoverage.test.ts` is the
model: build a context over a temp directory, invoke the module, parse the JSON out of
`content[0].text`.

Coverage includes the failure paths, which is where the current scripts are weakest: an install that
reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; a `uiautomator dump` that never produces a `<hierarchy`
root; a `screenrecord` whose file is missing at stop time; a truncated logcat; a `run-as` refusal that
returns an empty body with exit code 0.

_Proof of failure:_ deleting the `pm list packages` verification step from `install_app` makes the
install test fail, because the test asserts on the recorded call sequence, not only on the returned `ok`.

### 11.2 Targeting tests

The tests that exist because of §6, kept in one file so a reviewer can find them:

1. `adbArgs()` always emits `-s <serial>` — a property test over generated argument arrays asserting
   `argv[0] === "-s"`, with no exceptions.
2. Every tool descriptor except `droid_target.list_targets` declares `target` in its `required` array.
   Derived from the registry at runtime, so a new tool is covered the day it is added.
3. Every tool whose name matches an application-scoped operation declares `package` as required, derived
   the same way.
4. `list_targets` output contains no key matching `/default|preferred|current/i`.
5. Two targets whose ids collide produce an `ambiguous_target` error listing both, not a pick.
6. A `targetId` that no longer appears in `listTargets()` produces `target_not_found`, and the fake
   records zero device calls.

_Proof of failure:_ re-introducing the `serials.length === 1` fallback from
`scripts/build-android-apks.mjs:248` makes tests 5 and 6 fail.

### 11.3 Contract tests for the schemas

Every tool is registered with a JSON Schema and validated with a zod schema. These drift. The contract
test walks the registry and, for each tool:

- asserts the JSON Schema's `required` list matches the zod schema's non-optional keys;
- asserts `additionalProperties: false` on every object schema;
- round-trips a generated valid payload through both;
- asserts an invalid payload is rejected by the zod schema with a `ToolValidationError`.

It also asserts every tool name is unique across modules. `c64scope/src/tools/registry.ts:38-42` throws on
a duplicate at load; the test makes that observable rather than a startup crash.

_Proof of failure:_ adding an optional field to a zod schema without adding it to the JSON Schema turns
the round-trip red.

### 11.4 Server handler tests

`tools/list`, `tools/call`, `resources/list`, `resources/read`. Modelled on
`c64scope/tests/serverHandlers.test.ts`, which reaches the handlers directly off the `Server` instance
rather than opening a transport. Includes: an unknown tool name produces a structured error result with
`isError: true` rather than a protocol-level throw; a tool that throws is converted by
`unknownErrorResult`.

### 11.5 Artifact tests

Screenshot capture writes both raw and review files with correct dimensions and a valid PNG signature;
recording stop writes an MP4 with a valid `ftyp` box; `index.json` and `commands.jsonl` record every call.
These run against fixture bytes through the fake transport, so no device is needed.

_Proof of failure:_ returning a truncated buffer from the fake makes the signature assertion fail.

### 11.6 What genuinely requires hardware

Honestly bounded, and none of it in CI:

- That `exec-out screencap -p` returns a real framebuffer from the Pixel 4.
- That `screenrecord` produces a playable MP4 of the expected duration.
- That `input tap` at converted CSS coordinates lands on the intended element.
- That `forward_webview` yields a CDP socket the existing helpers can attach to, and that it picks the
  right application id when both are installed.
- That `uiautomator dump` settles within the retry budget on a busy device.

These are covered by one manual script, `droidctl/scripts/smoke-device.mjs`, run against an explicitly
named target and producing an artifact bundle. It is not a merge gate: `tools/hil/merge_gate.mjs` already
is one, and a second device gate doubles rig contention for no new signal.

**Nothing on the Sailfish transport can be verified here.** No such device is on the bench, and
`AGENTS.md:1004-1015` forbids gating on one. The stub is unit-tested to return `transport_unavailable`
and nothing more is claimed.

### 11.7 Coverage

c64scope enforces 90% statements, 85% branches, 90% functions and 90% lines with an explicit exclusion
list for runner entrypoints (`c64scope/vitest.config.ts:33-40`). `droidctl` adopts the same thresholds,
excluding only `src/index.ts` and the manual smoke script.

---

## 12. Migration

Nothing is migrated in the change that introduces the server. Each step below is separately reviewable
and separately revertible.

### 12.1 First — the c64scope client

`c64scope/src/validation/droidmindClient.ts` is the only programmatic consumer of `droidmind`, and its
required-capability list (`c64scope/src/cta/capabilities.ts:27-37`) maps one-to-one onto droidctl's tools.
Replacing it is a contained change with existing tests (`c64scope/tests/droidmindClient.test.ts`,
`c64scope/tests/ctaCapabilities.test.ts`) and it removes the `uvx` dependency from eleven CTA gate
runners at once.

The client's `scrollDown` helper (`droidmindClient.ts:180-189`), which swipes and compares hierarchy keys
to detect the end of a list, stays in c64scope. It is a UI-walking policy, not a device operation.

### 12.2 Second — capture and evidence helpers

`scripts/hil-screenshot-evidence.mjs` and `scripts/bughunt-capture.sh` are thin wrappers over screenshot,
UI dump, resumed activity and logcat. They become droidctl calls with no behaviour change, and the
hard-coded serial at `bughunt-capture.sh:6` becomes an explicit target argument.

### 12.3 Third — the deploy path

`scripts/build-android-apks.mjs` already models its work as a step list (`planVariantAdbSteps`,
`build-android-apks.mjs:152-198`) with a test-facing export, so the steps become droidctl calls without
restructuring. This is the change that removes the `if (serials.length === 1) return serials[0]` fallback,
so it is worth doing on its own merits even if nothing else migrates.

### 12.4 Fourth — the readiness cluster and the CDP forward

The callers listed in §8.12 replace their hand-rolled boot, keyguard, stay-on and geometry checks with
`prepare_device`; the eight listed in §8.14 replace their pid lookup and `adb forward` with
`forward_webview`. Both are mechanical, and both spread a check that currently exists in only one place —
the `wm size` override guard, and the correct-application-id socket choice — to every caller.

### 12.5 Not worth migrating

Stated plainly so nobody spends the effort:

- **`tools/hil/merge_gate.mjs` and the audio harnesses.** They interleave `adb`, CDP and microphone
  capture with timing that matters, and they are the release gate. Introducing an MCP hop into a latency
  measurement changes what is being measured. Giving `merge_gate.mjs` an explicit `-s` is worth doing on
  its own; routing it through droidctl is not.
- **`scripts/smoke-android-emulator.sh` and `scripts/run-maestro*.sh`.** They run in CI on
  `ubuntu-latest` against an emulator, where wrong-device targeting cannot occur and adding a Node MCP
  server to the job is cost without benefit.
- **The Python HIL harnesses.** They would need an MCP client in Python, which is exactly the dependency
  surface this work exists to remove.
- **`scripts/waydroid-smoke.sh`.** Deliberately self-contained and disable-able
  (`waydroid-smoke.sh:11-15`). Leave it alone.

### 12.6 Removing droidmind

`.mcp.json` keeps the `droidmind` entry, with its `mcp<2` pin, until §12.1 and §12.2 have landed and one
CTA run has completed against `droidctl`. Removing it is the last step, together with
`scripts/setup-agentic-mcp.mjs`, whose `serverNames` array at line 16 is the registry that writes MCP
config into `.mcp.json`, `~/.codex/config.toml` and `~/.claude.json`. Ninety-two markdown files mention
`droidmind`; most are historical records and are left alone. Only those describing current procedure are
updated, chiefly `AGENTS.md:715-725` and `docs/agentic/prompt.md:3`.

---

## 13. Risks

| Risk                                                                                              | Mitigation                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| droidctl becomes a second place where adb behaviour is defined, and the two drift.                | Migrate in the order in §12 and delete the duplicated helper in the same change that replaces it.                                                                         |
| The MCP hop adds latency that matters to a timing-sensitive harness.                              | §12.5 keeps those harnesses off droidctl. `commands.jsonl` records per-call duration so the overhead is measurable rather than assumed.                                   |
| The Sailfish backend is specified and never built.                                                | It is explicitly not on the critical path (§7.4, §12), and the stub returns a probe procedure rather than pretending.                                                     |
| A Sailfish implementation is written against the research in §5.3 and quietly does nothing.       | The exit-code-is-not-evidence rule in §7.4, plus the requirement that every capture verifies its artifact.                                                                |
| `@modelcontextprotocol/sdk` publishes a breaking major and droidctl inherits droidmind's failure. | A caret range in `droidctl/package.json` plus a committed `package-lock.json`, as `c64scope/package.json` already has. This is precisely the mitigation droidmind lacked. |
| The assertion oracle passes on a page that is visibly broken.                                     | The `requireOnScreen` default in §9.2, which the repository does not have today, plus `assert_not_visible` for the error-boundary title.                                  |

---

## 14. Open questions

The Sailfish transport, in order of how much each blocks. Every one names the check that would settle it,
so a future session with such a device can answer them without repeating the research.

**Q1. Does the target device expose Sailfish developer mode at all?** The research could not reach the
vendor's own pages, and the product is a deliberately locked-down build that blocks whole application
categories at system level. Developer mode may be absent or modified. If it is absent, every path below
except compositor-level VNC automation collapses. _Check:_ Settings — is there a "Developer tools" entry?

**Q2. What are the connection details?** Sailfish's documented defaults are SSH as `defaultuser`,
`192.168.2.15` over USB, a password set in the developer-mode settings page, and `devel-su` for root.
Whether this build keeps them is unknown. _Check:_ `cat /etc/sailfish-release`, `echo $USER`,
`command -v appsupport-attach apkd-install appsupport-config`.

**Q3. How is an APK installed?** `apkd-install <file.apk>` is well attested in community use but is not
in Jolla's documentation, and the absolute path is unconfirmed. Whether
`appsupport-attach /system/bin/pm install` is an acceptable substitute is also unknown — `apkd` performs
host-side integration that a raw `pm install` would skip. _Check:_ run `apkd-install` on a test APK and
see whether the app appears in the launcher; then try the `pm install` route and compare.

**Q4. Can an adb connection be made into the container?** One first-hand report describes enabling
Developer Options inside AppSupport, turning on wireless debugging, then `adb connect <ip>:5555` from the
workstation. **This is the single highest-value question: a yes collapses Q5 through Q9**, because the
existing `adb` backend then applies unchanged. It is unresolved whether the port is really 5555 or
whether Android 13's random-port-plus-pairing-code wireless debugging applies. _Check:_ enable wireless
debugging in the container, read the port from its dialog, then try both `adb connect` and `adb pair`.

**Q5. Does `input` work inside the container?** `uiautomator` is known to fail under `appsupport-attach`
while returning exit code 0, and `input` has never been tested by any source found. _Check:_ run
`input tap` both over adb and under `appsupport-attach`, and compare `echo $?` against an observed screen
change. Exit 0 is not evidence on this platform.

**Q6. Does a Sailfish-side screenshot capture Android window content?** Android apps are Wayland surfaces
in the compositor, which argues for yes, but a hardware overlay or protected path could yield a black
rectangle. An Android-side `screencap` would capture only the Android surface, which may be what an
assertion wants. _Check:_ with the app on screen, take both captures and compare each against the panel.

**Q7. How is a screen recording made?** There is no official CLI. The documented mechanism is a VNC
server that grabs compositor frames on port 5900 with no authentication, reachable over the USB network
or an SSH tunnel; community recorders wrap it with ffmpeg. Whether the stream renders Android windows is
the same unknown as Q6. _Check:_ tunnel the port, record, and look at the output.

**Q8. Does the app's own logging reach the container's logcat?** `logcat` under `appsupport-attach` is
vendor-documented and works. Whether the WebView console and the app's tags appear there is unconfirmed.
_Check:_ run `logcat` while the app logs a known string.

**Q9. Can a port be forwarded to the WebView DevTools socket?** It is an abstract Unix socket in the
container's network namespace. Reaching it needs either the container's own `adb forward` or a
namespace-aware relay. _Check:_ after Q4, try the ordinary `adb forward`.

**Q10 (not Sailfish). Should droidctl own emulator lifecycle?** `scripts/android-emulator.sh` and the CI
workflow both start emulators. Bringing that under droidctl would let it refuse to enumerate a
half-booted emulator as a target. Deferred: it is provisioning, which §3 puts out of scope, and the
argument for changing that is not yet strong enough.

**Q11. Where should the server live?** This specification assumes `droidctl/` beside `c64scope/`. The
alternative is a workspace package under a `packages/` root, which the repository does not use today.
Following the existing precedent is the lower-risk choice; it is recorded here as a decision rather than
an assumption.

---

## Appendix A — the adb operations in use today

Derived by reading every file that invokes `adb`. Thirty-nine files under `tools/hil/` and `scripts/`
mention it; about 242 lines across the repository are actual invocations. This is the covered list —
anything absent is out of scope for droidctl.

| Operation                                         | Representative site                                       | Tool                                |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `devices` / `devices -l`                          | `c64scope/src/deviceRegistry.ts:54`                       | `droid_target.list_targets`         |
| `connect <host:port>`                             | `scripts/waydroid-smoke.sh:186`                           | `droid_target.list_targets`         |
| `get-state`                                       | `scripts/smoke-android-emulator.sh:340`                   | `droid_target.list_targets`         |
| `wait-for-device`                                 | `scripts/run-maestro.sh:106`                              | `droid_device.prepare_device`       |
| `shell getprop sys.boot_completed`                | `scripts/run-maestro.sh:108`                              | `droid_device.prepare_device`       |
| `shell getprop ro.*`                              | `tools/hil/hil_stream_fixture.py:122`                     | `droid_target.describe_target`      |
| `install -r [-d] [-g] [-t]`                       | `scripts/build-android-apks.mjs:177`                      | `droid_app.install_app`             |
| `uninstall <pkg>`                                 | `scripts/build-android-apks.mjs:165`                      | `droid_app.uninstall_app`           |
| `shell pm clear <pkg>`                            | `scripts/build-android-apks.mjs:186`                      | `droid_app.clear_app_data`          |
| `shell pm list packages <pkg>`                    | `scripts/build-android-apks.mjs:192`                      | `droid_app.install_app` verify      |
| `shell am start -W -n pkg/act`                    | `scripts/startup/collect-android-startup-baseline.mjs:47` | `droid_app.launch_app`              |
| `shell monkey -p pkg -c …LAUNCHER 1`              | `build:2003`                                              | `droid_app.launch_app` fallback     |
| `shell am force-stop <pkg>`                       | `scripts/run-pixel4-c64u-soak.mjs:318`                    | `droid_app.stop_app`                |
| `shell pidof <pkg>`                               | `scripts/bughunt-snap.sh:12`                              | `droid_device.forward_webview`      |
| `shell run-as <pkg> sh -c 'cat > files/…'`        | `scripts/run-maestro.sh:311`                              | `droid_app.write_app_file`          |
| `shell run-as <pkg> sh -c 'cat files/…'`          | `scripts/run-hvsc-android-benchmark.sh:100`               | `droid_app.read_app_file`           |
| `shell input tap X Y`                             | `tools/hil/sid_radio_bug_bash_hil.mjs:190`                | `droid_input.tap`                   |
| `shell input motionevent DOWN/UP`                 | `scripts/remote-input-hil/app-touch.mjs:41`               | `droid_input.tap` with `hold`       |
| `shell input swipe …`                             | `tools/hil/joystick_hold_hil.mjs:360`                     | `droid_input.swipe`                 |
| `shell input keyevent [--longpress] N`            | `tools/hil/keypad_reachability.mjs:62`                    | `droid_input.press_key`             |
| `shell input text …`                              | via droidmind, `droidmindClient.ts:211`                   | `droid_input.type_text`             |
| `exec-out screencap -p`                           | `scripts/hil-screenshot-evidence.mjs:73`                  | `droid_capture.screenshot`          |
| `shell screencap -p <tmp>` + `pull` + `rm`        | `c64scope/src/validation/helpers.ts:36-38`                | `droid_capture.screenshot` fallback |
| `shell uiautomator dump <path>` + `exec-out cat`  | `scripts/hil-screenshot-evidence.mjs:88-93`               | `droid_capture.ui_hierarchy`        |
| `exec-out uiautomator dump /dev/tty`              | `scripts/bughunt-capture.sh:21`                           | `droid_capture.ui_hierarchy`        |
| `shell screenrecord [--bit-rate] [--time-limit]`  | `c64scope/src/hilEvidenceRun.ts:271`                      | `droid_capture.start_recording`     |
| `pull <devicePath> <local>` + `shell rm`          | `scripts/smoke-android-emulator.sh:642-644`               | `droid_capture.stop_recording`      |
| `logcat -c`                                       | `scripts/run-device-switch-soak.mjs:90`                   | `droid_capture.logcat`              |
| `logcat -d [-t N] [-v fmt] [--pid P] [-s TAG]`    | `c64scope/src/validation/helpers.ts:61-73`                | `droid_capture.logcat`              |
| `shell dumpsys activity activities`               | `scripts/bughunt-capture.sh:14`                           | `droid_device.prepare_device`       |
| `shell dumpsys window [policy]`                   | `scripts/run-maestro.sh:124-130`                          | `droid_device.prepare_device`       |
| `shell wm dismiss-keyguard`                       | `scripts/run-maestro.sh:139`                              | `droid_device.prepare_device`       |
| `shell svc power stayon usb\|false`               | `scripts/run-maestro.sh:136,118`                          | `droid_device.prepare_device`       |
| `shell settings put/get global *_animation_scale` | `scripts/run-maestro-gating.sh:511-513`                   | `droid_device.prepare_device`       |
| `shell wm size` / `wm density`                    | `tools/hil/merge_gate.mjs:761`                            | `droid_target.describe_target`      |
| `forward [--remove] tcp:N localabstract:…`        | `tools/hil/av_sync_hil.py:67-68`                          | `droid_device.forward_webview`      |
| `shell cat /proc/net/unix`                        | `scripts/run-pixel4-c64u-soak.mjs:57`                     | `droid_device.forward_webview`      |
| `push <local> <remote>`                           | `scripts/run-maestro.sh:248`                              | `droid_device.push_file`            |
| `pull <remote> <local>`                           | `scripts/android-keypad-smoke.sh:64`                      | `droid_device.pull_file`            |

Deliberately excluded, each used in one or two places and better left there:
`shell dumpsys audio` and the volume keyevents at `tools/hil/merge_gate.mjs:260-279`;
`shell dumpsys gfxinfo` at `scripts/measure-android-responsiveness.sh:35`;
`shell dumpsys battery`, `meminfo`, `power`, `package`; `shell ime list` / `ime disable` at
`scripts/smoke-no-google-services.sh:85-89`; `shell cmd overlay enable-exclusive` at
`smoke-no-google-services.sh:113`; `shell top`, `shell curl`, `shell perfetto` at
`scripts/run-hvsc-android-benchmark.sh:208`; `kill-server` / `start-server`; `emu kill`. Every one is
reachable through `droid_device.run_shell` without a typed tool. Not used anywhere at all, and therefore
not implemented: `adb root`, `remount`, `disable-verity`, `bugreport`, `reverse`, `shell setprop`,
`shell pm grant`, `shell am broadcast`, `shell content`.

## Appendix B — the droidmind surface that must be replaced

From `c64scope/src/cta/capabilities.ts:27-37`, which fails preflight if any is missing.

| droidmind tool and action         | droidctl replacement                                   |
| --------------------------------- | ------------------------------------------------------ |
| `android-device` / `list_devices` | `droid_target.list_targets`                            |
| `android-app` / `start_app`       | `droid_app.launch_app`                                 |
| `android-app` / `stop_app`        | `droid_app.stop_app`                                   |
| `android-ui` / `tap`              | `droid_input.tap`                                      |
| `android-ui` / `swipe`            | `droid_input.swipe`                                    |
| `android-ui` / `press_key`        | `droid_input.press_key`                                |
| `android-ui` / `input_text`       | `droid_input.type_text`                                |
| `android-shell`                   | `droid_device.run_shell`, `droid_capture.ui_hierarchy` |
| `android-screenshot`              | `droid_capture.screenshot`                             |

Every shell command the client sends through `android-shell` is covered: the four that make up the UI
dump (`rm -f`, `uiautomator dump`, the `wc -c` settle poll, `cat`) become `droid_capture.ui_hierarchy`;
`wm dismiss-keyguard` and the `dumpsys window` keyguard check become `droid_device.prepare_device`; the
two `settings put system` rotation writes (`c64scope/src/cta/gate6.ts:118-119`) stay as
`droid_device.run_shell`.

Two behaviours implemented in `droidmindClient.ts` move into the server rather than being reimplemented
by callers: the settle-and-retry loop around `uiautomator dump` (`droidmindClient.ts:213-267`) and the
hard per-call deadline (`droidmindClient.ts:283-296`).
