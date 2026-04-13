# Review 15 Remediation Plan

**Findings source:** [review-15.md](./review-15.md)
**Date started:** 2026-04-11
**Status:** Ready for implementation
**Classification:** `DOC_PLUS_CODE`, `UI_CHANGE`
**Branch convention:** `fix/review-15-<phase>-<slug>`

This plan is intentionally narrow. It is derived from the current blockers in Review 15 and should converge the production-readiness gaps without reopening already-healthy architecture.

---

## 1. Objective

Bring the app to an honest post-Review-15 release state by fixing the confirmed blockers and matching validation to the real supported product contract.

This rollout should:

- fix the default Docker/web auth contract for the documented HTTP LAN deployment path
- add automated coverage for the real production web path, not just the current test-mode branch
- make iOS Telnet support honest in the shipped UI and runtime
- restore a clean lint baseline
- re-run the highest-value validation and real-target proof where the environment supports it

This rollout should **not**:

- redesign the web server trust boundary or host-validation model
- rebuild the diagnostics or health model
- attempt a full iOS native Telnet implementation unless gating turns out to be impossible without it
- treat the earlier user-reported web connection failure as the primary bug, because Review 15 showed the real Docker/web route can reach `c64u` when built correctly with `VITE_WEB_PLATFORM=1`

---

## 2. Shipping Decision For This Rollout

Review 15 left two ways to close the platform blockers:

1. web: switch the documented deployment to HTTPS-first, or make the default HTTP LAN deployment work honestly
2. iOS: add a native `TelnetSocket` plugin, or stop exposing Telnet-backed actions on iOS

For this rollout, the narrower and lower-risk convergence path is:

- **Web:** keep the documented default LAN deployment on plain HTTP and make its auth/session behavior work by default
- **iOS:** gate unsupported Telnet-backed actions out of iOS and document the limitation honestly

If implementation reveals a hard blocker against either choice, stop and document it before widening scope.

---

## 3. Confirmed Current Blockers

### A. Web auth contract is broken in the documented Docker deployment

Review 15 confirmed:

- `README.md` documents `http://<host-ip>:8064`
- `web/Dockerfile` runs with `NODE_ENV=production`
- production mode enables secure cookies
- the auth session cookie is therefore marked `Secure`
- browsers do not send that cookie back over plain HTTP

Required end state:

- the documented default Docker/LAN deployment can authenticate successfully over its documented transport
- secure-cookie behavior remains available for an explicitly secure deployment mode
- automated tests cover the production-mode branch that currently escapes CI

Primary files:

- `web/server/src/index.ts`
- `web/server/src/authState.ts`
- `web/Dockerfile`
- `README.md`
- `tests/unit/web/webServer.test.ts`

### B. iOS exposes Telnet-backed actions without a Telnet transport

Review 15 confirmed:

- shared native-platform Telnet logic can mark actions available on iOS
- the Home page surfaces Telnet-backed controls through that shared logic
- there is no iOS `TelnetSocket` plugin

Required end state for this rollout:

- shipped iOS UI must not expose Telnet-backed actions that cannot work
- shared capability logic must represent iOS honestly
- docs must no longer imply parity for those actions if they remain unsupported

Primary files:

- `src/hooks/useTelnetActions.ts`
- `src/pages/HomePage.tsx`
- `src/lib/native/telnetSocket.ts`
- `ios/App/App/AppDelegate.swift`
- relevant iOS/native capability tests

### C. The repository is not lint-clean

Review 15 confirmed:

- `npm run lint` fails due to Prettier drift in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`

Required end state:

- the branch is clean under the standard lint command before final sign-off

Primary files:

- `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`
- any adjacent formatting fallout discovered during the rollout

---

## 4. Implementation Sequence

### Phase 0. Orient and lock scope

Goal:

- re-read the audit, classify this as executable remediation work, and confirm the chosen narrow convergence path before editing code

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/testing/maestro.md`
- `docs/research/review-15/review-15.md`
- `docs/research/review-15/plan.md`

Tasks:

- [ ] Confirm classification as `DOC_PLUS_CODE`, with `UI_CHANGE` only where iOS gating alters visible controls
- [ ] Record the chosen convergence path:
  - keep default web deployment on honest HTTP LAN semantics
  - gate iOS Telnet-backed controls instead of building a new iOS Telnet plugin in this pass
- [ ] Identify the smallest touched file set for web auth, iOS gating, tests, and docs

Exit criteria:

- the rollout path is explicit and no one starts implementing the wider alternative by accident

### Phase 1. Fix the web auth/session contract

Goal:

- make the documented default Docker/LAN deployment authenticate correctly

Tasks:

- [ ] Trace how the secure-cookie flag is currently derived in production mode
- [ ] Change the default behavior so the documented HTTP LAN deployment does not emit unusable `Secure` auth cookies
- [ ] Preserve an explicit path for secure-cookie behavior when the deployment is actually HTTPS-capable
- [ ] Keep the fix narrow to cookie/deployment contract logic; do not weaken host validation, rate limiting, or security headers
- [ ] Update any configuration naming or env-var behavior needed to make the deployment contract explicit

