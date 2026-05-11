# Transport Trace Coverage Handover Prompt

Date: 2026-05-11
Type: Strict continuation prompt
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Read first

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- `docs/research/device-switching-diagnostics/multi-device-diagnostics-spec.md`
- `docs/research/device-switching-diagnostics/prompt.md`
- `docs/research/diagnostics-actions-vs-traces/investigation.md`

Then read the smallest relevant set from:

- `src/lib/tracing/types.ts`
- `src/lib/tracing/traceSession.ts`
- `src/lib/tracing/fetchTrace.ts`
- `src/lib/tracing/traceFormatter.ts`
- `src/lib/ftp/ftpClient.ts`
- `src/lib/telnet/telnetSession.ts`
- `src/lib/telnet/telnetCapabilityDiscovery.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetActionExecutor.ts`
- `src/hooks/useTelnetActions.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/diagnostics/actionSummaries.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- transport trace unit tests under `tests/unit/tracing/`, `tests/unit/lib/ftp/`, `tests/unit/hooks/`, and `tests/unit/lib/diagnostics/`

Keep handover-only notes under `docs/research/transport-trace-coverage/`. Do not create or update unrelated planning artifacts unless the user explicitly asks.

## Mission

Drastically extend transport trace coverage so the repository can honestly prove all of the following:

1. Every device interaction path, whether over HTTP/REST, FTP, or TELNET, emits transport-specific trace event data.
2. Those trace events contain enough request-side and response-side information to reconstruct what was attempted and what came back, subject to existing redaction rules.
3. The resulting trace evidence is visible in Diagnostics, especially under the Traces evidence type, and can be isolated through the Contributor filter.
4. Regression coverage proves this behavior at the writer layer, the transport caller layer, the Diagnostics Traces UI/filter layer, and the export/snapshot layer.

Do not treat this as a pure test-writing task. The current tree still has a real schema gap in TELNET tracing, so some production code must change before the exhaustive proof can be honest.

## Current state

This is not fully done.

What is already true in the current tree:

- REST traces are structurally rich.
  - `recordRestRequest(...)` writes `method`, `url`, `normalizedUrl`, `protocol`, `hostname`, `port`, `path`, `query`, `headers`, redacted `body`, `payloadPreview`, and `target`.
  - `recordRestResponse(...)` writes `method`, `url`, `normalizedUrl`, `path`, `query`, `status`, `headers`, redacted `body`, `payloadPreview`, `durationMs`, `error`, and `expectedFailure`.
- FTP traces are structurally rich.
  - `recordFtpOperation(...)` writes `operation`, `command`, `hostname`, `port`, `path`, `durationMs`, `result`, `requestPayload`, `requestPayloadPreview`, `responsePayload`, `responsePayloadPreview`, `error`, and `target`.
  - `src/lib/ftp/ftpClient.ts` already records list, read, and write operations.
- Diagnostics filtering recognizes transport contributors from raw `TraceEvent.type` values.
  - `DiagnosticsDialog.tsx` maps `rest-request` and `rest-response` to the `REST` contributor, `ftp-operation` to `FTP`, and `telnet-operation` to `TELNET`.
- The recent steering fix already landed a minimal TELNET visibility improvement.
  - `src/lib/diagnostics/healthCheckEngine.ts` now emits a `telnet-operation` event for the TELNET health probe.
  - `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx` now proves that a `telnet-operation` trace entry can be found through the Contributor filter.

What is still not good enough:

- TELNET traces are not request/response complete.
  - `recordTelnetOperation(...)` currently writes only `actionId`, `actionLabel`, `menuPath`, `durationMs`, `result`, `error`, and `target`.
  - There is no TELNET request-side equivalent yet for fields such as `hostname`, `port`, `requestPayload`, or `requestPayloadPreview`.
  - There is no TELNET response-side equivalent yet for fields such as `responsePayload` or `responsePayloadPreview`.
  - There is no proof that connect/auth/read/write/navigation/session flows preserve enough evidence to debug a failed TELNET interaction from Diagnostics alone.
- Current regression coverage is fragmented.
  - REST has strong unit coverage around `fetchTrace.ts` and `traceSession.ts`.
  - FTP has writer-level coverage in `tests/unit/lib/ftp/ftpClient.test.ts` and some trace-session coverage.
  - TELNET coverage currently proves only that an operation is recorded, not that the trace contains a full request/response contract.
- The current Diagnostics tests prove contributor filtering exists, but not that the filtered trace rows/details expose all request/response information that support needs.

## Important current facts

Treat the current file contents as authoritative.

Key facts verified from the current tree:

- `src/lib/tracing/types.ts`
  - transport trace types are currently:
    - `rest-request`
    - `rest-response`
    - `ftp-operation`
    - `telnet-operation`
- `src/lib/tracing/traceSession.ts`
  - REST and FTP already have explicit request-side and response-side fields in raw trace event data.
  - TELNET does not.
- `src/hooks/useTelnetActions.ts`
  - user TELNET actions record only high-level action metadata through `recordTelnetOperation(...)`.
- `src/lib/diagnostics/healthCheckEngine.ts`
  - the TELNET health probe now also records `recordTelnetOperation(...)`, but still only at the same high-level action schema.
- `tests/unit/tracing/traceSession.test.ts`
  - exercises REST, FTP, and TELNET event writing, but TELNET is only tested against the current shallow schema.
- `tests/unit/tracing/fetchTrace.test.ts`
  - already has strong REST request/response capture assertions.
- `tests/unit/lib/ftp/ftpClient.test.ts`
  - already checks that FTP list/read/write call into `recordFtpOperation(...)` with payloads.
- `tests/unit/hooks/useTelnetActions.test.tsx`
  - currently checks that `recordTelnetOperation(...)` is called, but not that any request/response transcript is preserved.
- `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`
  - already covers REST and FTP contributor filtering.
  - already covers TELNET contributor filtering for a minimal `telnet-operation` row.
  - does not yet prove that filtered TELNET, FTP, and REST Traces entries expose complete request-side and response-side fields in the UI.

## Primary gap to fix first

Do not start by adding dozens of tests around the existing TELNET schema. That would only lock in an incomplete contract.

The first real gap is this:

- REST and FTP have trace schemas rich enough to satisfy the user request.
- TELNET does not.

The first implementation step should therefore be to define the minimum TELNET request/response trace contract that can honestly satisfy:

- what was sent
- what came back
- what device/target was used
- what failed, if anything
- what the Diagnostics UI can display and filter

Use the existing code vocabulary when defining that contract. In particular:

- preserve `actionId`, `actionLabel`, `menuPath`, `target`, `result`, `durationMs`, and `error` unless every dependent reader is updated together
- prefer field names parallel to the current REST and FTP trace data where practical, for example `hostname`, `port`, `requestPayload`, `requestPayloadPreview`, `responsePayload`, and `responsePayloadPreview`
- if TELNET moves away from a single enriched `telnet-operation` event, update all readers that currently key off `TraceEvent.type === "telnet-operation"`

That contract must preserve redaction discipline. Never log secrets such as raw passwords.

## Required outcome

When this work is done, the repo should be able to prove, with tests, that every device interaction path leaves behind a transport-specific trace with both request and response detail and that the user can find that trace from Diagnostics.

That means all of the following must be true:

### REST

- all traced REST calls emit both `rest-request` and `rest-response`
- request assertions cover:
  - method
  - `url`, `path`, `query`, and `normalizedUrl`
  - headers
  - `body` and/or `payloadPreview`
  - `target`
- response assertions cover:
  - `status`
  - headers
  - `body` and/or `payloadPreview`
  - `durationMs`
  - `error` / `expectedFailure`
- Diagnostics Traces evidence can isolate the resulting REST entries through the Contributor filter
- Diagnostics detail content exposes the transport fields a support engineer would need

### FTP

- list, read, and write interactions all emit `ftp-operation`
- assertions cover:
  - `operation` and `command`
  - `hostname`, `port`, and `path`
  - `requestPayload` and/or `requestPayloadPreview`
  - `responsePayload` and/or `responsePayloadPreview`
  - `durationMs`
  - `result` / `error`
  - `target`
- Diagnostics Traces evidence can isolate the resulting FTP entries through the Contributor filter
- Diagnostics detail content exposes request-side and response-side detail, not just the row label

### TELNET

- all meaningful TELNET interactions emit TELNET trace evidence that includes both request-side and response-side detail
- at minimum cover:
  - health probe
  - user action execution through `useTelnetActions`
  - capability discovery or menu-navigation interactions if they touch the device and are intended to be support-visible
- assertions must cover a TELNET contract that is rich enough to debug failures and that keeps current reader-facing fields stable:
  - existing identity fields such as `actionId`, `actionLabel`, and `menuPath`
  - `hostname` / `port` if those are captured at the TELNET trace layer
  - a request-side representation such as `requestPayload` or `requestPayloadPreview` for sent key sequences, commands, or negotiation steps
  - a response-side representation such as `responsePayload` or `responsePayloadPreview` for visible text, screen reads, banners, or parsed responses
  - `durationMs`
  - `result` / `error`
  - `target`
- Diagnostics Traces evidence can isolate the resulting TELNET entries through the Contributor filter
- Diagnostics detail content exposes the request-side and response-side detail rather than only `actionLabel`

### Export / snapshots

- trace export and native debug snapshots preserve the raw `TraceEvent.data` transport details for REST, FTP, and TELNET
- derived `ActionSummary` effects do not silently drop the transport fields needed by Diagnostics
- no protocol silently loses fidelity when exported even if the compact UI row stays terse

## Non-goals

- Do not replace raw traces with action summaries.
- Do not weaken redaction rules to make TELNET “complete”.
- Do not solve this by only adding app logs.
- Do not claim coverage closure while TELNET still lacks a request/response contract.
- Do not broaden into unrelated switcher, badge, or saved-device work unless required by compile fallout.

## Suggested implementation order

### 1. Freeze the transport trace contract

- Decide whether TELNET should:
  - stay as one enriched `telnet-operation` event, or
  - split into separate request and response events similar to REST.
- Pick the smallest contract that can honestly satisfy the user requirement.
- If `telnet-operation` stays, extend it with field names that fit the current trace vocabulary and keep `actionId`, `actionLabel`, and `menuPath` stable for existing readers.
- If new TELNET `TraceEvent.type` values are introduced, update all code that currently keys off `telnet-operation`, including `traceFormatter.ts`, `DiagnosticsDialog.tsx`, `actionSummaries.ts`, and any export/snapshot readers.
- Update `src/lib/tracing/types.ts` and `src/lib/tracing/traceSession.ts` first.

### 2. Instrument all TELNET writers

Likely files:

- `src/hooks/useTelnetActions.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/telnet/telnetSession.ts`
- `src/lib/telnet/telnetCapabilityDiscovery.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetActionExecutor.ts`

Goal:

- every user-visible or support-relevant TELNET device interaction writes the richer TELNET trace data with both request-side and response-side fields

### 3. Lock writer-level tests

Required targeted test surfaces:

- `tests/unit/tracing/traceSession.test.ts`
  - assert the exact shape of REST, FTP, and new TELNET trace events
- `tests/unit/tracing/fetchTrace.test.ts`
  - keep REST coverage strong; extend if any request/response details change
- `tests/unit/lib/ftp/ftpClient.test.ts`
  - prove list/read/write all preserve request + response details
- `tests/unit/hooks/useTelnetActions.test.tsx`
  - prove TELNET action execution writes request/response-rich trace evidence
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
  - prove the TELNET health probe writes request/response-rich trace evidence

### 4. Lock Diagnostics filter and detail rendering

Required UI proof:

- `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`
  - Contributor filtering works for REST, FTP, and TELNET within the Traces evidence view
  - filtered rows remain visible under the expected transport contributor
  - expanded detail or row content exposes request-side and response-side information for all three protocols

### 5. Lock derived summaries and export behavior

Likely files:

- `src/lib/diagnostics/actionSummaries.ts`
- `tests/unit/lib/diagnostics/actionSummaries.test.ts`
- `tests/unit/tracing/traceExport.test.ts`
- `tests/unit/lib/diagnostics/nativeDebugSnapshots.test.ts`

Required proof:

- the richer transport fields remain export-safe
- `buildActionSummaries(...)` and native debug snapshot/export layers do not silently drop the fields

### 6. Build the exhaustive interaction matrix

Do not stop at one happy-path example per transport.

At minimum, create and check off a matrix covering:

- REST
  - success
  - HTTP error
  - thrown/network error
  - binary or large payload preview case
- FTP
  - list success/failure
  - read success/failure
  - write success/failure
- TELNET
  - connect/banner success
  - health probe success/failure
  - user action success/failure
  - auth or negotiation path where relevant

If any real device-interaction entrypoint remains untested, leave the matrix row open and document it explicitly.

## Suggested commands

Start narrow, then widen honestly.

Targeted transport slices:

```bash
npx vitest run tests/unit/tracing/traceSession.test.ts tests/unit/tracing/fetchTrace.test.ts tests/unit/lib/ftp/ftpClient.test.ts tests/unit/hooks/useTelnetActions.test.tsx tests/unit/lib/diagnostics/healthCheckEngine.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx tests/unit/lib/diagnostics/actionSummaries.test.ts tests/unit/tracing/traceExport.test.ts tests/unit/lib/diagnostics/nativeDebugSnapshots.test.ts
```

Then full repo validation:

```bash
npm run lint
npm run test
env -u VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON npm run test:coverage
npm run build
```

Important note:

- the current workspace previously inherited a stale `VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON` env that forced `App` tests into the device-switch lab during coverage
- clear that env for honest `test:coverage` runs unless the user explicitly wants the soak path enabled

If executable code changes remain Android-relevant, finish with:

```bash
npm run cap:build
npm run android:apk
adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk
adb -s 9B081FFAZ001WX shell am start -n uk.gleissner.c64commander/.MainActivity
```

## Files most likely to matter next

- `src/lib/tracing/types.ts`
- `src/lib/tracing/traceSession.ts`
- `src/lib/tracing/fetchTrace.ts`
- `src/lib/tracing/traceFormatter.ts`
- `src/lib/ftp/ftpClient.ts`
- `src/lib/telnet/telnetSession.ts`
- `src/lib/telnet/telnetCapabilityDiscovery.ts`
- `src/lib/telnet/telnetMenuNavigator.ts`
- `src/lib/telnet/telnetActionExecutor.ts`
- `src/hooks/useTelnetActions.ts`
- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/diagnostics/actionSummaries.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `tests/unit/tracing/traceSession.test.ts`
- `tests/unit/tracing/fetchTrace.test.ts`
- `tests/unit/lib/ftp/ftpClient.test.ts`
- `tests/unit/hooks/useTelnetActions.test.tsx`
- `tests/unit/lib/diagnostics/healthCheckEngine.test.ts`
- `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`
- `tests/unit/lib/diagnostics/actionSummaries.test.ts`
- `tests/unit/tracing/traceExport.test.ts`
- `tests/unit/lib/diagnostics/nativeDebugSnapshots.test.ts`

## Completion rule

Do not call this complete until all of the following are true:

- REST, FTP, and TELNET each have a trace contract that honestly includes request-side and response-side detail for support-relevant device interactions.
- Regression tests prove those details are emitted at the writer/caller layer.
- Diagnostics tests prove Contributor filtering finds the resulting Traces evidence under REST, FTP, and TELNET.
- Diagnostics details or equivalent UI assertions prove the request-side and response-side information is actually visible, not merely stored in a hidden field.
- Export/snapshot tests prove the transport details survive serialization.
- `npm run lint`, `npm run test`, `env -u VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON npm run test:coverage`, and `npm run build` all pass on the final tree.

If one protocol still lacks a full request/response contract, the work is not done.
