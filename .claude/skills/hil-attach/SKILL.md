---
name: hil-attach
description: >-
  Attach to the C64 Commander app running on the Pixel 4 so its DOM, localStorage and
  Capacitor plugins can be read over CDP, and confirm the rig (phone, c64u) is actually
  healthy first. Use whenever hardware work starts, and again after EVERY `./build
  --install-apk` — a rebuild replaces the process and silently invalidates the port
  forward, so the next eval fails or, worse, reads a stale page. Also use when a CDP
  eval starts timing out or returns values that do not match the screen.
---

# Attach to the app on the Pixel

Load the `droidctl` skill first if you have not — it is the interface for everything here
that isn't CDP itself.

Everything on-device is read through the WebView's CDP socket. The forward is fragile in
one specific way: **it survives nothing**. Re-attach after every install, every force-stop
and every crash.

## Attach

Use `droid_device.forward_webview` (`targetId`, `package`, `localPort: 9333`) — it resolves
the WebView DevTools PID itself and disambiguates between the two installed editions by
`package`, which a manual `adb forward` cannot do (see droidctl skill, "Common mistakes").
`replaceExisting` defaults true, so it does not need a separate `adb forward --remove-all`
first.

Then verify — never assume:

```bash
cd docs/agentic/hil-rc4 && ./campaign/js.sh '(()=>JSON.stringify({route:location.pathname}))()'
```

`campaign/js.sh '<expr>'` is the wrapper around `node scripts/bughunt-cdp.mjs eval`; it
works from any directory. If that harness is missing (fresh clone — `docs/agentic/` is
git-ignored), run `node scripts/bughunt-cdp.mjs eval '<expr>'` from the repo root.

## Before trusting any measurement

```bash
cat /etc/hosts | grep -E "c64u|u64"        # IPs are DHCP-volatile; a stale one looks like a dropout
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 5 \
     -H "X-Password: pwd" http://<c64u>/v1/version
```

Then `droid_target.list_targets` to confirm the phone is actually attached and in state
`device` (not `unauthorized`/offline).

A c64u answering the host in ~15 ms while the app's badge says unhealthy is the app's
main thread starving, not the device. Check from the host before believing the badge.

## Four ways this goes wrong

**Two editions are installed.** `uk.gleissner.c64commander` and `uk.gleissner.c64uremote`
both exist and both open a devtools socket — `droid_device.forward_webview`'s `package`
disambiguates which one you forward to, but the OTHER edition may still be holding an
AudioTrack and streaming in the background, which corrupts any audio measurement. Check
what's alive and stop the one you are not using:

```
droid_device.run_shell(command: ["sh", "-c", "ps -A -o PID,NAME | grep c64"])
droid_app.stop_app(package: "uk.gleissner.c64uremote")
```

**The app is backgrounded.** CDP evals time out (`fatal: timeout Runtime.evaluate`) and
the audio path may be throttled, with no crash or ANR logged to explain it. Check and
foreground it:

```
droid_device.run_shell(command: ["sh", "-c", "dumpsys activity activities | grep -m1 topResumedActivity"])
droid_app.start_app(package: "uk.gleissner.c64commander")
```

**A build just landed.** `./build --skip-tests --install-apk` replaces the process. Sleep
6–8 s after it finishes, then re-attach. An eval against the old forward either fails or
reads nothing useful.

**`droid_target.list_targets` shows the phone offline but `lsusb` (host-level, not a
droidctl concern) shows it physically present.** It has dropped into MIDI USB mode. Only a
physical replug fixes it — ask the user rather than burning time diagnosing.

## Reading state

Prefer specific reads over dumping everything:

```bash
./campaign/js.sh '(()=>{const t=id=>document.querySelector(`[data-testid="${id}"]`);
  return JSON.stringify({track:t("playback-current-track")?.innerText?.replace(/\n/g," ")});})()'
```

The app's REST goes through native CapacitorHttp, so it never appears in CDP Network and a
release build logs nothing to logcat. **The in-app Diagnostics log is the authoritative
source** — read it from `localStorage["c64u_app_logs"]`, newest-first, and filter by a
timestamp watermark taken from the *device* clock (it is hours from the host's, and
clearing the log does not stick because an in-memory cache rewrites it).
