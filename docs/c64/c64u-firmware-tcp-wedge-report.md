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

## Hypothesised firmware cause

The embedded TCP stack appears to leak or fail to recycle a bounded resource across idle periods
(or deadlocks its single connection-accept path), so that after idle the next connection cannot be
serviced and the stack stops accepting all TCP connections until reset. Suggested areas to audit:

- TCP PCB lifecycle (TIME_WAIT / FIN_WAIT / half-open PCBs not freed; `MEMP_NUM_TCP_PCB` exhaustion).
- Memory pool (pbuf / `MEMP_NUM_*`) exhaustion after idle.
- The HTTP server's accept loop blocking/deadlocking on a stale or half-closed connection.
- Any idle/power-save path that disables or corrupts the network task and is not cleanly resumed.

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
