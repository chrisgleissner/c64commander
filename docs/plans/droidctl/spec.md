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
- **`ssh`** — a Linux phone whose Android apps run inside an Android compatibility container, reached
  over SSH on the phone's USB network link rather than directly over `adb`.

The name states what is controlled — the Android app — rather than the transport, so it stays accurate
for the container target. The `ctl` suffix follows `systemctl` / `journalctl` / `kubectl`.

The tool surface is derived from what this repository already does with `adb`. Thirty-nine files under
`tools/hil/` and `scripts/` mention `adb`, and about 242 lines across the repository are actual `adb`
invocations. §8 covers the operations those lines use and nothing else.

**One requirement is structural rather than convenient: every tool takes an explicit target and refuses
to guess.** §6 gives the incident behind it and the four places in the repository where the unsafe
pattern still lives.

---

## 2. Goals

1. Restore the capability `droidmind` provided, on a dependency surface this repository controls.
2. Give one tool interface that works against `adb` targets and against an Android container on a
   Linux phone reached over SSH — so a caller does not branch on transport.
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
- **Provisioning.** `droidctl` does not create emulators, flash a phone, enable developer mode, or
  install SSH keys. It reports which of those is missing (§14).

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

### 5.3 The `ssh` transport — what the design rests on

The target is a Linux phone whose Android apps run in an Android compatibility container: a modified
Android sharing the host kernel, each app shown as a window of the phone's own compositor. The facts
below are what the implementation in §7.4 is built on. None of them can be exercised in CI, so every
one that the implementation depends on is detected at runtime and reported by name when it does not
hold (§14).

- **Developer mode enables SSH.** Over USB networking the phone conventionally takes `192.168.2.15`;
  the login user is typically `defaultuser`, and `devel-su` gives an interactive root shell with the
  developer password. droidctl never types a password, so it uses key authentication only.
- **The phone ships no `adb` client.** The adb client runs on the desktop.
- **A command can be run inside the container as root** through a container attach command: a
  platform helper whose name ends in `-attach`, or `lxc-attach -n <container> --` on an LXC-based
  build. `logcat` and `pm` work that way.
- **An attach command is not equivalent to `adb shell`.** A first-hand report has `uiautomator dump`
  run through it returning exit code 0 while writing no file, both as root and as uid 2000, while the
  same command over adb worked. The failure is specific to UI-session tools, and **an exit code of 0 is
  not evidence of success there**. Anything done through that route is verified by its artifact or
  refused.
- **adb over TCP into the container has been reported to work** after enabling Developer options and
  debugging inside the container. When it works the whole `adb` backend applies unchanged, which is
  why droidctl prefers it (§7.4).
- **Installing through `pm install` inside the container skips any host-side integration** the
  platform's own installer adds, such as a launcher entry. Whether that matters depends on how the app
  is launched; `droid_app.start_app` uses `am start`, which does not need a launcher entry.
- **Screen recording has no Android-side route that can be stopped gracefully** except a detached
  `adb shell`, and the compositor's own capture mechanisms are outside the Android container, so they
  are out of scope.

A third-party D-Bus daemon that exposed tap, swipe, key and launch calls for such a container exists
but targets old Android API levels and is unmaintained, and an Appium port for the host's native
toolkit has no Android support. Neither is used.

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
| `src/transport/ssh*.ts`        | —                        | The `ssh` backend: configuration, discovery, probe, routes.           |

### 7.2 The transport abstraction

One interface, two implementations, and nothing above it knows which is in use:

```ts
export interface Transport {
  readonly kind: "adb" | "ssh";
  listTargets(): Promise<TargetInfo[]>;
  exec(target: ResolvedTarget, argv: readonly string[], opts?: ExecOptions): Promise<ExecResult>;
  pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer>;
  pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<void>;
  installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<void>;
  forwardPort(target: ResolvedTarget, localPort: number, remote: string): Promise<void>;
  capabilities(target?: ResolvedTarget): TransportCapabilities;
  describeConnection?(target: ResolvedTarget): Record<string, unknown>;
}
```

`exec` runs a command **in the Android context** of the target. For `adb` that is `adb -s S shell …`;
for `ssh` it is either the same adb call through a tunnel into the container, or `ssh … <attach
command> /system/bin/sh -c '…'`, depending on the route detected for that target (§7.4). Tool modules
compose Android shell commands and never construct transport-specific arguments.

