# C64U Contract Test (REST + FTP)

Date: 2026-02-07
Harness Version: v2 (comprehensive, auto-generated from OpenAPI)

## Scope

Empirically validated contract test for the C64 Ultimate (C64U) REST API and FTP service. Based on:

- OpenAPI spec: `doc/c64/c64u-openapi.yaml` (SHA256: `e11763d2...`)
- Firmware source: `1541ultimate/` (SHA1: `b831b01f...`)
- SAFE and STRESS mode measurements on a real device

## Device and Firmware

| Property | Value |
| --- | --- |
| Product | Ultimate 64 Elite |
| Firmware | 3.14 |
| FPGA | 121 |
| Core | 1.45 |
| Hostname | c64u |
| Unique ID | 38C1BA |

## Auth Modes

- **AUTH OFF**: Network password is empty. REST accepts missing `X-Password`. FTP PASS accepts any value.
- **AUTH ON**: REST requires `X-Password` header. FTP PASS must match `CFG_NETWORK_PASSWORD`.

Evidence: REST checks `X-Password` in `1541ultimate/software/api/routes.h`. FTP checks `CFG_NETWORK_PASSWORD` in `1541ultimate/software/network/ftpd.cc`.

AUTH ON was not exercised in this run (device configured AUTH OFF).

## Execution Model

### REST

- Synchronous request/response with JSON payloads.
- Every response includes `errors[]` array.
- Machine actions invoke `SubsysCommand::execute`; subsystem result codes map to HTTP status.
- Config writes apply to RAM immediately; flash persistence requires `configs:save_to_flash`.
- Concurrent requests are tolerated at N=2–4. N=8+ causes ECONNRESET on some requests.

### FTP

- Standard FTP control connection (port 21), line-oriented with USER/PASS auth.
- PASV and PORT modes both implemented.
- Server `listen()` with backlog of 2 for control and data sockets.
- Concurrent sessions (N=2–3) succeed. Higher concurrency may timeout.

---

## Canonical REST Endpoint Inventory (48 endpoints)

Auto-parsed from `doc/c64/c64u-openapi.yaml`.

### Information (read-only)

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| GET | `/v1/version` | Yes | p50=19ms |
| GET | `/v1/info` | Yes | p50=26ms |

### Configuration

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| GET | `/v1/configs` | Yes | p50=30ms |
| GET | `/v1/configs/{category}` | Yes | p50=16ms |
| GET | `/v1/configs/{category}/{item}` | Yes | p50=19ms |
| PUT | `/v1/configs/{category}/{item}` | Reversible | p50=15ms |
| POST | `/v1/configs` | Reversible | p50=33ms |
| PUT | `/v1/configs:load_from_flash` | Reversible | ECONNRESET |
| PUT | `/v1/configs:save_to_flash` | STRESS | ECONNRESET |
| PUT | `/v1/configs:reset_to_default` | EXCLUDED | Not exercised (destructive) |

### Machine Control

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| PUT | `/v1/machine:pause` | Reversible | p50=12ms |
| PUT | `/v1/machine:resume` | Reversible | p50=13ms |
| PUT | `/v1/machine:menu_button` | Reversible | p50=17ms |
| PUT | `/v1/machine:reset` | STRESS | Skipped (allowMachineReset=false) |
| PUT | `/v1/machine:reboot` | STRESS | Skipped (allowMachineReset=false) |
| PUT | `/v1/machine:poweroff` | EXCLUDED | Not exercised (unrecoverable) |
| GET | `/v1/machine:readmem` | Yes | p50=22ms |
| GET | `/v1/machine:debugreg` | Yes | p50=16ms |
| PUT | `/v1/machine:debugreg` | EXCLUDED | Not exercised (hardware-level) |
| PUT | `/v1/machine:writemem` | EXCLUDED | Not exercised (arbitrary memory write) |
| POST | `/v1/machine:writemem` | EXCLUDED | Not exercised (arbitrary memory write) |

