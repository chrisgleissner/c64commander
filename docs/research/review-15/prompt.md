# Review 15 Remediation Prompt

Date: 2026-04-11
Type: Implementation prompt
Primary inputs:

- [review-15.md](./review-15.md)
- [plan.md](./plan.md)

## Role

You are the implementation engineer closing the confirmed production-readiness blockers from Review 15 for **C64 Commander**.

This is an **implementation task**, not another audit.

Do not re-review the entire app from scratch.
Do not reopen already-healthy architecture unless the chosen fixes require a narrow follow-on change.

## Objective

Implement the smallest coherent change set that converges the current Review 15 blockers:

1. fix the default Docker/web auth contract for the documented HTTP LAN deployment path
2. add automated coverage for the real production web path
3. make iOS Telnet support honest by gating unsupported Telnet-backed controls out of iOS in this rollout
4. restore a clean lint baseline
5. update docs so the shipped platform contract is truthful

## Read First

- `README.md`
- `.github/copilot-instructions.md`
- `docs/testing/maestro.md`
- `docs/research/review-15/review-15.md`
- `docs/research/review-15/plan.md`

Then read the smallest relevant set from:

- `web/server/src/index.ts`
- `web/server/src/authState.ts`
- `web/server/src/securityHeaders.ts`
- `web/server/src/hostValidation.ts`
- `web/Dockerfile`
- `tests/unit/web/webServer.test.ts`
- `src/hooks/useTelnetActions.ts`
- `src/pages/HomePage.tsx`
- `src/lib/native/telnetSocket.ts`
- `ios/App/App/AppDelegate.swift`
- relevant tests under `tests/unit/`, `.maestro/`, and iOS/native coverage surfaces
- `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`

## Current State To Preserve

These behaviors are already correct and must remain intact:

- the Docker/web path can reach a real `c64u` target when the frontend is built in actual web-platform mode with `VITE_WEB_PLATFORM=1`
- the web server’s CSP, host validation, and auth rate limiting are valuable and should not be weakened
- Android behavior is the closest thing to the shipping reference and should not regress
- the diagnostics and health model improvements called out in Review 15 should remain intact
- iOS has real native surfaces for HVSC, secure storage, FTP, background execution, and diagnostics; this rollout is only about making Telnet support honest

## Required Implementation Decisions

### 1. Web: keep the documented default LAN contract honest

The repository currently documents the web product as a plain-HTTP LAN deployment.

For this rollout:

- do **not** convert the default product story to HTTPS-first unless the existing implementation makes the HTTP LAN path impossible to fix cleanly
- instead, make the default documented HTTP LAN deployment authenticate correctly
- keep secure-cookie behavior available for an explicitly secure deployment mode

This means:

- the default Docker production path must no longer emit an unusable `Secure` auth cookie for the documented plain-HTTP deployment
- tests must cover the actual production-mode branch that caused the Review 15 blocker

### 2. iOS: choose honest gating, not a new native Telnet plugin

For this rollout:

- do **not** build a new iOS `TelnetSocket` plugin unless gating turns out to be impossible without wider regression
- remove or disable unsupported Telnet-backed affordances on iOS at the capability layer and any UI layer that still exposes them
- update docs or platform wording if needed so iOS claims stay honest

### 3. Keep scope tight

Do not widen into:

- a broad web runtime redesign
- a diagnostics redesign
- a new iOS parity program
- large-file modularization unrelated to the blockers

## Required Changes

### A. Fix the web auth/session contract

Implement the minimum coherent server-side change so that the documented default Docker/LAN deployment can authenticate over plain HTTP.

At minimum:

- trace how the secure-cookie flag is currently derived
- adjust the default contract so password-protected sessions work in the documented HTTP LAN mode
- preserve an explicit path for secure-cookie behavior in secure deployments
- keep README and configuration semantics aligned with the actual runtime behavior

### B. Add real production-mode web coverage

Add coverage that would have caught the Review 15 web blocker.

At minimum:

- cover production-mode cookie behavior in `tests/unit/web/webServer.test.ts` or an adjacent targeted test file
- prove the documented default HTTP mode is authenticated successfully
- prove the explicitly secure mode still emits secure cookies when intended
- add the smallest honest automated coverage for the web control path beyond raw mock-only auth checks

### C. Make iOS Telnet honesty explicit in code

At minimum:

- update shared Telnet capability logic so iOS does not advertise unsupported Telnet-backed actions
- ensure the relevant Home-page actions no longer appear as available on iOS
- keep Android/native behavior intact
- keep web/native fallback logic coherent

### D. Restore lint cleanliness

At minimum:

- fix the current Prettier drift in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`
- resolve any lint fallout introduced by the remediation work

### E. Update docs to match shipped behavior

At minimum:

- update `README.md` if the web auth/deployment contract changes in any user-visible way
- update any iOS/platform-support wording needed to keep claims honest

## Minimum Acceptance Criteria

- the documented default Docker/LAN deployment can authenticate successfully over plain HTTP
- production-mode automated tests cover the web auth branch that was previously untested
- secure-cookie behavior still exists for an explicitly secure deployment mode
- iOS no longer exposes Telnet-backed controls it cannot execute
- Android behavior is not regressed by the iOS gating change
- `npm run lint` passes
- docs match the implemented platform contract

## Validation

Run the smallest honest executable validation set required by the repo rules:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- `VITE_WEB_PLATFORM=1 npm run build`
- `npm run build:web-server`
- `cd android && ./gradlew test`

Then run targeted runtime validation where practical:

- run the production web server manually with the web-platform build
- verify the password-protected HTTP LAN path now authenticates successfully
- verify `/api/rest/v1/info` still proxies for `c64u`
- if `c64u` or `192.168.1.167` is reachable, exercise the real-target web path
- if the attached Pixel 4 and reachable `c64u` are both usable, run a narrow Android sanity pass to ensure no collateral regression

Do not claim validation you did not run.

## Failure Rules

Stop and report a blocker if any of these turn out to be true:

1. the existing web auth design cannot support honest plain-HTTP LAN deployment without a wider product-contract change
2. iOS Telnet affordances are wired so deeply into shared flows that honest gating requires a much broader redesign
3. the only way to preserve platform correctness is to implement a real iOS Telnet plugin in this same pass

If blocked, report the narrowest reason and the specific file boundaries that force wider scope.
