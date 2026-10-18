# Callback 8020 diagnostic baseline

Collected 2026-10-14 from the attached handset. The helper is
[Callback Device Probe](../../tools/android-device-probe/README.md); the reusable
[Callback skill](../../.claude/skills/callback-8020/SKILL.md) is also installed as
`$callback-8020` in the local Codex skill directory.

## Existing apps considered

[KeyEvent Display](https://github.com/alt236/KeyEvent-Display---Android) supplies
Android key logging; [CPU Info](https://f-droid.org/en/packages/com.kgurgul.cpuinfo/)
supplies broad hardware/software inventory; [Device Info HW](https://www.deviceinfohw.ru/main/index.html)
offers device reports. Their documented features did not establish an existing
app that correlates physical-key prompts, Android events, WebView/IME events and
foreground/screen interruption. None of these alternatives was installed or
verified compatible with AppSupport in this investigation.

The custom helper supplies that correlation with a persistent 53-step wizard.
It saves each prompt before dispatch and retains user confirmation, retries,
screen/foreground changes, and process-restart recovery. It inventories Android
capabilities and records trusted DOM events on a bundled offline page.

## Measured facts

| Surface       | Observed value                                                                                        | Consequence for C64U Remote                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Host          | Sailfish OS 5.3.0.8, Linux 6.6.89-4k, aarch64                                                         | Inspect host and container separately                                     |
| Android       | AppSupport Android 15/API 35; security patch 2026-05-05                                               | Validate compatibility-layer behavior, not only native Android            |
| ABI           | `arm64-v8a` only                                                                                      | Native libraries must include arm64                                       |
| Display       | 480×640, density 240/DPR 1.5; 320×427 dp, font scale 1, about 60 Hz                                   | Maintain compact-screen text, target and scroll constraints               |
| WebView       | `com.android.webview` 149.0.7827.114                                                                  | Test actual trusted key delivery through this Chromium version            |
| Chromium      | 320×427 screen, 2 touch points, coarse pointer; WebAssembly, Web Audio, IndexedDB and WebGL available | Feature presence is not proof of usable touch or practical performance    |
| Input         | `alien_wayland_keyboard`: keyboard + D-pad + touchscreen; Jolla RemoteKeyboard IME                    | Capture raw, DOM and IME layers together                                  |
| Key inventory | `hasKeys` reported only Home                                                                          | Do not derive keypad support or mappings from advertised keys             |
| Memory        | 4,008,857,600 bytes total; 128 MiB ordinary heap, 256 MiB large memory class; 8 CPUs                  | Do not assume all physical RAM is available to the app                    |
| Storage       | About 37.7 GiB data filesystem; one emulated external app volume                                      | SD-card availability and persisted picker grants remain functional checks |
| Audio         | 48 kHz, 1920 frames per buffer; 25 volume steps                                                       | 40 ms nominal buffer duration, not measured latency                       |
| Sensors       | Twelve listed; gyroscope range/resolution zero                                                        | Inventory may contain placeholder capabilities                            |
| Network       | Android reports LAN Wi-Fi and a host DNS proxy                                                        | Test app DNS, native HTTP, UDP routes and recovery separately             |
| Deployment    | droidctl APK install and explicit activity launch succeeded; Sailfish desktop entry created           | Reuse MCP sideloading and verify the host foreground                      |

Raw initial reports are kept locally in `artifacts/callback-device-probe/`;
droidctl screenshots/logs are under its returned artifact paths. These include
ephemeral addresses and should not be mistaken for a permanent handset profile.
The helper WebView is shorter than the full screen because native wizard controls
occupy part of it; use the Commander WebView's own viewport for product layout tests.

## Evidence limits and next checks

Physical key mappings are **pending a clean guided capture**. The early unguided
capture observed Android Star scan 522 and Menu scan 139, but did not label the
physical legends; those observations cannot establish a complete physical mapping.
Another device process injected D-pad events and replaced the foreground app during
the first wizard run. The observed `deviceId=-1`, `scanCode=0`, `source=0` signature
is now excluded from physical results and has a regression test.

The helper does not establish C64U Remote as entirely ready. Remaining evidence:

- Completed physical/native/DOM key mapping, held-key release and text/IME capture.
- Hang Up, C= Home, flip close/open and process recreation in the actual Remote app,
  including release of held C64 input and restoration of focus.
- Keypad reachability and scrolling throughout Remote at the measured viewport.
- Actual file/folder picker, SD card, persisted permission and export paths.
- App LAN DNS/direct-IP HTTP, discovery, UDP streaming and reconnects on c64u;
  capability gating against u2. The reserved U64 must not be driven.
- Playback, audio focus/background behavior, Live View, latency, and realistic
  collection performance within the measured heap limits.

No Ultimate traffic, audible measurement, full Commander build, or Commander
coverage run was performed for this helper/skill investigation. Product screenshot
refresh is unnecessary because Commander UI was not changed.

The final helper APK was installed and launched on the Callback through droidctl.
Nine wizard unit tests passed; the injection regression was also observed failing
with its fix removed, then passing with the fix restored. Android build and lint
passed (zero lint errors, four reviewed warnings retained), formatting and skill
validation passed, and force-stop/reopen retained the named step and requested
confirmation of the interrupted attempt. The final handset screenshot and JSON
state showed step 1/53, **Left soft key**, armed for a physical press.
