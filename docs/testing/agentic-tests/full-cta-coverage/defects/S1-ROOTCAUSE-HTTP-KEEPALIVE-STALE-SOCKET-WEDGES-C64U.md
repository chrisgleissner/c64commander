# S1-ROOTCAUSE — HTTP keep-alive stale-socket reuse wedges the C64U web/network stack (idle → first request → reset → hard hang)

> ## ❌ SUPERSEDED + REVERTED (2026-06-25) — this theory was WRONG; the keep-alive fix was reverted
> The wedge **recurred on the keep-alive-disabled build** (a single background `GET /v1/info`
> after a ~4-min idle gap), and live `/proc/net/tcp` inspection confirmed the app was **not**
> reusing pooled connections — so **connection reuse is NOT the cause**. The `http.keepAlive=false`
> change was confirmed active but **ineffective**, and was **reverted** (commit revert of the
> keep-alive fix). The real, evidence-backed root cause is a **C64U firmware defect**: see
> **[[S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT]]** and `docs/c64/c64u-firmware-tcp-wedge-report.md`.
> The analysis below is retained for history but its conclusion (stale connection reuse) is incorrect.


- ID: `S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U`
- Parent: [[S1-DISKS-MOUNT-EJECT-RESETS-C64U]] (this is the long-sought root cause + fix)
- Severity: **S1** (catastrophic for the device: requires manual power-cycle to recover)
- Priority: P0
- Status: **ROOT CAUSE IDENTIFIED + FIX IMPLEMENTED**; on-device verification of the fixed build pending
- Product area: native HTTP transport (CapacitorHttp / Android `HttpURLConnection`) → all C64U REST
- Build identity at reproduction: `0.8.9-b8687`, versionCode 2047, APK SHA-256 `f052b0b1f6d1ddbc9ef0a9ff2627be3fba1a1a72cf38d77b1c992290e86dd593`
- Git SHA at reproduction: `b86877f43589954a9d415f0dfe8b2b7debb890b4`
- Pixel 4: `9B081FFAZ001WX`; Target: `c64u` 192.168.1.167, fw 1.1.0
- First reproduced this session UTC: 2026-06-25T17:54:59Z (device-local); device required a **manual power-cycle by the user** to recover.

## Symptom

After a period of connection idle, the **first** C64U REST request (a Drive mount, a config write, an eject) fails with `Connection reset` / HTTP 404, and the C64U's web + network stack then goes **fully unreachable (HTTP 000)** while the device stays pingable (ICMP 0% loss). It does **not** self-heal — it stays down until the device is power-cycled. The user confirms this has recurred for **months** and that "some activities performed by C64 Commander trigger an entire network degradation on the c64u that won't heal until a manual device restart."

## This-session reproduction (full evidence)

Artifact root: `c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/`

1. Healthy baseline proven: app `C64U ●` green, device `c64u`, fw `1.1.0`, Drive A ON / `No disk mounted` / status OK, device `/v1/drives errors:[]`. c64u `/v1/info` = HTTP 403/~8 ms (unauth) and 200 (auth `pwd`).
2. Opened Drive A mount sheet (touch via DroidMind). Sheet listed `/USB2/test-data/d64/` with `Boulder Dash 2.d64`, `Frogger.d64`, `interface-harness.d64`. **FTP readback confirms `Boulder Dash 2.d64` (174848 bytes) genuinely exists.**
3. `42 s` of idle elapsed (no requests).
4. Tapped **Mount Boulder Dash 2.d64**. App issued exactly `PUT /v1/drives/a:mount?image=%2FUSB2%2Ftest-data%2Fd64%2FBoulder%20Dash%202.d64&type=d64&mode=readonly`. Logcat:
   `C64U_HTTP_FAILURE {... "idleMs":42103,"wasIdle":true,"durationMs":54,"error":"HTTP 404"}`
5. App correctly surfaced the failure: Drive A status "HTTP 404", badge `C64U ◆ 2` ("system degraded, 2 problems"). No app crash; per-drive status later recovered to OK on poll (the S2 fix works).
6. Within ~90 s the device web stack went to **HTTP 000** across 10+ probes (`/` and `/v1/info`), while `ping c64u` = 3/3, 0% loss, 0.46 ms. Stayed down until **user power-cycled the device**.

Evidence: `screenshots/baseline-0{1,2}-*.png`, `s1-after-mount.png`, `s1-c64u-down-after-mount.png`; `logs/logcat/s1-idle-path.log`; `logs/commands/s1-c64u-health-monitor.log`.

## Pattern across months (docs/agentic/C64U_INCIDENTS.md)

The same **idle → first mutating request → `Connection reset` → full dropout** signature recurs repeatedly and was each time written off as "device-side fragility / c64u-flakiness":

- **#84 (2026-06-15):** healthy → `Drive Type=1571` PUT OK → **47 s idle** → `Drive Type=1581` PUT → `sun.net.ConnectionResetException` (`wasIdle:true, idleMs:46650`) → device fully unreachable. "same pattern as #64-continuation (idle → first config PUT → Connection reset → full dropout)."
- **#64-cont (2026-06-14):** recovered → ~2 min healthy idle → **first** config PUT (`LED Strip Settings`) → `SocketException: Connection reset` → fully unreachable. "A single paced PUT dropping a freshly-recovered device."
- Original S1 catastrophic eject: `idleMs=197050, wasIdle=true`.