Required tests:

- [ ] production-mode unit test proving the default HTTP Docker/LAN path issues a usable session cookie
- [ ] production-mode unit test proving secure cookies still occur when the deployment is explicitly configured for them
- [ ] regression test proving authenticated state persists across the documented HTTP path

Exit criteria:

- the documented default Docker deployment can authenticate honestly, and the behavior is covered under the actual production-mode branch

### Phase 2. Deepen real web production-path coverage

Goal:

- make CI exercise the supported web product path closely enough that Review 15’s web blocker cannot recur unnoticed

Tasks:

- [ ] Expand web-server tests so they execute with production-mode semantics rather than only test/development semantics
- [ ] Add coverage for the Docker/web-platform build assumption that `VITE_WEB_PLATFORM=1` is required for the shipped web frontend
- [ ] Add a targeted end-to-end or integration check for the web control path that covers:
  - auth/session establishment
  - REST proxying
  - host selection / host override behavior
  - operator-visible failure reporting
- [ ] Keep this work web-focused; do not widen into full iOS parity testing from Linux

Required tests:

- [ ] targeted automated coverage for a real production-mode web path
- [ ] regression coverage for both hostname and direct-IP target forms where practical in the existing harness

Exit criteria:

- the current CI story covers the actual shipped web path materially better than it did in Review 15

### Phase 3. Make iOS Telnet support honest

Goal:

- remove the Review-15 iOS parity blocker with the minimum-risk change

Tasks:

- [ ] Trace how Telnet capability is currently surfaced for native platforms
- [ ] Gate Telnet-backed actions out of iOS at the capability layer and any UI layer that still assumes generic native support
- [ ] Confirm Home and diagnostics-adjacent surfaces no longer present unsupported Telnet affordances on iOS
- [ ] Update platform-support wording anywhere the app or docs would otherwise imply those actions work on iOS

Required tests:

- [ ] unit coverage proving iOS no longer advertises Telnet-backed actions as available
- [ ] component or hook regression coverage for affected Home-page affordances
- [ ] if existing iOS smoke tests or Maestro groupings depend on these controls, update them honestly rather than weakening assertions

Exit criteria:

- iOS no longer exposes Telnet-backed actions it cannot execute

### Phase 4. Restore release-gate cleanliness

Goal:

- return the branch to a clean release-validation baseline

Tasks:

- [ ] Fix the current Prettier drift in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts`
- [ ] Resolve any lint fallout introduced by the remediation work
- [ ] Keep the lint fix isolated; do not reformat unrelated files for convenience

Exit criteria:

- `npm run lint` passes cleanly

### Phase 5. Update docs to match shipped behavior

Goal:

- ensure product claims and operator guidance match the implemented behavior

Tasks:

- [ ] Update `README.md` if the web auth/deployment contract changes in any user-visible way
- [ ] Update any docs or built-in wording that currently overstates iOS Telnet capability
- [ ] Keep documentation changes tied directly to the runtime behavior shipped in this rollout

Exit criteria:

- docs match the implemented web and iOS platform contract

### Phase 6. Final validation and runtime proof

Goal:

- prove the blocker fixes are real and did not regress adjacent surfaces

Required command validation:

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `VITE_WEB_PLATFORM=1 npm run build`
- [ ] `npm run build:web-server`
- [ ] `cd android && ./gradlew test`

Required targeted runtime validation:

- [ ] run the production web server manually with the shipped web-platform build
- [ ] verify the password-protected web path now authenticates correctly under the documented Docker/LAN contract
- [ ] verify `/api/rest/v1/info` still proxies correctly for `c64u`
- [ ] if `192.168.1.167` or `c64u` is reachable, repeat the real-target web proof against that live device
- [ ] if the attached Pixel 4 and `c64u` are both usable, run a narrow Android real-target sanity pass to ensure no collateral damage from the web or gating work

Exit criteria:

- blocker fixes are proven by both automated validation and the smallest honest runtime pass

---

## 5. Acceptance Criteria

The rollout is complete only when all of the following are true:

- the documented default Docker/LAN web deployment can authenticate successfully
- production-mode automated tests cover the web auth/session branch that was previously untested
- the web runtime still reaches the live `c64u` target when built in web-platform mode
- iOS no longer exposes unsupported Telnet-backed controls
- platform-support docs are honest about iOS behavior
- `npm run lint` passes
- `npm run test:coverage` still satisfies the repo coverage gate
- `npm run build`, `VITE_WEB_PLATFORM=1 npm run build`, and `cd android && ./gradlew test` pass

---

## 6. Out Of Scope

Do not widen this rollout into these areas unless required by compile or test fallout:

- implementing a new iOS native `TelnetSocket` plugin
- redesigning the diagnostics surface
- broad modularization of large files called out as engineering hotspots
- full Android HIL automation
- broad new iOS CI coverage beyond what is required to keep platform claims honest

If those become desirable after blocker convergence, treat them as follow-on work rather than silently expanding Review 15 remediation.