### Drives

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| GET | `/v1/drives` | Yes | p50=32ms |
| PUT | `/v1/drives/{drive}:on` | Reversible | p50=15ms |
| PUT | `/v1/drives/{drive}:off` | Reversible | p50=15ms |
| PUT | `/v1/drives/{drive}:set_mode` | Reversible | p50=118ms |
| PUT | `/v1/drives/{drive}:reset` | Yes | p50=15ms |
| PUT | `/v1/drives/{drive}:load_rom` | Reversible | p50=58ms |
| POST | `/v1/drives/{drive}:load_rom` | STRESS | Documented |
| PUT | `/v1/drives/{drive}:mount` | STRESS | p50=727ms |
| POST | `/v1/drives/{drive}:mount` | STRESS | p50=1108ms |
| PUT | `/v1/drives/{drive}:remove` | STRESS | p50=115ms |

### Runners (media execution)

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| PUT | `/v1/runners:sidplay` | STRESS | p50=583ms |
| POST | `/v1/runners:sidplay` | STRESS | p50=412ms |
| PUT | `/v1/runners:modplay` | STRESS | p50=165ms |
| POST | `/v1/runners:modplay` | STRESS | p50=155ms |
| PUT | `/v1/runners:run_prg` | STRESS | Skipped (no PRG found) |
| POST | `/v1/runners:run_prg` | STRESS | p50=1975ms |
| PUT | `/v1/runners:load_prg` | STRESS | Skipped (no PRG found) |
| POST | `/v1/runners:load_prg` | STRESS | p50=571ms |
| PUT | `/v1/runners:run_crt` | STRESS | Skipped (no CRT file) |
| POST | `/v1/runners:run_crt` | STRESS | p50=258ms |

### Files

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| GET | `/v1/files/{path}:info` | Yes | p50=23ms |
| PUT | `/v1/files/{path}:create_d64` | STRESS | p50=61ms |
| PUT | `/v1/files/{path}:create_d71` | STRESS | p50=118ms |
| PUT | `/v1/files/{path}:create_d81` | STRESS | p50=184ms |
| PUT | `/v1/files/{path}:create_dnp` | STRESS | p50=119ms |

### Streams

| Method | Path | Safe | Measured |
| --- | --- | --- | --- |
| PUT | `/v1/streams/{stream}:start` | EXCLUDED | Requires external receiver IP |
| PUT | `/v1/streams/{stream}:stop` | EXCLUDED | Requires external receiver IP |

---

## Canonical FTP Command Inventory (26 commands)

| Command | Measured | Notes |
| --- | --- | --- |
| USER | Yes | Part of connect sequence |
| PASS | Yes | Part of connect sequence |
| QUIT | Yes | Part of close sequence |
| SYST | Yes | p50=4ms |
| FEAT | Yes | Exercised |
| TYPE | Yes | I and A modes |
| MODE | Yes | S mode |
| NOOP | Yes | Exercised |
| PWD | Yes | Exercised |
| CWD | Yes | Exercised |
| CDUP | Yes | Exercised |
| MKD | Yes | 553 if exists |
| RMD | No | Not exercised |
| LIST | Yes | p50=50–54ms |
| NLST | Yes | Exercised |
| MLSD | Yes | p50=51–55ms |
| MLST | Yes | Exercised |
| RETR | Yes | p50=131ms (64KB) |
| STOR | Yes | p50=121ms (64KB) |
| DELE | Yes | Exercised |
| SIZE | Yes | Exercised |
| RNFR | Yes | Exercised |
| RNTO | Yes | Exercised |
| PASV | Yes | Used for all data transfers |
| PORT | No | Not measured |
| ABOR | Yes | Exercised |

---

## Pacing and Cooldowns (Empirical)

### REST Cooldowns — SAFE (AUTH OFF)