`capabilities(target)` returns what that target supports now, which for `ssh` depends on its route
(§8.15). A tool whose capability is unsupported returns a structured `unsupported_on_transport` error
naming the transport and the capability — never a silent no-op and never a partial result. A target
with no working route returns `transport_unavailable` for every tool, with the missing prerequisites in
the message and in `details.prerequisites`.

### 7.3 The `adb` backend

- One argument builder, `adbArgs(serial, rest)`, used by every call. It is a pure function so a test can
  assert that `-s` is always present (§11.2).
- Every invocation carries a timeout. `scripts/smoke-android-emulator.sh` already wraps its calls in
  `timeout "$ADB_COMMAND_TIMEOUT"` for the same reason; `droidctl` makes it unconditional.
- Binary output uses `exec-out` with a buffer encoding, as `scripts/hil-screenshot-evidence.mjs:67-79`
  does, so a PNG is not corrupted by newline translation.

### 7.4 The `ssh` backend

Split by responsibility: `sshConfig.ts` (settings), `sshDiscovery.ts` (USB network interfaces, and
everything read from this computer behind one injectable interface), `sshCommands.ts` (pure argument
and script builders), `sshPrerequisites.ts` (every message the transport can report), `sshRunner.ts`
(journalled ssh invocations with connection multiplexing), `sshProbe.ts` (the detection order) and
`ssh.ts` (the `Transport`, per-host state and both routes).

Two routes into the container, preferred in this order:

1. **`container-adb`.** An ssh process forwards `127.0.0.1:<free port>` on the desktop to the
   container's adbd, `adb connect` attaches to it, and every operation is delegated to the `adb` backend
   with that serial. The `adb` transport leaves that serial out of its own listing, so the phone has one
   target id. Every tool is supported, with results identical to an ordinary adb target.
2. **`container-attach`.** Commands run as root through the verified attach command:
   `ssh -T -- <user>@<host> "[sudo -n] <attach command> /system/bin/sh -c '<android argv>'"`. The Android
   argv is quoted exactly as `adb shell` quotes it, and the whole line is quoted again for the phone's
   login shell. Tools whose success cannot be verified by an artifact there (input, UI hierarchy,
   assertions, recording) and `forward_webview` are refused; file pushes are verified by the byte count
   the container reports back. The probe sends a known line on stdin through the attach command and
   reads it back; where it does not arrive, tools that send data on stdin are refused on that phone.

The two design rules from §5.3 are implemented rather than left as comments:

1. **Verify by artifact, not by exit code.** An attach candidate counts only when `getprop` run through
   it prints an integer SDK level; a push counts only when `wc -c` inside the container matches; a
   screenshot counts only with a PNG signature; UI-session tools are refused on the attach route.
2. **Prefer a container adb connection.** The attach route is used only when no tunnel reaches `device`.

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
| Input      | `{ transports?: ("adb" \| "ssh")[] }`                                                                                             |
| Output     | `{ targets: [{ targetId, transport, serial, model, apiLevel, state, isEmulator, route?, missingPrerequisites? }] }`               |
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
| Transports | both; an `ssh` target adds `connection` with its route and, per route, the missing prerequisites                                    |

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
| Transports | both; on the `ssh` attach route a blank frame is not detected (§14 Q6)                     |

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
| Transports | `adb`; `ssh` on the container adb route only (§14 Q5)               |

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
| Transports | both                                                                                       |

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
| Transports | `adb`; `ssh` follows `ui_hierarchy`                                                                                                                 |

`assert_not_visible` is the same tool with the sense inverted, and it is not a convenience: the one check
that catches a whole-app crash is a negative assertion on "Something went wrong", because both `App.tsx`
and `PageErrorBoundary.tsx` render that exact title.

### 8.12 `droid_device.prepare_device`

| Field      | Value                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Input      | `{ targetId, waitForBoot?, dismissKeyguard?, stayOn?, disableAnimations?, requireNativeGeometry?, timeoutMs? }`              |
| Output     | `{ bootCompleted, keyguardShowing, stayOn, sizeOverride, densityOverride, resumedActivity, focusedWindow, animationScales }` |
| Transports | both                                                                                                                         |

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

