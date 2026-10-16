# Device Probe

A standalone Android helper for investigating an Android environment on a device
with a physical keypad. It records Android and WebView behavior without modifying
any other app.
The APK uses public Android APIs, a bundled offline HTML page, no Internet permission,
and no Google services. Reports remain in its private app directory.

## Why a helper

Existing apps were researched before implementation:

- [KeyEvent Display](https://github.com/alt236/KeyEvent-Display---Android) captures
  Android key events and exports logs, but does not inventory the phone or correlate
  physical-key prompts with WebView/IME behavior. Kernel monitoring requires root.
- [CPU Info](https://f-droid.org/en/packages/com.kgurgul.cpuinfo/) covers CPU, GPU,
  memory, storage, display, sensors, battery, Android and audio information. Its
  published feature list does not provide the required physical-key/DOM wizard.
- [Device Info HW](https://www.deviceinfohw.ru/main/index.html) offers device reports
  in its Pro edition. No documented physical-key plus DOM/IME wizard was found.

These are useful partial alternatives. None was installed or claimed compatible
with this handset. The custom helper addresses the specific missing correlation.

## Build

From the repository root, with a valid JDK and Android SDK configured:

```bash
./android/gradlew -p tools/android-device-probe :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
```

Set `ANDROID_HOME` or this project's ignored `local.properties` to your SDK.
The APK is `app/build/outputs/apk/debug/app-debug.apk` under this directory.
Version name uses `scripts/resolve-build-version.mjs`, matching the repository tag
and commit. The diagnostic app is debuggable so droidctl can retrieve private reports
and forward its WebView. This is a development tool, not a production distribution.

AGP and compile/target SDK are aligned with the repository's Android build (9.3.0 / 36).
Lint's newer-version advisories remain visible. The JavaScript-enabled warning is
expected for a WebView diagnostic: only the bundled page loads, external navigation
is blocked, CSP blocks external content, and the app has no Internet permission.
Legacy display/inset APIs retain API 26 compatibility; their deprecation messages
remain visible. Gradle's `Configuration.setVisible` warning originates in AGP.
No warning baseline or suppression is used.

## Install and launch

Use the droidctl MCP tools, selecting the target device from `list_targets`.

- Package: `uk.gleissner.deviceprobe`
- Activity: `.ProbeActivity`
- `droid_app.install_app`: local APK path, exact package and target.
- `droid_app.start_app`: exact package, activity and target.

Confirm the host system's foreground window as well as Android's resumed activity.
Never restart the device or its Android environment to repair a test.

## Guided capture

The first 24 steps follow the physical front keypad **top to bottom, left to right**:

| Row              | Keys                                                |
| ---------------- | --------------------------------------------------- |
| Upper controls   | Left soft · Up · Right soft                         |
| Call/navigation  | Green Call · Left · Centre/OK · Right · Red Hang Up |
| Lower navigation | Down                                                |
| Function keys    | F1 · Special key · F3                                        |
| Digits           | 1 · 2 · 3, then 4 · 5 · 6, then 7 · 8 · 9           |
| Bottom           | * · 0 · #                                           |

The app names and highlights the requested key. Press it once and release. Review
the received key, then press **OK** to advance, **1** to retry, or **2** to report
no event. A wrong press is retained as evidence until you retry; the app cannot
identify the physical legend by guessing from the observed code.

If a key produces nothing, **hold 0**, release, then confirm with OK. The escape's
early events remain in the trace; a no-event result does not attribute them to the
requested key. The three visible controls are also available by touch, each at
least 48 dp high. Confirmation keys are consumed as wizard controls and cannot
become the next key's capture. The native prompt uses 18 sp; status uses 16 sp.

For **Hang Up, press briefly**. The screen may go dark before Android receives a
key. Wake normally and reopen Device Probe; the saved attempt asks for confirmation.
The **special key** may send you Home. Reopen and confirm or retry. The wizard also preserves a
pending attempt after process death, missing key-up, or foreground loss. It does not
disable system power/lock behavior or install a background key interceptor.

After completing the wizard, **Again** starts a new capture after confirmation and
keeps the previous event log.

A second 24-key pass lets Android/Chromium handle the events normally and records
trusted DOM keys, focus, beforeinput/input and composition. Two held-direction steps
and three text steps follow. WebView Back/Call can leave the app in this pass; reopen
it and confirm the interruption. There are 53 steps in this version.

Only use non-sensitive test text. By default, captures record only the length of field values, composition data and typed characters. Launch with the boolean intent extra `captureText` to record the text itself (`am start -n uk.gleissner.deviceprobe/.ProbeActivity --ez captureText true`). The event log stops growing at 4 MiB and the screen then reports a storage problem. WebView debugging is enabled only in a debuggable build. Keep other device
automation paused: injected keys and concurrent APK installs invalidate physical
mapping evidence. The specific observed injection signature (`deviceId=-1`,
`scanCode=0`, `source=0`) is logged and excluded; this is not a general detector.

## Reports

Use `droid_app.read_app_file` for this package, with the following `relativePath`:

| File             | Contents                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory.json` | Build/ABI, display/configuration, features, input devices/key claims/IME, CPU/RAM/heap, storage and picker availability, sensor metadata, audio routes/buffers, codecs, networks, power and WebView version |
| `events.jsonl`   | Append-only session/sequence/time, expected physical key, mode/phase, Android and DOM events, touch events, screen/focus/lifecycle changes, retry/confirmation/results                                      |
| `wizard.json`    | Current persisted step, prompt, phase, result and session                                                                                                                                                   |

The inventory is refreshed at launch. Events survive upgrades and process restarts;
each session is identified separately. Queries denied by Android are logged with a
stack trace and represented as errors, rather than false absence. SharedPreferences
state is committed before key dispatch, report snapshots use atomic writes, and each
event is flushed to disk. This favors interruption resilience over benchmark speed:
the trace is not a measurement of the uninstrumented app's input latency.

Feature flags, advertised keys, codecs, sensors, buffer sizes and picker intents are
**inventory**, not functional certification. This version does not record live
sensor samples, audio output/latency, camera images, network throughput, or host
evdev events. Keys consumed by the host system are evidenced by the prompt/interruption
and user confirmation; their Linux keycodes need a separate host capture.

## Validation scope

The wizard unit tests cover order, attribution, confirmation isolation, missing
release, screen-off/foreground interruption, DOM-only keys, repeats, text steps,
completion and the observed injection signature. Build and Android lint validate
the standalone project. Hardware screenshots and report extraction validate the
device path. Collecting inventory does not certify readiness of any other app.