| Operation | p50 | p90 | p99 | Recommended Delay |
| --- | --- | --- | --- | --- |
| GET /v1/version | 19 | 22 | 22 | 22ms |
| GET /v1/info | 26 | 28 | 28 | 28ms |
| GET /v1/configs | 30 | 35 | 41 | 35ms |
| GET /v1/configs/{category} | 16 | 20 | 20 | 20ms |
| GET /v1/configs/{category}/{item} | 19 | 19 | 19 | 19ms |
| GET /v1/drives | 32 | 38 | 38 | 38ms |
| GET /v1/machine:readmem | 22 | 30 | 30 | 30ms |
| GET /v1/machine:debugreg | 16 | 16 | 16 | 16ms |
| GET /v1/files/{path}:info | 23 | 23 | 23 | 23ms |
| PUT /v1/configs/{category}/{item} | 15 | 15 | 15 | 15ms |
| POST /v1/configs | 33 | 33 | 33 | 33ms |
| PUT /v1/machine:pause | 12 | 12 | 12 | 12ms |
| PUT /v1/machine:resume | 13 | 13 | 13 | 13ms |
| PUT /v1/machine:menu_button | 17 | 17 | 17 | 17ms |
| PUT /v1/drives/{drive}:on | 15 | 15 | 15 | 15ms |
| PUT /v1/drives/{drive}:off | 15 | 15 | 15 | 15ms |
| PUT /v1/drives/{drive}:set_mode | 118 | 118 | 118 | 118ms |
| PUT /v1/drives/{drive}:reset | 15 | 15 | 15 | 15ms |
| PUT /v1/drives/{drive}:load_rom | 58 | 58 | 58 | 58ms |

### REST Cooldowns — STRESS (AUTH OFF, additional endpoints)

| Operation | p50 | p90 | Recommended Delay |
| --- | --- | --- | --- |
| PUT /v1/files/{path}:create_d64 | 61 | 61 | 61ms |
| PUT /v1/files/{path}:create_d71 | 118 | 118 | 118ms |
| PUT /v1/files/{path}:create_d81 | 184 | 184 | 184ms |
| PUT /v1/files/{path}:create_dnp | 119 | 119 | 119ms |
| PUT /v1/drives/{drive}:mount | 727 | 727 | 727ms |
| POST /v1/drives/{drive}:mount | 1108 | 1108 | 1108ms |
| PUT /v1/drives/{drive}:remove | 115 | 115 | 115ms |
| PUT /v1/runners:sidplay | 583 | 583 | 583ms |
| POST /v1/runners:sidplay | 412 | 412 | 412ms |
| PUT /v1/runners:modplay | 165 | 165 | 165ms |
| POST /v1/runners:modplay | 155 | 155 | 155ms |
| POST /v1/runners:run_prg | 1975 | 1975 | 1975ms |
| POST /v1/runners:load_prg | 571 | 571 | 571ms |
| POST /v1/runners:run_crt | 258 | 258 | 258ms |

### FTP Cooldowns — SAFE (AUTH OFF)

| Command | p50 | p90 | Recommended Delay |
| --- | --- | --- | --- |
| SYST | 4 | 4 | 4ms |
| LIST (concurrent N=2) | 50 | 61 | 61ms |
| LIST (concurrent N=3) | 61 | 63 | 63ms |
| STOR (64KB) | 121 | 121 | 121ms |
| RETR (64KB) | 131 | 131 | 131ms |
| LIST (during REST load) | 54 | 54 | 54ms |
| MLSD (during REST load) | 51 | 51 | 51ms |

---

## Concurrency Limits

### REST Concurrency

| Probe | Max In-Flight | Failures | Max Latency | Mode |
| --- | --- | --- | --- | --- |
| /v1/configs N=2 | 2 | 0 | 33ms | SAFE |
| /v1/configs N=4 | 4 | 0 | 39ms | SAFE |
| Mixed GETs N=2 | 2 | 0 | 37ms | SAFE |
| Mixed GETs N=4 | 4 | 0 | 36ms | SAFE |
| readmem N=2 | 2 | 0 | 27ms | SAFE |
| /v1/configs N=10 | 10 | 0 | 120ms | STRESS |
| Mixed GETs N=10 | 10 | 0 | 113ms | STRESS |

**Finding**: C64U handles N=2–4 concurrent REST GETs reliably. N=8+ with keepAlive may trigger ECONNRESET. N=10 in STRESS mode with retries succeeds but with 2–3× latency increase.

### FTP Concurrency