| Tool                                               | `adb` | `ssh`, `container-adb` | `ssh`, `container-attach`                                         |
| -------------------------------------------------- | ----- | ---------------------- | ----------------------------------------------------------------- |
| `droid_target.list_targets`                        | yes   | yes                    | yes                                                               |
| `droid_target.describe_target`                     | yes   | yes                    | yes                                                               |
| `droid_app.install_app`                            | yes   | yes                    | yes, `pm install -S` with the APK on stdin; refused if stdin is not passed through |
| `droid_app.uninstall_app` / `clear_app_data`       | yes   | yes                    | yes                                                               |
| `droid_app.start_app` / `stop_app`                 | yes   | yes                    | yes                                                               |
| `droid_app.write_app_file` / `read_app_file`       | yes   | yes                    | yes; `write_app_file` refused if stdin is not passed through      |
| `droid_input.*`                                    | yes   | yes                    | refused: exit 0 is not evidence of an injected event (§5.3)       |
| `droid_capture.screenshot`                         | yes   | yes                    | yes, PNG signature checked; a blank frame is not detected         |
| `droid_capture.ui_hierarchy`                       | yes   | yes                    | refused: observed to exit 0 without writing a dump (§5.3)         |
| `droid_capture.start_recording` / `stop_recording` | yes   | yes                    | refused: needs a detached adb shell that stops gracefully         |
| `droid_capture.logcat`                             | yes   | yes                    | yes                                                               |
| `droid_assert.*`                                   | yes   | yes                    | refused, follows `ui_hierarchy`                                   |
| `droid_device.prepare_device`                      | yes   | yes                    | yes                                                               |
| `droid_device.run_shell`                           | yes   | yes                    | yes                                                               |
| `droid_device.forward_webview`                     | yes   | yes                    | refused: the DevTools socket is abstract, inside the container    |
| `droid_device.push_file` / `pull_file`             | yes   | yes                    | yes; a push needs stdin and is verified by the reported byte count |

A refusal is `unsupported_on_transport`, and its message names what the `container-adb` route is
missing on that target. `droidctl://reference/transport-support` serves this matrix from the code.

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

**The `ssh` transport is tested against a scripted phone, not hardware.** `tests/support/sshFakes.ts`
answers the ssh, adb and tunnel traffic; `tests/sshTransport.test.ts` walks the detection order stage
by stage and asserts both the reported prerequisite and that later stages did not run;
`tests/sshParity.test.ts` runs the same tool calls through an adb target and through each route and
compares the results; `tests/sshCommands.test.ts` runs the generated scripts and the two-layer quoting
through a real local `sh` with stand-in commands. What these cannot show is how a real container
answers, which is why every assumption from §5.3 is detected at runtime and reported by name (§14).

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
| A container build answers differently from what §5.3 describes.                                   | Nothing is assumed: each step of the detection order in §14 checks its prerequisite and reports it by id with the step that supplies it.                                   |
| The attach route runs a command that quietly does nothing.                                        | The exit-code-is-not-evidence rule in §7.4, plus the requirement that every capture verifies its artifact.                                                                |
| `@modelcontextprotocol/sdk` publishes a breaking major and droidctl inherits droidmind's failure. | A caret range in `droidctl/package.json` plus a committed `package-lock.json`, as `c64scope/package.json` already has. This is precisely the mitigation droidmind lacked. |
| The assertion oracle passes on a page that is visibly broken.                                     | The `requireOnScreen` default in §9.2, which the repository does not have today, plus `assert_not_visible` for the error-boundary title.                                  |

---

## 14. The `ssh` transport: questions and how the implementation answers them

Q1 to Q9 were open questions about the container target. None of them can be settled in CI, so the
implementation settles each one at runtime, on the phone it is connected to, and reports the answer:
as the route in `droid_target.list_targets` and `droid_target.describe_target`, or as a missing
prerequisite with a stable id and the step that supplies it. The full detection order, prerequisite
list and configuration are in `droidctl/README.md` and served as `droidctl://reference/ssh-transport`.

