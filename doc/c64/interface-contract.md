# C64U Interface Contract (REST + FTP)

Date: 2026-02-07

## Scope

This document defines an empirically validated interface contract for the C64 Ultimate (C64U) REST API and FTP service. It is based on:

- Firmware source inspection (1541ultimate/)
- OpenAPI spec: doc/c64/c64u-openapi.yaml
- SAFE mode measurements on a real device

## Device and Firmware

- Device: Ultimate 64 Elite
- Firmware version: 3.14
- FPGA version: 121
- Core version: 1.45
- Hostname: c64u
- Unique ID: 38C1BA

## Evidence Anchors (Firmware)

REST:
- REST auth checks for X-Password are in 1541ultimate/software/api/routes.h (ParseReqHeader).
- REST routes are implemented in 1541ultimate/software/api/route_*.cc.
- Machine operations use SubsysCommand::execute in 1541ultimate/software/api/route_machine.cc.

FTP:
- FTP daemon is implemented in 1541ultimate/software/network/ftpd.cc.
- PASS handling and password comparison use CFG_NETWORK_PASSWORD (ftpd.cc cmd_pass).
- FTP service enable is governed by CFG_NETWORK_FTP_SERVICE (network_config.cc).

## Auth Modes

- AUTH OFF: Network password is empty, REST accepts missing X-Password header and FTP PASS accepts any value.
- AUTH ON: REST requires X-Password header and FTP PASS must match the network password.

Auth evidence:
- REST checks for X-Password in 1541ultimate/software/api/routes.h.
- FTP PASS checks CFG_NETWORK_PASSWORD in 1541ultimate/software/network/ftpd.cc.

AUTH ON was not executed in this run because the device is configured for AUTH OFF.

## Execution Model

### REST

- Requests are handled synchronously and respond with JSON that includes an errors array.
- Machine actions invoke SubsysCommand::execute; responses map subsystem result codes to HTTP.
- Config writes apply immediately and can be persisted only via configs:save_to_flash.

### FTP

- Control connection is line-oriented with USER/PASS authentication.
- Passive and active (PASV/PORT) modes are implemented.
- The server uses listen(sockfd, 2) for control and data sockets, indicating a backlog of 2 pending connections.

## SAFE vs STRESS Coverage

SAFE mode (AUTH OFF) executed:
- REST: /v1/version, /v1/info, /v1/configs, /v1/drives, reversible config write + restore.
- REST concurrency probes: /v1/configs and mixed GETs (version/info/drives/configs).
- FTP: PWD, MKD, CWD, LIST, MLSD; the session later timed out (see below).
- Mixed: REST GET /v1/version while FTP LIST.

STRESS mode (AUTH OFF) executed:
- REST: /v1/machine:reset, /v1/files/{path}:create_d64, /v1/drives/{drive}:mount, /v1/drives/{drive}:remove.
- FTP: same basic command sweep as SAFE.

SID/PRG runner scenarios were skipped (no file paths supplied).

SAFE coverage is partial; endpoints not executed in SAFE are listed under Known Unknowns.

## Pacing and Cooldowns (Empirical)

All values in ms, derived from observed p50/p90/p99.

REST cooldowns (SAFE, AUTH OFF):

| Operation | p50 | p90 | p99 | minDelayMs | recommendedDelayMs | maxDelayMs |
| --- | --- | --- | --- | --- | --- | --- |
| GET /v1/version | 11 | 35 | 35 | 11 | 35 | 35 |
| GET /v1/info | 19 | 25 | 25 | 19 | 25 | 25 |
| GET /v1/configs | 26 | 47 | 47 | 26 | 47 | 47 |
| GET /v1/drives | 25 | 34 | 34 | 25 | 34 | 34 |
| PUT /v1/configs/{category}/{item} | 13 | 13 | 13 | 13 | 13 | 13 |
| PUT /v1/configs/{category}/{item} restore | 24 | 24 | 24 | 24 | 24 | 24 |

REST cooldowns (STRESS, AUTH OFF):

| Operation | p50 | p90 | p99 | minDelayMs | recommendedDelayMs | maxDelayMs |
| --- | --- | --- | --- | --- | --- | --- |
| PUT /v1/machine:reset | 34 | 34 | 34 | 34 | 34 | 34 |
| GET /v1/version (post-reset) | 20 | 20 | 20 | 20 | 20 | 20 |
| PUT /v1/files/{path}:create_d64 | 181 | 181 | 181 | 181 | 181 | 181 |
| PUT /v1/drives/{drive}:mount | 739 | 739 | 739 | 739 | 739 | 739 |
| PUT /v1/drives/{drive}:remove | 112 | 112 | 112 | 112 | 112 | 112 |