The `sun.net.*` / `java.net.HttpURLConnection` exceptions are the fingerprint of Android's `HttpURLConnection` (okhttp-backed) connection pool.

## Root cause

Every C64U REST call goes through CapacitorHttp → Android's okhttp-backed **`HttpURLConnection`**, which **pools idle TCP sockets for reuse** (keep-alive, on by default). The C64U's tiny embedded (lwIP) web server **silently drops its side of an idle socket**. When the app then **reuses that pooled, half-dead socket for the first request after an idle gap**, the send raises `Connection reset` and — because the embedded server is resource-constrained — the malformed/half-open exchange **wedges its REST/network stack hard** (HTTP 000, ping still up), recoverable only by power-cycle.

Why the prior `Connection: close` mitigation never worked: it was set as a `fetch()` request header in JS, but **`Connection` is a Fetch-spec _forbidden header name_** — the WebView/Capacitor `Headers` normalization **strips it before CapacitorHttp's native client receives it**. Proof: the plugin's logged request `methodData` contains only `{"content-type":...,"x-password":...}` — **no `Connection` header**. So keep-alive was never actually disabled; the idle-reset kept reproducing on builds that "had" the fix.

This is **not a recent regression** — the request shape is byte-identical to builds going back months (confirmed by `git diff cf84d8e5..HEAD -- src/lib/c64api.ts`: only a timeout bump + the ineffective JS `Connection: close`). The discriminating variable is always **`wasIdle`**, not the request content.

## Fix (implemented this session)

`android/.../MainActivity.kt` → `disableHttpConnectionReuse()`, called first in `onCreate()` (before any device REST call):

```kotlin
System.setProperty("http.keepAlive", "false")
```

Android's okhttp `ConnectionPool` reads `http.keepAlive` once at init; `false` → `maxIdleConnections=0`, i.e. **no socket pooling**. Every request uses a fresh connection, so a stale idle socket is never reused. `onCreate` runs well before the WebView issues any REST call, so the property is set in time.

`src/lib/c64api.ts` → `buildTransportHeaders()` comment updated to record that the JS `Connection: close` is stripped on native and that the JVM-level keep-alive disable is the effective control.

Regression tests: `MainActivityTest.kt` — `disableHttpConnectionReuseSetsKeepAliveFalseViaInjectedSetter`, `disableHttpConnectionReuseDefaultSetsSystemProperty`.

Trade-off: one extra TCP handshake per request (~0.5 ms on the LAN); the device tolerates fresh connections fine — it is stale-socket *reuse* that kills it. Request rate is low (drives poll 30–60 s), so no connection-churn overload (distinct from the #31 GET-burst overload, which is a separate concern).

## Verification RESULTS (on-device, fixed build) — PASS

Fixed APK: `0.8.9-b8687`, SHA-256 `2ffb16450416dd08ff8994f39040e0dee7fd1b5600167206b12cf66c6c33072f`. Kotlin unit tests `MainActivityTest` PASS (BUILD SUCCESSFUL, exit 0), incl. the two new keep-alive regression tests.

**A/B on-device proof (same Pixel, same Wi-Fi, same c64u, same exact action — only keep-alive differs):**

| | Unfixed (`f052b0b1`, keep-alive ON) | Fixed (`2ffb1645`, keep-alive OFF) |
|---|---|---|
| Idle before action | 42 s | 50 s (mount) / ~6 min (eject) |
| Drive A mount result | **HTTP 404** (54 ms) | **HTTP 200, 780 ms, disk mounted** (device `image_file` set) |
| c64u after action | **HTTP 000, hung, needed manual power-cycle** | **403/8 ms healthy across 15 probes** |
| Eject result | (never reached — device already down) | **HTTP 200, 147 ms, ejected** (`image_file:''`), c64u 403/8 ms across 15 probes |
| `Connection reset` / `C64U_HTTP_FAILURE` | yes | **none** |

TCP-level confirmation: with the fix, the app opens **fresh** TCP connections per request (rotating source ports), never reusing one persistent ESTABLISHED socket — i.e. keep-alive is genuinely off. Transient Pixel↔c64u Wi-Fi SYN-loss now produces a brief, **self-healing** "degraded" badge (recovered to "healthy" in <40 s, no power-cycle), instead of the prior wedge.

Status: **FIXED + VERIFIED ON-DEVICE.** The complete original catastrophic flow (idle → mount → idle → eject) that hard-wedged the unfixed build now runs cleanly with the device healthy throughout. Drive A left in clean baseline (No disk mounted / OK).

Evidence: `screenshots/fix-{01-launch,mount-sheet,after-mount-ok,after-eject}.png`; `logs/commands/fix-verify-health.log`; logcat `a:mount ...780ms` + `a:remove ...147ms` with zero failures.

### Not yet separately re-run
An idle config-write (the #84 `Drive Type` path) on the fixed build — same root cause and transport, expected to be covered by the keep-alive fix, but a dedicated idle config-write A/B would add breadth.

## Residual uncertainty

The CPU-Speed-write dropout (C64U_INCIDENTS 2026-06-12) is a **separate, genuine firmware issue** (the firmware drops the network while applying the clock change) and is NOT addressed by this fix — it is already mitigated app-side by single-item sequential writes + a warning path. This fix targets the dominant, months-long **idle-stale-socket** dropout class.