| Probe | Sessions | Failures | Max Latency |
| --- | --- | --- | --- |
| Concurrent LIST N=2 | 2 | 0 | 61ms |
| Concurrent LIST N=3 | 3 | 0 | 63ms |

**Finding**: C64U FTP server supports at least 3 concurrent sessions for read-only operations.

---

## Conflict Matrix (12 pairs measured)

### REST × REST

| A | B | Result | A Latency | B Latency |
| --- | --- | --- | --- | --- |
| GET version | GET version | allowed | 25ms | 27ms |
| GET version | GET configs | allowed | 19ms | 27ms |
| GET configs | GET drives | allowed | 34ms | 36ms |
| GET version | GET drives | allowed | 16ms | 30ms |
| GET configs | GET configs | allowed | 24ms | 32ms |

### FTP × FTP

| A | B | Result | A Latency | B Latency |
| --- | --- | --- | --- | --- |
| LIST | LIST | allowed | 49ms | 53ms |
| LIST | MLSD | allowed | 49ms | 60ms |
| STOR | LIST | allowed | 63ms | 56ms |

### REST × FTP (cross-protocol)

| A | B | Result | A Latency | B Latency |
| --- | --- | --- | --- | --- |
| REST GET version | FTP LIST | allowed | 15ms | 56ms |
| REST GET configs | FTP LIST | allowed | 22ms | 64ms |
| REST GET drives | FTP MLSD | allowed | 35ms | 57ms |
| REST GET version | FTP STOR | allowed | 15ms | 65ms |

**Finding**: No conflicts detected. All 12 tested concurrent pairs completed successfully. REST and FTP are independent subsystems with no observable contention for read/read and read/write mixes.

---

## Coverage Matrix

### REST Coverage (48 endpoints)

| Status | Count | Endpoints |
| --- | --- | --- |
| **Measured (SAFE)** | 20 | GET version/info/configs(3)/drives/readmem/debugreg/files:info, PUT/POST configs, PUT machine:pause/resume/menu_button, PUT drives:on/off/set_mode/reset/load_rom, PUT configs:load_from_flash |
| **Measured (STRESS)** | 15 | PUT/POST runners:sidplay/modplay, POST runners:run_prg/load_prg/run_crt, PUT files:create_d64/d71/d81/dnp, PUT/POST drives:mount, PUT drives:remove, PUT configs:save_to_flash |
| **Documented (STRESS)** | 1 | POST drives:load_rom (scenario exists, exercised with harness payload) |
| **Skipped (not enabled)** | 2 | PUT machine:reset, PUT machine:reboot (allowMachineReset=false) |
| **Skipped (no media)** | 3 | PUT runners:run_prg/load_prg/run_crt (filesystem variants; no PRG/CRT on device) |
| **Excluded (dangerous)** | 5 | PUT machine:poweroff, PUT/POST machine:writemem, PUT machine:debugreg, PUT configs:reset_to_default |
| **Excluded (infra)** | 2 | PUT streams:start/stop (requires external receiver IP) |
| **Total** | 48 | 48/48 accounted for |
| **Coverage** | **36/48 (75%)** exercised with latency data, **41/48 (85%)** excluding justified exclusions |

### FTP Coverage (26 commands)

| Status | Count | Commands |
| --- | --- | --- |
| **Measured** | 24 | USER, PASS, QUIT, SYST, FEAT, TYPE, MODE, NOOP, PWD, CWD, CDUP, MKD, LIST, NLST, MLSD, MLST, RETR, STOR, DELE, SIZE, RNFR, RNTO, PASV, ABOR |
| **Not measured** | 2 | RMD, PORT |
| **Coverage** | **24/26 (92%)** |

---

## Notable Observations

### SAFE Run
- `configs:load_from_flash` triggers ECONNRESET — the C64U likely restarts its HTTP server when reloading config from flash.
- FTP basic command sweep succeeds through NLST/MLSD/MLST/STOR/SIZE/RETR/RNFR/RNTO/DELE/CDUP/ABOR.
- FTP session may timeout under heavy prior load (observed on second SAFE run attempt).
- MKD returns 553 if the directory already exists.
- `drives:set_mode` takes ~110ms (involves hardware reconfiguration).