FTP cooldowns (SAFE, AUTH OFF):

| Command | p50 | p90 | p99 | minDelayMs | recommendedDelayMs | maxDelayMs |
| --- | --- | --- | --- | --- | --- | --- |
| PWD | 3 | 3 | 3 | 3 | 3 | 3 |
| MKD | 8 | 8 | 8 | 8 | 8 | 8 |
| CWD | 8 | 8 | 8 | 8 | 8 | 8 |
| LIST | 59 | 64 | 64 | 59 | 64 | 64 |
| MLSD | 68 | 68 | 68 | 68 | 68 | 68 |

## Concurrency Limits

Observed (SAFE run settings):
- REST max in-flight configured: 2
- FTP max sessions configured: 1
- Mixed max in-flight configured: 2

Observations:
- REST /v1/configs concurrent: no failures, max latency 47ms (SAFE), 28ms (STRESS).
- REST mixed concurrent: no failures, max latency 35ms (SAFE), 36ms (STRESS).

No hard firmware limits were observed beyond TCP listen backlogs. See ftpd.cc and httpd.cc for server entry points.

## Conflict and Supersession Rules

- No conflict matrix measurements were collected yet.
- REST requests are synchronous and responses are immediate.
- FTP data commands require a valid data connection and return 425/5xx on missing setup.

## Cross-Protocol Contention

A mixed scenario (REST GET /v1/version + FTP LIST) completed without errors. No measurable contention was observed in SAFE mode.

## Transport Effects

- HTTP keep-alive vs new connection: not measured.
- FTP PASV vs PORT: PASV used in SAFE run; PORT not yet measured.

## Notable SAFE Run Observations

- FTP MKD returned 553 (directory may already exist or permissions denied), but CWD succeeded.
- FTP session timed out after MLSD; MLST and subsequent write commands did not complete in this run.

## Notable STRESS Run Observations

- Machine reset completed and /v1/version responded within 20ms post-reset.
- Created /USB2/Test/interface-harness.d64, then mounted and removed on drive A.
- FTP control session timed out after MLSD, consistent with SAFE behavior.

## Reproduction Commands

SAFE AUTH OFF:

```bash
npm install
npx tsc -p scripts/c64u-interface-contract/tsconfig.json
node scripts/c64u-interface-contract/dist/run.js --config scripts/c64u-interface-contract/config.safe.authoff.json
```

Via build helper (SAFE/AUTH OFF):

```bash
./build --interface-test --interface-test-mode safe --interface-test-auth off --skip-tests --skip-build --skip-apk
```

Auth comparison (when AUTH ON is available):

```bash
node scripts/c64u-interface-contract/dist/compare.js --left <run-auth-on> --right <run-auth-off>
```

## Integration Guidance

- Add a feature-flagged loader that reads test-results/c64u-interface-contract/latest/*.
- Use per-operation recommendedDelayMs as a client-side pacing hint.
- Use concurrency limits as caps for in-flight requests (REST, FTP, mixed).
- Default behavior should remain unchanged unless the feature flag is enabled.

## Known Unknowns

- AUTH ON run has not been executed (device configured for AUTH OFF).
- Many REST endpoints remain unmeasured in SAFE mode (streams, machine operations beyond reset).
- FTP PORT mode behavior and large transfer performance are not yet measured.
- Conflict matrix and cross-protocol contention under load are not measured.
- SID and PRG runner endpoints remain unmeasured (no file paths provided).

## Run Metadata

SAFE AUTH OFF run:
- Run ID: 20260207-170209-SAFE-OFF
- OpenAPI SHA256: e11763d2a1c6ec0da51c6805cf05fdeb5674c59bbecce44fa9800430391190dc
- Firmware SHA1: b831b01f97859b02f3f52f003efb88d474648dec
- Repo SHA1: 160e30140993c368aca50e704f0ae146f2d06d94

STRESS AUTH OFF run:
- Run ID: 20260207-170255-STRESS-OFF
- OpenAPI SHA256: e11763d2a1c6ec0da51c6805cf05fdeb5674c59bbecce44fa9800430391190dc
- Firmware SHA1: b831b01f97859b02f3f52f003efb88d474648dec
- Repo SHA1: 160e30140993c368aca50e704f0ae146f2d06d94
