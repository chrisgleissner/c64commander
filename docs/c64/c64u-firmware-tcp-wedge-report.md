# C64 Ultimate firmware bug report — embedded TCP stack permanently wedges on a connection after idle

**For upstream (1541ultimate / Ultimate-64 / Ultimate-II firmware).**

## Summary

On a C64 Ultimate (`c64u`, firmware **1.1.0**), the device's embedded HTTP/network stack
**intermittently and permanently stops accepting TCP connections** — HTTP (`:80`), FTP (`:21`),
and Telnet (`:23`) all become unreachable (connection refused / reset / timeout), while the
device **still responds to ICMP ping with 0% loss**. The condition **does not self-recover**; a
**manual power-cycle** is required. It is strongly correlated with the **first network request
after the device has had no TCP connections for several minutes** (an idle period), and the
probability rises with idle-gap length.

This is consistent with a **resource exhaustion or deadlock in the embedded TCP/IP stack**
(e.g. lwIP TCP PCB / netconn / memory-pool exhaustion or a connection-accept deadlock): ICMP is
serviced at a lower layer and keeps working, but no new TCP connection can be established.

## Environment

- Device: C64 Ultimate, hostname `c64u`, `192.168.1.167`, firmware `1.1.0`.
- Client: an Android app (C64 Commander) issuing ordinary REST calls (`GET /v1/info`,
  `GET /v1/drives`, `PUT /v1/drives/...:mount`, `PUT /v1/configs/...`) with `x-password` auth.
- Network: shared LAN/Wi-Fi; the controller and a separate wired host both on `192.168.1.0/24`.

## Observed signature (one representative occurrence)

- Device healthy; controller idle (no TCP to the device) for ~4 minutes.
- First request on resume: `GET /v1/info` → **TCP "Connection reset"** at the client.
- Immediately after: HTTP/FTP/Telnet all unreachable (HTTP `000`), persisting indefinitely.
- `ping` to the device: **0% packet loss throughout**.
- Recovered only by **power-cycling the device**.

Recurs across months of testing with the same idle→first-request→permanent-dropout pattern, on
a variety of request types (mount, config write, plain info/drives polls).

## What we ruled out (client side)

A client cannot permanently wedge a healthy server's TCP stack with normal HTTP requests, so we
confirmed the trigger is not a client misbehavior:

- **HTTP keep-alive / connection reuse is not the cause.** The failure reproduces with client
  connection pooling both enabled and disabled (`Connection: close` / `http.keepAlive=false`).
- **Request volume / concurrency is not the cause.** The server sheds excessive concurrent
  connections and self-recovers within milliseconds (tested to dozens of concurrent connections
  on a freshly restarted device).
- **A single fresh request after idle is usually fine.** From a clean wired host, warming the
  device then idling 4–5 minutes then issuing a single fresh request (both unauthenticated `403`
  and authenticated `200`) did **not** wedge it in controlled trials — consistent with a
  **low-probability** fault that a busy controller hits over many idle→reconnect cycles.

## Confirmed firmware cause (from 1541ultimate fix commits the 3.14x line already has)

The Ultimate-64 (3.14x, e.g. u64 `3.14e`) firmware **already fixed this class**; the C64 Ultimate
`c64u` 1.1.0 build does **not** have these fixes. Same controller app → u64 (patched) is unaffected,
c64u (1.1.0) wedges. The relevant `GideonZ/1541ultimate` commits and what they reveal:

1. **`57c7c8a6a` "Delays in socket polling set correctly for LWIP 2.1"** — the server sockets set
   `SO_RCVTIMEO` to `tv_sec = 20 / 23` with the comment **"bug in lwip; this is just used directly
   as a tick value"**. So the receive timeout intended as *seconds* was being applied as ~20–23
   *ticks* (≈ ms) — i.e. the socket poll/timeout was grossly mis-set. Fixed to explicit short values
   (`network_target` 40 ms, `ftpd` 100 ms, `socket_gui` 200 ms). On the unfixed build the server's
   socket servicing is wrong, so idle/slow sockets stall.
2. **`ddd28dd17` / `fdb521a5b` "socket timeout settings for FTP/DMA + control socket timeouts"** —
   adds `SO_SNDTIMEO` (5 s) and only closes valid sockets. Before this, a **stuck send never times
   out** (matches #700: the connection stays ESTABLISHED, Send-Q grows, no response) and stuck
   connections are never cleaned up → they accumulate.
3. **`802d6143b` "Split Rx and Tx buffers to WiFi module to avoid Tx starvation"** — the WiFi link
   used a single shared buffer, so **concurrent traffic starves the transmit path**.
4. **`40d3901e1` "LwIP configuration and RMII bug fixed => no more disconnects"** + the broader
   **migration to LwIP 2.x** — config-level networking fixes that eliminate disconnects.

Net: on `c64u` 1.1.0 the embedded stack mis-services sockets, never times out stuck sends, starves
Tx under concurrency, and never reclaims stuck connections — so connection **stress** (concurrency
→ Tx starvation; churn/cycling → exhaustion, cf. #364 "repeated telnet/FTP cycles fail until
power-cycle"; an idle/slow socket → stuck, cf. #700) drives the single-threaded network task into a
state where the whole TCP stack stops accepting connections until a power-cycle. This is consistent
with the on-device evidence (idle → first request → all TCP dead, ICMP alive).

## Requested fix (device)

Port the 3.14x networking fixes (the four commits above + LwIP 2.x) to the **C64 Ultimate (1.x)**
firmware so `c64u` gets correct socket timeouts/polling, send-timeouts, split Tx/Rx buffers, and
stuck-connection cleanup.

## App-side workaround (this controller) — reduce connection stress on the unfixed firmware

The app cannot cure the firmware, but it can stop *triggering* it by minimising connection stress —
directly mirroring what the firmware fixes address:

1. **Reuse one warm connection; do not churn** (a fresh TCP connection per request cycles the
   firmware's connection handling — cf. #364). The earlier `http.keepAlive=false` change did the
   *opposite* (max churn) and was reverted.
2. **Never open concurrent connections to the device** — serialize device REST requests so at most
   one connection is in flight, avoiding Tx starvation (`802d6143b`) and peak-socket pressure on the
   single-threaded stack.
3. **Refresh (don't reuse) a connection after a failure or long idle** — a reset/timed-out or
   long-idle socket may be stuck on the device (no firmware send-timeout to reclaim it).
4. **Keep requests short and bounded** so a stuck request doesn't hold a device connection open.

## Requested fix

The embedded TCP/IP + HTTP stack must remain able to accept new TCP connections after arbitrary
idle periods, and must not permanently wedge (requiring a power-cycle) when a connection arrives
after idle. A watchdog that recovers the network task, and/or fixing the underlying
resource-lifecycle bug, would resolve it.

## Reproduction assets (this repository)

- `docs/testing/agentic-tests/full-cta-coverage/defects/S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT.md`
- `c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/logs/commands/host-idle-reconnect-experiment.log` (unauthenticated idle→reconnect, did not wedge)
- `.../host-idle-reconnect-AUTH-experiment.log` (authenticated idle→reconnect, did not wedge)
- `.../logs/logcat/wedge2-full-dump.log` (the on-device wedge: first poll after a ~4-min idle gap → Connection reset → permanent HTTP 000)
- `docs/agentic/C64U_INCIDENTS.md` (months of the same idle→request→dropout signature)
