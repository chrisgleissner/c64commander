# S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT — c64u TCP stack permanently wedges on a request after idle (device firmware defect)

- Severity: **S1** (device requires manual power-cycle to recover)
- Status: **ROOT-CAUSED → device firmware defect; app can mitigate trigger frequency but cannot cure**
- Supersedes the connection-reuse theory in [[S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U]] (that fix is confirmed *active* but *insufficient* — see below)
- Pixel 4 `9B081FFAZ001WX` → c64u `192.168.1.167` fw 1.1.0

## Symptom (recurred 2026-06-25 on the keep-alive-fixed build)

The c64u's **entire TCP stack dies** — HTTP `:80`, FTP `:21`, Telnet `:23` all return connection-refused / time out (HTTP 000), while **ICMP ping stays 0% loss**. It does **not** recover; the user must **power-cycle the device**.

Forensic onset (Pixel logcat, survives the c64u restart):
- **19:40:41** the **first `GET /v1/info` background health poll after a ~4-min idle gap** (`idleMs:240169, wasIdle:true`) → **"Connection reset"**, and every subsequent request failed (HTTP 000) until manual restart.
- It was a **plain background poll**, not a mount/config-write/user action. WiFi was healthy throughout (rssi −63, connected, screen on).
- The ~4-min gap exists because the app **pauses interval polling when backgrounded** (`refetchInterval` returns false when `screenActive = !document.hidden` is false; `refetchOnWindowFocus` is `false`). When the app returned to the foreground, the first resumed poll wedged the device.

## Why it is a device firmware defect (not an app bug)

**A client cannot permanently wedge a well-behaved server's TCP stack with normal HTTP requests.** The app sends ordinary `GET /v1/info` / `GET /v1/drives`; the c64u's TCP stack dies until power-cycle. That is, by definition, a defect in the c64u firmware's embedded (lwIP) TCP stack — a resource exhaustion or deadlock in connection handling. The app can only avoid *triggering* it.

## Controlled experiments (this session) — what was ruled in / out

| Hypothesis | Test | Result |
|---|---|---|
| Client connection **reuse** (stale pooled socket) | Live `/proc/net/tcp` sampling of the running app | **Ruled out** — keep-alive is OFF; connections are brief, never pooled (no persistent ESTABLISHED between 60s polls). Both keep-alive on (months of prior incidents) and off (this session) wedge. |
| **Fresh** unauthenticated request after idle | Clean wired host: warm → 5 min idle (ICMP only) → fresh `GET /v1/info` (403) | **Did not wedge** (1 trial) |
| **Fresh authenticated** request after idle | Clean wired host: warm → 4 min idle → authenticated `GET /v1/info`+`/v1/drives` (200) | **Did not wedge** (1 trial) |
| Connection **bursts / volume** | Prior controlled experiment (c64u-flakiness memory) | Self-recovers from ≥24–80 concurrent; **not** the cause |

The clean-host trials not wedging in 1–2 attempts is consistent with a **low-probability** firmware fault: the app generates *many* request-after-idle events over a session (every background→foreground cycle pauses then resumes polling), so it eventually hits the fault; two host trials usually won't.

## Root cause (high confidence)

**C64U firmware defect:** its embedded TCP/IP stack intermittently and permanently wedges (all TCP services dead, ICMP alive, recover only on power-cycle) when handling a connection after the network has been idle for minutes. Probability is low per event but rises with idle-gap length; the app accumulates many such events. This matches the months-long idle→request→dropout pattern in `docs/agentic/C64U_INCIDENTS.md` (#64-cont, #84, original S1).

## Why the earlier keep-alive fix did not solve it

`http.keepAlive=false` is confirmed *active* (no connection pooling observed), but the wedge is **not** caused by connection reuse, so disabling reuse cannot prevent it. The keep-alive setting is a wash for this defect (both on and off wedge). It also *increases* connection churn (a fresh TCP connection per request), which is the wrong direction for an embedded TCP-stack resource issue — so it should be reconsidered/reverted.

## Fix

**Primary (real) fix — device firmware:** report upstream to 1541ultimate (the c64u/Ultimate firmware). The embedded TCP stack must not permanently wedge when accepting a connection after idle. Evidence package: this file + `logs/commands/host-idle-reconnect{,-AUTH}-experiment.log` + `logs/logcat/wedge2-full-dump.log`.

**App-side mitigations (reduce trigger frequency only — cannot cure a firmware defect):**
1. Revert the ineffective keep-alive disable (restores connection reuse → fewer connections → less TCP-stack pressure; removes an unvalidated change that did not help).
2. Minimize request-after-idle events and overall connection count: keep the device connection warm while the app is foreground/visible (it survived ~1.5 h of steady 60s polling; the wedge came only after a multi-minute polling pause), coalesce/dedupe polls, and never open concurrent connections to the single-threaded server.
3. Keep the existing graceful degradation (the app already flips to "degraded/offline" with accurate errors and no crash when the device wedges).

## Firmware research + workaround (2026-06-25)

The 3.14x Ultimate firmware (which u64 runs, unaffected) already fixed this class; c64u 1.1.0
lacks it. Confirmed from `GideonZ/1541ultimate` commits: `57c7c8a6a` (server socket `SO_RCVTIMEO`
mis-set — comment **"bug in lwip; this is just used directly as a tick value"**), `ddd28dd17` /
`fdb521a5b` (add send-timeouts + only-close-valid-socket so stuck sends/connections are reclaimed —
matches #700 "Send-Q grows, connection stuck"), `802d6143b` (split Rx/Tx buffers to avoid Tx
starvation), `40d3901e1` + LwIP 2.x migration. Field issues: #700 (idle socket unresponsive), #364
(repeated telnet/FTP cycles fail until power-cycle), #585 (REST POST temp-file leak). Full report:
`docs/c64/c64u-firmware-tcp-wedge-report.md`.

**Workaround implemented:** the app now (a) **reuses one warm connection** rather than churning a
fresh one per request (the `http.keepAlive=false` change that did the opposite was reverted), and
(b) **serializes native direct-device REST requests** through a single-connection lane
(`serializeNativeDeviceRequest` in `src/lib/c64api.ts`) so it never opens concurrent connections to
the firmware's single Rx/Tx buffer / single-threaded network task (avoids Tx starvation + peak-socket
pressure). Regression tests in `tests/unit/c64api.branches.test.ts`. This **reduces** the trigger
surface; it does not cure the firmware defect.

## Honest limitation

Because any request after idle can trigger the low-probability firmware fault, and the app must reconnect when the user returns to it, the app **cannot guarantee** the c64u never wedges. The mitigations reduce frequency; the cure is a firmware fix.
