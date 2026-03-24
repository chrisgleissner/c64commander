# Contract Harness Validation

Date: 2026-03-24
Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`

This document records the concrete validation evidence for the contract-harness changes that added the forensic recorder, structured load matrix, deterministic replay runner, and device-unresponsive outcome handling.

## Validation Commands

Executed validation commands:

```bash
npx tsc -p tests/contract/tsconfig.json
npm run lint
npm run test:coverage
CONTRACT_TEST_TARGET=mock node tests/contract/dist/run.js --config tests/contract/config.trace.safe.json
CONTRACT_TEST_TARGET=mock node tests/contract/dist/run.js --config tests/contract/config.safe.authoff.json
CONTRACT_TEST_TARGET=mock node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json
CONTRACT_TEST_TARGET=mock node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json --test-type soak
CONTRACT_TEST_TARGET=mock CONTRACT_MOCK_FAIL_AFTER_REST_COUNT=20 CONTRACT_MOCK_FAIL_PATH=/v1/version node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json
CONTRACT_TEST_TARGET=mock node tests/contract/dist/run.js --config tests/contract/config.stress.breakpoint.sample.json
node tests/contract/dist/replay.js --manifest test-results/contract/runs/20260324-161036-SAFE-OFF/replay/manifest.json --config tests/contract/config.trace.safe.json --dry-run
```

Quality gate outcomes:

- `npx tsc -p tests/contract/tsconfig.json`: passed
- `npm run lint`: passed
- `npm run test:coverage`: passed with global branch coverage at 91%

## Recorded Run IDs

- Trace-enabled SAFE run: `20260324-161036-SAFE-OFF`
- Trace-disabled SAFE run: `20260324-161200-SAFE-OFF`
- Matrix quick run: `20260324-161336-STRESS-OFF`
- CLI soak override run: `20260324-161507-STRESS-OFF`
- Simulated device-unresponsive run: `20260324-161527-STRESS-OFF`
- Breakpoint regression run: `20260324-161615-STRESS-OFF`

## Artifact Inventory

### Trace-enabled SAFE run: `20260324-161036-SAFE-OFF`

Directory inventory:

```text
concurrency.json    893 B
conflicts.json      957 B
endpoints.json      9.4K
ftp-cooldowns.json  469 B
latency-stats.json  5.4K
logs.jsonl          26K
meta.json           632 B
replay/             4.0K dir
rest-cooldowns.json 4.4K
trace.jsonl         216K
trace.md            106K
```

Replay directory:

```text
device-replay.http  19K
device-replay.sh    34K
manifest.json       51K
```

Recorder checks:

- `trace.jsonl` lines: 362
- entries with `launchedAtMs`: 362
- entries with non-empty `clientId`: 362
- markdown REST groups: 144
- markdown FTP groups: 32
- replay manifest request count: 176
- `meta.json` recorded `"outcome": "completed"`

Representative REST request entry from the matrix trace corpus:

```json
{
  "protocol": "REST",
  "direction": "request",
  "correlationId": "ad03a618-b9c8-4808-80bc-a0b50c5e1213",
  "clientId": "rest-client",
  "timestamp": "2026-03-24T16:13:38.356Z",
  "launchedAtMs": 1774368818325,
  "hrTimeNs": "93794733693818n",
  "method": "GET",
  "url": "http://127.0.0.1:42341/v1/version",
  "headers": {
    "X-Correlation-Id": "ad03a618-b9c8-4808-80bc-a0b50c5e1213"
  },
  "globalSeq": 15,
  "runSessionId": "20260324-161336-STRESS-OFF",
  "stageId": "stress-01-ftp.dir-list-c1-r1000-shared",
  "testType": "stress"
}
```

Representative FTP command entry from the matrix trace corpus:

```json
{
  "protocol": "FTP",
  "direction": "command",
  "correlationId": "b1e3c4dd-ca49-4481-b0d8-871f0926527e",
  "clientId": "client-1",
  "timestamp": "2026-03-24T16:13:36.820Z",
  "launchedAtMs": 1774368816820,
  "hrTimeNs": "93793229135263n",
  "ftpSessionId": "8d4ed189-5190-4917-81e4-55943b40143f",
  "rawCommand": "USER anonymous",
  "commandVerb": "USER",
  "globalSeq": 1,
  "runSessionId": "20260324-161336-STRESS-OFF",
  "stageId": "stress-01-ftp.dir-list-c1-r1000-shared",
  "testType": "stress"
}
```

Password redaction proof from `replay/device-replay.sh`:

```text
5:# X-Password: SET_PASSWORD_HERE
10:# X-Password: SET_PASSWORD_HERE
15:# X-Password: SET_PASSWORD_HERE
```

`device-replay.sh` was also syntax-checked with `bash -n` during validation.

### Trace-disabled SAFE run: `20260324-161200-SAFE-OFF`

Directory inventory:

```text
concurrency.json    897 B
conflicts.json      2.1K
endpoints.json      9.4K
ftp-cooldowns.json  1.4K
latency-stats.json  6.4K
logs.jsonl          27K
meta.json           610 B
rest-cooldowns.json 4.3K
```

Validation result:

- no `trace.jsonl`
- no `trace.md`
- no `replay/`
- shell check returned `no-trace-artifacts`

### Matrix quick run: `20260324-161336-STRESS-OFF`

Directory inventory:

```text
concurrency.json         203 B
conflicts.json           104 B
endpoints.json           9.4K
ftp-cooldowns.json       105 B
latency-stats.json       105 B
logs.jsonl               8.8K
matrix-failure-summary.json 203 B
matrix-stages.json       7.1K
meta.json                636 B
replay/                  4.0K dir
rest-cooldowns.json      105 B
trace.jsonl              41M
trace.md                 20M
```

Stage-count formula:

```text
3 operationIds × 2 concurrencyLevels × 2 rateRampMs × 1 ftpSessionMode = 12 stages
```

Observed results:

- `matrix-stages.json` contains 12 stages
- all 12 stage IDs are unique
- 66,852 trace entries carried a `stageId`
- invalid stage references in trace entries: 0
- all tagged trace entries referenced a `stageId` present in `matrix-stages.json`

### CLI soak override run: `20260324-161507-STRESS-OFF`

Observed results:

- `--test-type soak` produced a single stage
- `matrix-stages.json` contains exactly one record:

```json
{
  "stageId": "soak-01-rest.read-version-c1-r1000-shared",
  "order": 1,
  "testType": "soak",
  "operationId": "rest.read-version",
  "protocol": "rest",
  "concurrency": 1,
  "rateDelayMs": 1000,
  "ftpSessionMode": "shared",
  "durationMs": 5000,
  "status": "completed",
  "requestsStarted": 5,
  "requestsCompleted": 5,
  "successCount": 5,
  "failureCount": 0,
  "lastSuccessAtMs": 1774368911546,
  "firstFailureAtMs": null,
  "firstFailureError": null,
  "startedAt": "2026-03-24T16:15:07.542Z",
  "endedAt": "2026-03-24T16:15:13.558Z"
}
```

### Simulated device-unresponsive run: `20260324-161527-STRESS-OFF`

Directory inventory:

```text
concurrency.json         203 B
conflicts.json           104 B
DEVICE_UNRESPONSIVE      176 B
endpoints.json           9.4K
ftp-cooldowns.json       105 B
latency-stats.json       105 B
logs.jsonl               4.2K
matrix-failure-summary.json 233 B
matrix-stages.json       6.5K
meta.json                646 B
replay/                  4.0K dir
rest-cooldowns.json      105 B
trace.jsonl              165K
trace.md                 65K
```

Observed results:

- process exit code: 2
- `meta.json` recorded `"outcome": "device-unresponsive"`
- `DEVICE_UNRESPONSIVE` contents:

```text
runId: 20260324-161527-STRESS-OFF
timestamp: 2026-03-24T16:16:00.577Z
abortReason: Health probe unreachable for 3697ms
lastStageId: stress-06-rest.read-version-c4-r1000-shared
```

- `matrix-failure-summary.json` captured the aborting stage:

```json
{
  "stageId": "stress-06-rest.read-version-c4-r1000-shared",
  "operationId": "rest.read-version",
  "abortReason": "Health probe unreachable for 3697ms",
  "testType": "stress",
  "requestsStarted": 28,
  "requestsCompleted": 28
}
```

### Breakpoint regression run: `20260324-161615-STRESS-OFF`

Directory inventory:

```text
breakpoint-stages.json   35K
concurrency.json         203 B
conflicts.json           104 B
endpoints.json           9.4K
failure-summary.json     692 B
ftp-cooldowns.json       105 B
latency-stats.json       105 B
logs.jsonl               9.8M
meta.json                636 B
request-trace-tail.json  135K
rest-cooldowns.json      105 B
```

Regression check:

- `breakpoint-stages.json` present
- `failure-summary.json` present
- `request-trace-tail.json` present
- `matrix-stages.json` absent
- `DEVICE_UNRESPONSIVE` absent
- shell check returned `breakpoint-regression-ok`

This confirms the new matrix and recorder code paths did not overwrite the legacy breakpoint artifact contract.

## Replay Validation

Dry-run output sample from `.tmp/replay_dry_run.txt`:

```text
   1 +0ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
   3 +19ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
   5 +21ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
   7 +122ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
   9 +126ms client=rest-client REST GET http://127.0.0.1:42719/v1/info
  11 +129ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
  13 +233ms client=rest-client REST GET http://127.0.0.1:42719/v1/version
  15 +236ms client=rest-client REST GET http://127.0.0.1:42719/v1/configs
```

Replay limitations confirmed by implementation:

- request order, per-client sequencing, and relative launch offsets are preserved
- replay is not intended to reproduce exact wall-clock latency
- FTP upload replays preserve byte counts, not the original captured upload bytes
- `--dry-run` emits the schedule and performs no network traffic

## Summary

The forensic recorder, structured matrix runner, deterministic replay runner, and device-unresponsive outcome handling were validated against both normal and injected-failure mock runs. The recorded artifacts, counts, exit codes, and regression checks matched the expected contract.