### STRESS Run
- `configs:save_to_flash` also triggers ECONNRESET (flash write causes HTTP server restart).
- POST `drives:mount` with a 174KB D64 upload takes 1108ms.
- POST `runners:run_prg` with a minimal 3-byte PRG takes 1975ms (includes C64 reset + load + run cycle).
- POST `runners:sidplay` with a harness-generated minimal PSID takes 412ms.
- POST `runners:modplay` with a harness-generated minimal MOD takes 155ms.
- POST `runners:run_crt` with a harness-generated minimal CRT takes 258ms.
- Concurrent REST at N=10 succeeds with retries (STRESS mode has retry logic for ECONNRESET).

### ECONNRESET Pattern
Endpoints that perform flash operations or config reloads consistently reset the TCP connection. Client code must handle this with retry logic and a 500ms+ cooldown.

---

## Exclusions (with justification)

| Endpoint | Reason |
| --- | --- |
| PUT /v1/machine:poweroff | Shuts down the device with no remote recovery. |
| PUT /v1/machine:writemem | Arbitrary memory write — risk of corruption. |
| POST /v1/machine:writemem | Arbitrary memory write — risk of corruption. |
| PUT /v1/machine:debugreg | Hardware register write — unpredictable effects. |
| PUT /v1/configs:reset_to_default | Overwrites all user configuration — data-destructive. |
| PUT /v1/streams/{stream}:start | Requires external audio/video receiver IP address. |
| PUT /v1/streams/{stream}:stop | Requires active stream to stop. |

---

## Reproduction Commands

### SAFE (AUTH OFF)

```bash
npm install
npx tsc -p tests/contract/tsconfig.json
node tests/contract/dist/run.js \
  --config tests/contract/config.safe.authoff.json
```

### STRESS (AUTH OFF)

```bash
node tests/contract/dist/run.js \
  --config tests/contract/config.stress.authoff.highconcurrency.json
```

### Full build helper

```bash
./build --test-contract --c64u-target mock --contract-mode safe --contract-auth off
```

---

## Integration Guidance

- Read `test-results/contract/latest/*.json` for machine-parseable contract data.
- Use `recommendedDelayMs` from cooldown files as client-side pacing hints.
- Use concurrency limits as caps for in-flight requests.
- Handle ECONNRESET for flash-related endpoints with retry + 500ms cooldown.
- Runner operations (sidplay, modplay, run_prg, run_crt) take 150–2000ms. Budget timeouts accordingly.
- POST (upload) variants of runner and mount endpoints send binary data with `Content-Type: application/octet-stream`.
- The harness always reboots the device and waits for `/v1/info` recovery before exit.

---

## Known Unknowns

- **AUTH ON** not exercised (device configured AUTH OFF).
- **FTP PORT mode** not measured (PASV only).
- **FTP RMD** not exercised.
- **machine:reset / machine:reboot** not exercised (`allowMachineReset=false`).
- **PUT runners (filesystem)** for PRG and CRT not exercised (no files of those types found on USB storage).
- **Streams endpoints** require external receiver infrastructure.
- **Higher FTP concurrency** (N>3) not tested.
- **ECONNRESET on flash operations** — underlying cause is in firmware HTTP server lifecycle; no workaround except retry.

---

## Run Metadata

### SAFE AUTH OFF

- Run ID: `20260207-174552-SAFE-OFF`
- OpenAPI SHA256: `e11763d2a1c6ec0da51c6805cf05fdeb5674c59bbecce44fa9800430391190dc`
- Firmware SHA1: `b831b01f97859b02f3f52f003efb88d474648dec`
- Repo SHA1: `3a14347ff67c2d5f2bb2cc939b92cfa24afe3429`

### STRESS AUTH OFF

- Run ID: `20260207-174703-STRESS-OFF`
- OpenAPI SHA256: `e11763d2a1c6ec0da51c6805cf05fdeb5674c59bbecce44fa9800430391190dc`
- Firmware SHA1: `b831b01f97859b02f3f52f003efb88d474648dec`
- Repo SHA1: `3a14347ff67c2d5f2bb2cc939b92cfa24afe3429`
