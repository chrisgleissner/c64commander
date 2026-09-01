---
name: droidctl
description: >-
  MANDATORY entry point for ALL Android device automation on this project — install/
  uninstall/launch/stop an app, run a shell command, screenshot, logcat, tap/swipe, read
  the UI hierarchy, push/pull files, forward the WebView DevTools port. Raw `adb` must
  never be used directly for anything droidctl already covers. Load this BEFORE reaching
  for Bash + `adb`, whenever a task touches the Pixel 4 or an Android emulator — including
  "install the APK", "uninstall the app", "check logcat", "tap this button", "take a
  screenshot", "reset app data".
---

# droidctl is the interface — not adb

`droidctl` is the MCP server (`droidctl/README.md`) that replaced the third-party device
server (PR #400). It exists specifically so nobody needs to hand-roll `adb -s <serial> ...`
invocations. **If droidctl exposes an operation, use it — never drop to raw `adb`/`ssh` out of
habit**, even when the raw command would "obviously work." Two concrete reasons this matters,
not just style:

- **Wrong-device targeting.** Every droidctl tool takes an explicit `targetId` from
  `droid_target.list_targets` and refuses to guess — "make wrong-device targeting impossible
  by construction" is droidctl's own stated design goal. A hand-typed `adb` command with no
  `-s <serial>`, or the wrong one, can silently hit an emulator or a different phone when more
  than one target is attached.
- **It's the thing being asked for.** The user is standardizing this project's device
  automation on droidctl on purpose. Falling back to `adb` even when the *outcome* is
  identical defeats that.

## First step, always

```
droid_target.list_targets           # every call needs a targetId; there is no default/fallback
```

Pick the target whose `serial` matches the Pixel 4 in use (prefix `9B0` per AGENTS.md). A
second transport is designed but not yet implemented and has no hardware to test against —
see "What droidctl cannot do" below.

## adb → droidctl translation table

| Instead of...                                          | Use...                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `adb install [-r] [-d] [-t] [-g] app.apk`                 | `droid_app.install_app` (`reinstall`, `allowDowngrade`, `allowTestPackages`, `grantPermissions`) |
| `adb uninstall <pkg>`                                     | `droid_app.uninstall_app` (`tolerateMissing`)                             |
| `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1` | `droid_app.start_app` (`viaLauncherIntent: true` for the monkey behavior; default is `am start -W`, which also reports the measured start time) |
| `adb shell am force-stop <pkg>`                            | `droid_app.stop_app`                                                       |
| `adb shell pm clear <pkg>`                                 | `droid_app.clear_app_data`                                                 |
| `adb shell input tap x y`                                  | `droid_input.tap`                                                          |
| `adb shell input swipe x1 y1 x2 y2 [dur]`                  | `droid_input.swipe`                                                        |
| `adb shell input text "..."`                               | `droid_input.type_text`                                                    |
| `adb shell input keyevent N`                                | `droid_input.press_key`                                                    |
| `adb exec-out screencap -p > out.png`                       | `droid_capture.screenshot`                                                 |
| `adb shell uiautomator dump`                                | `droid_capture.ui_hierarchy`                                               |
| `adb logcat [-d] [-c] [-s TAG:I]`                            | `droid_capture.logcat` (`mode: "dump"\|"clear"`, `filters`, `tags`)        |
| `adb push local remote`                                     | `droid_device.push_file`                                                   |
| `adb pull remote local`                                     | `droid_device.pull_file`                                                   |
| `adb forward tcp:PORT localabstract:webview_devtools_remote_PID` (with manual PID lookup) | `droid_device.forward_webview` (resolves the PID itself, disambiguates between two installed editions by `package`) |
| any other `adb shell <cmd>`                                  | `droid_device.run_shell` (**this is still droidctl**, not a raw-adb escape hatch — it's the general-purpose tool for anything without a dedicated one) |
| `adb devices -l`                                              | `droid_target.list_targets`                                                |
| screen size / density override check                          | `droid_target.describe_target`                                             |

`droid_device.run_shell` takes `command` as an **argument vector** (`["sh", "-c", "..."]`),
not a shell string — this is deliberate (avoids shell-injection footguns), not a bug to work
around by falling back to `Bash` + `adb`.

## Common mistakes (both hit in one session)

- Calling a droidctl tool with a shell-string `command` instead of an array — fix the array,
  don't switch to `adb`.
- Assuming `allowDowngrade` (`-d`, either via raw adb or `install_app`) gets past
  `INSTALL_FAILED_VERSION_DOWNGRADE` on a normal phone. It doesn't — the OS only honors that
  flag when the *device* itself is a `userdebug`/`eng` build, not a retail `user` build, no
  matter which client sets it. The correct sequence there is `droid_app.uninstall_app`
  (`tolerateMissing: true`) then `droid_app.install_app` — same tools, just two calls.
- Two application ids can be installed at once (`uk.gleissner.c64commander` and
  `uk.gleissner.c64uremote`, same `MainActivity` class) and either can steal foreground focus.
  Every droidctl `droid_app`/`droid_device.forward_webview` call takes an explicit `package`
  for exactly this reason — pass the one you mean, don't assume "the app" is unambiguous.

## Output size

`droid_device.run_shell` and `droid_capture.logcat` both cap output (`maxBytes`, default 32
MiB) but that is still far larger than a single MCP tool result should return — a verbose
command like `dumpsys wifi` unfiltered will get its overflow saved to a file by the harness
rather than dumped inline. Narrow with shell filters (`grep`, `-t <lines>`, `filters`/`tags`
on `logcat`) before running, not after hitting the limit.

## What droidctl cannot do (yet) — these are the legitimate exceptions

- **CDP JavaScript evaluation inside the app's WebView.** droidctl forwards the DevTools port
  (`droid_device.forward_webview`); it does not itself speak the CDP `Runtime.evaluate`
  protocol. Use `node scripts/bughunt-cdp.mjs eval '<expr>'` for that — see the `hil-attach`
  skill. This is the one place raw tooling outside droidctl is expected, not a loophole.
- **A second, non-USB device transport.** droidctl's own design (`docs/plans/droidctl/spec.md`
  §5.3/7.4) describes a transport reached over SSH rather than `adb`, but it is a
  designed-but-unimplemented stub and no such device exists on this bench. There is nothing to
  fall back to raw `ssh` FOR — that work is simply not runnable yet, the same way the keypad
  handset isn't (AGENTS.md, "The hardware that exists"). Do not hand-write raw `ssh` commands
  preemptively for it.
- **Locally-generated, git-ignored scratch scripts** under `docs/agentic/` (e.g.
  `hil-rc4/taptid.sh`) predate droidctl and still shell out to raw `adb input tap/swipe`
  internally. They're not shipped/versioned guidance — don't treat their existence as
  precedent for writing new raw-adb code, and prefer `droid_input.tap`/`swipe` directly when
  starting something new that doesn't need `taptid.sh`'s specific hit-test-before-tap logic.

Related skills: `hil-attach` (CDP attach + rig health), `drive-app-ui` (reliable on-device UI
interaction combining CDP hit-testing with input).
