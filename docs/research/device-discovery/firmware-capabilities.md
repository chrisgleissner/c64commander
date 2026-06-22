# 1541ultimate Firmware Capability History + Runtime Detection (2026-06-22)

Audit grounding for "expose only features the connected device actually has", derived from the
official 1541ultimate documentation/firmware and verified against the lab U64 + C64U over REST.

## 1. Network services — when each was introduced (firmware version)

| Service | Introduced | Notes |
| --- | --- | --- |
| **Telnet** (raw VT100 menu server, port 23) | firmware **3.0** (beta4, when USB2LAN networking landed) | Brings up the on-device menu over a terminal; long-standing. |
| **FTP** (file daemon, port 21) | firmware **3.0** (beta4) | Basic file transfer; long-standing. |
| **HTTP REST API** (`/v1/...`) | firmware **3.11** | "Starting from Ultimate firmware 3.11, the application supports API calls by means of the HTTP protocol." |
| **Network password** (`X-Password`, 401/403 gating) | firmware **3.12** | Auth for REST/web. Drives the global Forbidden→password popup. |
| REST API contract version (`GET /v1/version`) | — | Returns `{"version":"0.1"}` on both U64 (fw 3.14e) and C64U (fw 1.1.0). A coarse capability baseline, not per-feature. |

The original USB2LAN Ethernet adapter for the cartridge was unstable on fw 3.2/3.3, fixed in **3.4**.

## 2. Features exposed per device type

Two hardware classes matter:
- **Integrated computers** — Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite-II, and the
  **Commodore 64 Ultimate** ("C64 Ultimate" board, internally U64-family). These ARE the C64.
- **Cartridges** — Ultimate-II+, Ultimate-II+L (and the original Ultimate-II via USB2LAN). These
  plug into a host C64 and cannot control its power or video pipeline.

| REST capability | Integrated (U64 family / C64U) | Cartridge (U2 family) | Firmware qualifier |
| --- | --- | --- | --- |
| `/v1/info`, `/v1/version` | ✅ | ✅ | base (3.11+) |
| `/v1/configs` (read/write) | ✅ | ✅ | base; **categories differ by device** (see below) |
| `/v1/drives`, mount/reset/rom/mode | ✅ | ✅ | base |
| `/v1/runners` (sidplay/modplay/prg/crt) | ✅ | ✅ | base |
| `/v1/files` (create d64/d71/d81/dnp) | ✅ | ✅ | base (V3.11 alpha) |
| `/v1/machine:reset / reboot / pause / resume / menu_button` | ✅ | ✅ | base — `menu_button` compiled on every family |
| `/v1/machine:poweroff` | ✅ | ❌ | **"U64-only command"** |
| `/v1/machine:debugreg` (GET/PUT) | ✅ | ❌ | **"U64-only call"** |
| `/v1/streams/<name>:start/stop` (VIC/audio/debug streams) | ✅ | ❌ | **"(U64 only)"** |
| `core_version` field in `/v1/info` | ✅ (e.g. U64 `1.4B`, C64U `1.49`) | ❌ absent | **"Only for Ultimate 64 devices"** |

Config categories also differ: integrated computers expose U64-class categories (e.g. **U64 Specific
Settings**, **Data Streams**, **Audio Mixer**, **UltiSID Configuration**, **LED Strip Settings**)
that cartridges do not. This is observable from `GET /v1/configs` at runtime.

## 3. Runtime detection signals (so we never hard-code device→feature)

Every per-device difference above has a **runtime signal** — no family literal is required:

1. **`/v1/info.core_version` present ⇒ integrated computer** (U64-family / C64U) ⇒ `machine:poweroff`,
   `machine:debugreg`, and `/v1/streams` exist. **Absent ⇒ cartridge** ⇒ none of those. This is the
   single cleanest discriminator and is already fetched on every connect/health check.
2. **`GET /v1/configs` category presence** ⇒ which config features exist. Streaming is best detected
   from the **Data Streams** category (`Stream VIC to` / `Stream Audio to` items) — already used by
   `detectStreamingFromConfig`.
3. **`firmware_version`** ⇒ version gates (REST needs 3.11; password needs 3.12). Below 3.11 there is
   no REST API at all, so the app cannot talk to the device — an implicit hard floor.
4. **Endpoint probe (404 vs 2xx)** ⇒ last-resort per-route detection. Not needed today because (1)+(2)
   already cover the U64-only set; reserved for future routes with no info/config signal.

## 4. Genuine "no runtime signal" exceptions (must stay heuristic)

- **Telnet menu key** (`telnetTypes.ts`): which function key opens the on-device menu over telnet is
  firmware-specific and is NOT reported by any REST/telnet field. This legitimately stays a per-family
  table with a conservative default.

## 5. Implications for C64 Commander (refactor)

`deriveDeviceCapabilities` already receives `coreVersion` and the Data Streams config signal but only
used family literals for `supportsPowerCycle` and the streaming fallback. Refactor to:
- `supportsPowerCycle` ⇐ `restReachable && coreVersion present` (was the `{C64U, U64E2}` family set —
  which was also too narrow; poweroff is all-integrated-computer). Cartridges correctly excluded.
- `supportsStreaming` fallback ⇐ `coreVersion present` (was `{C64U,U64,U64E,U64E2}` family set); the
  Data Streams config signal still wins when available.
- `supportsMenuInput` ⇐ `restReachable` (menu_button is universal; do not require a recognised family).
- Keep `family` for display/labels only — never as a feature gate.

Sources: [REST API Calls](https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html),
[Ethernet port](https://1541u-documentation.readthedocs.io/en/latest/hardware/ethernet.html),
[ultimate64.com](https://ultimate64.com/), firmware release history
([markusC64/1541ultimate2](https://github.com/markusC64/1541ultimate2/releases),
[GideonZ/1541ultimate](https://github.com/GideonZ/1541ultimate)). Verified live: U64 `fw 3.14e
core 1.4B`, C64U `fw 1.1.0 core 1.49`, both `GET /v1/version → 0.1`.