**Q1. Does the phone expose a developer mode?** Detected as the SSH port answering. A refused
connection is `developer-mode` ("enable developer mode, turn on remote (SSH) login and set the developer
password, keep the phone unlocked"); silence or a routing error is `host-unreachable`, which also lists
any USB network interface without an address (`usb-network-address`) or without a derivable phone
address (`usb-network-peer`).

**Q2. What are the connection details?** Defaults: user `defaultuser`, port 22, and the address
`192.168.2.15` when it lies in the subnet of a USB network interface bound to a USB gadget driver, plus
neighbours with a locally administered MAC. All of them can be overridden with `DROIDCTL_SSH_*` or
`ssh.json`, including the address when the phone's USB IP address setting was changed. Authentication
is by key only; a refused key is `ssh-key` with the `ssh-copy-id` command, a changed host key is
`ssh-host-key`. Root for the attach route comes from a uid-0 login, `sudo -n`, or `root@<host>` with the
same key, in that order; none of those is `root-access`, with the one-time key copy from a `devel-su`
shell. `devel-su` itself is never driven, because it needs a password typed at a terminal.

**Q3. How is an APK installed?** On the `container-adb` route by `adb install`, exactly as on a phone.
On the `container-attach` route by `pm install -S <bytes>` with the APK on stdin. The attach command
must pass stdin into the container, which is not documented for every platform helper, so the probe
sends a known line on stdin and reads it back; when it does not come back, `install_app`,
`write_app_file` and `push_file` are refused on that route and say why. Installing through `pm` skips
any launcher integration the platform's own installer adds; `start_app` does not depend on it.

**Q4. Can an adb connection be made into the container?** This is the preferred route. The login probe
reads the phone's `/proc/net/tcp` and `/proc/net/tcp6` without root; a listener on port 5555 is forwarded
over SSH to `127.0.0.1:<free port>` and connected with `adb connect`. A configured
`DROIDCTL_SSH_CONTAINER_ADB` endpoint is tried first, and adb ports the container announces in its own
properties are tried after the attach route finds them. The outcomes are `adb-client` (no adb on the
desktop), `container-adb-disabled` (nothing listening or the connection refused: enable Developer
options, USB debugging and Wireless debugging inside the container), `container-adb-unauthorized`
(accept the prompt; if none appears, add the desktop's adb public key to `/data/misc/adb/adb_keys`),
`ssh-forwarding` and `container-adb-connect`. Wireless debugging that insists on a pairing code is
paired once by hand (README) and then used through the configured endpoint.

**Q5. Does `input` work inside the container?** Over the `container-adb` route it is `adb shell input`,
the same as on a phone. Over the attach route it is refused, together with `ui_hierarchy` and the
assertions: `uiautomator dump` run through an attach command has been reported to exit 0 without writing
a file, and an injected event has no artifact that would prove it landed. The refusal names what the
`container-adb` route is missing on that phone.

**Q6. Does a screenshot capture Android window content?** `screencap -p` runs inside the container on
both routes, so it captures the Android surface. The PNG signature is checked; a blank frame is not
detected, and the attach route's capability note says so.

**Q7. How is a screen recording made?** Only on the `container-adb` route, where `screenrecord` runs in a
detached `adb shell` that `stop_recording` interrupts gracefully. The attach route refuses it, and
compositor capture outside the container is out of scope.

**Q8. Does the app's logging reach the container's logcat?** `logcat` runs inside the container on both
routes, so the app's own tags are read where Android writes them. Whether the WebView console is among
them depends on the app, not on the transport.

**Q9. Can a port be forwarded to the WebView DevTools socket?** On the `container-adb` route by
`adb forward tcp:N localabstract:webview_devtools_remote_<pid>`, which reaches the abstract socket in
the container's namespace because adbd runs there. The attach route refuses `forward_webview`.

**Which container is attached to.** The configured `DROIDCTL_SSH_ATTACH_COMMAND` replaces detection.
Otherwise each executable named `*-attach` in `/usr/bin`, `/usr/sbin`, `/bin` and `/sbin` is tried,
then each LXC container found through its `[lxc monitor] <lxcpath> <name>` process, attached with that
lxcpath, then each container `lxc-ls --running` lists. A candidate counts only when `getprop
ro.build.version.sdk` run through it prints an integer; otherwise the result is `attach-command`, listing
each candidate with its exit code and first line of output.

**Whether the container is running.** The login probe looks for a `system_server` process in the host's
process table, which needs no root. Absent is `android-container`. When `/proc` is mounted so that other
users' processes are hidden, the state is recorded as unknown and detection continues, because the
routes themselves then show whether Android answers. On the attach route a container whose
`sys.boot_completed` is not `1` is listed as `booting`.

**Q10 (not about the ssh transport). Should droidctl own emulator lifecycle?** `scripts/android-emulator.sh` and the CI
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
