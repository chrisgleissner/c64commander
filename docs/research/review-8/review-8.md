# Review 8: Production Hardening Audit

## Scope And Method

This review audited the current repository state with emphasis on the newly added display-profile system and its productionization quality. Evidence was gathered from the current implementation, current test inventory, and the previous audit in `docs/research/review-7/review-7.md`.

Primary evidence reviewed:

- `docs/internals/display-profiles.md`
- `docs/plans/display-profiles/display-profiles-implementation-plan.md`
- `src/lib/displayProfiles.ts`
- `src/hooks/useDisplayProfile.tsx`
- `src/lib/uiPreferences.ts`
- `src/lib/modalPresentation.ts`
- `src/index.css`
- `src/components/ConnectivityIndicator.tsx`
- `playwright/displayProfiles.spec.ts`
- `playwright/playback.part2.spec.ts`
- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`
- `ios/App/App/IOSFtp.swift`
- `ios/native-tests/Sources/NativeValidation/FtpRequestNormalization.swift`
- `ios/native-tests/Tests/NativeValidationTests/FtpRequestNormalizationTests.swift`

This prompt performs review only. No product code, tests, or build scripts were changed.

## Inherited Open Items

Three review-7 items were verified as resolved in the current repository state:

1. Slider drag propagation now has an end-to-end regression proof. `playwright/playback.part2.spec.ts` contains `rapid volume drag coalesces into one write when preview interval is long`, which exercises pointer-down drag movement and verifies downstream config writes before release.
2. Connection freshness wording is no longer misleading. `src/components/ConnectivityIndicator.tsx` now labels the mixed signal as `Last activity` instead of `Last request`, which matches the underlying `Math.max(deviceState.lastRequestAtMs, snapshot.lastProbeAtMs)` computation.
3. Coverage governance is now aligned. `build`, `scripts/collect-coverage.sh`, `docs/code-coverage.md`, and `docs/developer.md` all reflect the 91% line and branch gate.

One inherited item remains open in narrower form:

1. iOS FTP parity is improved but still not at Android's proof level. The shared contract drift called out in review-7 is materially reduced because `ios/App/App/IOSFtp.swift` now consumes both `timeoutMs` and `traceContext`, and `ios/native-tests` adds normalization coverage. However, the iOS side still lacks direct plugin-level tests comparable to `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`.

## Required Fixes

### 1. Display-profile preference propagation is single-window only on web

Status: confirmed

Evidence:

- `src/lib/uiPreferences.ts` persists `c64u_display_profile_override` and dispatches only a same-window custom event: `c64u-ui-preferences-changed`.
- `src/hooks/useDisplayProfile.tsx` listens for `resize`, `orientationchange`, and `c64u-ui-preferences-changed`, but does not subscribe to the browser `storage` event.
- No `storage` event listener was found in the repository search of `src/**/*.{ts,tsx}`.

Impact:

On the self-hosted web surface, changing the display profile in one tab or window does not update other open tabs until reload. For a persistent UI preference that is presented as app-wide state, this creates avoidable operator inconsistency and weakens confidence in the preference model outside the single-window case covered by current tests.

Assessment:

This is a runtime hardening gap, not a speculative style preference. The propagation path is explicitly same-window only.

### 2. Display-profile verification claims exceed the executable evidence

Status: confirmed

Evidence:

- `docs/internals/display-profiles.md` requires verification for `layout-safe behavior with keyboard open and with increased text size or zoom` and says `primary actions remain reachable at increased text size and browser zoom`.
- `docs/plans/display-profiles/display-profiles-implementation-plan.md` marks the following as complete:
  - `Add modal tests for Compact full-screen behavior, footer visibility, and keyboard-safe layouts.`
  - `Verify primary CTAs remain reachable at increased text size and browser zoom.`
- The current executable evidence does not match those claims:
  - `playwright/displayProfiles.spec.ts` verifies overflow, CTA visibility, source order, modal presentation mode, and persistence, but does not emulate increased zoom, increased text size, or keyboard-open geometry.
  - `src/components/ui/dialog.test.tsx` and `src/components/itemSelection/ItemSelectionDialog.test.tsx` assert sticky footer classes and profile transitions, but do not verify keyboard-open viewport changes or zoom/text-scale behavior.

Impact:

The repository now has good baseline display-profile coverage, but its spec and implementation-plan checkboxes overstate what is currently proved. That is a production-readiness problem because the display-profile feature was introduced specifically to harden constrained and widened layouts; the remaining unsupported cases are exactly the accessibility and resilience cases the spec treats as non-optional.

Assessment:

This is both a documentation-drift issue and a real test-gap issue. The repository should not claim these cases are verified until executable evidence exists.

### 3. iOS FTP still lacks Android-equivalent plugin proof

Status: confirmed

Evidence:

- Android has extensive direct plugin tests in `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`.
- iOS now has request-normalization coverage in `ios/native-tests/Tests/NativeValidationTests/FtpRequestNormalizationTests.swift` and shared-option handling in `ios/App/App/IOSFtp.swift`.
- No direct iOS native test suite was found that exercises `FtpClientPlugin` behavior itself, including success paths, failure logging, timeout handling during calls, or bridge payload behavior.

Impact:

The shared JS contract is closer to parity than it was in review-7, but iOS still relies on thinner proof at the plugin boundary than Android. That leaves the platform with lower confidence in the exact surface that has to manage real FTP failures and native bridge behavior.

Assessment:

This remains the only inherited open item that still materially affects uniform all-platform production claims.

## Recommendations

1. Either add `storage` event handling for display-profile preference changes on web or explicitly scope the preference to the active tab so the UX contract matches the implementation.
2. Add executable display-profile regressions for keyboard-open and zoom/text-scale scenarios before keeping the current plan and specification language marked complete.
3. Add direct iOS plugin tests for `FtpClientPlugin` behavior so the platform boundary has proof closer to Android's current level.

## Production Risk Assessment

| Risk                                                            | Evidence                                                                                                                                                                   | Severity | Likelihood | Detectability | Assessment                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display-profile override does not propagate across tabs/windows | `src/lib/uiPreferences.ts`, `src/hooks/useDisplayProfile.tsx`                                                                                                              | Low      | Medium     | High          | The failure mode is easy to reproduce on web and limited to multi-window usage, but it breaks the persistence contract outside the single-window case. |
| Display-profile accessibility verification is overstated        | `docs/internals/display-profiles.md`, `docs/plans/display-profiles/display-profiles-implementation-plan.md`, `playwright/displayProfiles.spec.ts`, `src/components/ui/dialog.test.tsx` | Medium   | High       | Medium        | The repo claims keyboard/zoom validation without executable proof for those cases.                                                                     |
| iOS FTP plugin proof remains thinner than Android               | `ios/App/App/IOSFtp.swift`, `ios/native-tests/**`, `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`                                            | Medium   | Medium     | Medium        | Shared contract handling improved, but plugin-boundary test parity is still missing.                                                                   |

## Security Evaluation

No new security regression was found in the display-profile work. The trusted-LAN deployment assumptions remain unchanged, and the newly reviewed display-profile files are UI/state infrastructure rather than transport or credential surfaces.

The prior repository-level security constraints still apply:

- web deployment stores configuration in the mounted config volume
- device communication still depends on the firmware's HTTP and FTP model

Nothing in the display-profile implementation weakens those boundaries further.

## CI/CD Evaluation

CI/CD posture remains materially stronger than it was when review-7 was written because the coverage-governance mismatch is now resolved in the live repo state.

The remaining CI/test concern for this cycle is narrower:

- the display-profile feature has dedicated unit and Playwright coverage
- but the claimed accessibility-hardening cases are not yet represented as executable gates

That means CI is currently honest about baseline layout stability, but not yet sufficient to support the stronger keyboard/zoom verification language present in the display-profile docs and plan.

## Documentation Consistency Audit

The most important documentation issue in the current cycle is within the display-profile work itself.

Confirmed drift:

1. `docs/plans/display-profiles/display-profiles-implementation-plan.md` marks keyboard-safe modal tests and zoom/text-size verification as complete.
2. `docs/internals/display-profiles.md` treats those cases as mandatory verification obligations.
3. The current test inventory does not yet provide matching executable proof.

By contrast, the review-7 coverage threshold inconsistency has been corrected in the current repo state.

## Test Coverage Evaluation

Display-profile coverage is materially better than a minimal responsive-layout implementation:

- `src/lib/displayProfiles.test.ts` covers resolver thresholds and token expectations.
- `src/hooks/useDisplayProfile.test.tsx` covers automatic profile selection, root token application, and persisted override behavior.
- `src/components/ui/dialog.test.tsx` and `src/components/itemSelection/ItemSelectionDialog.test.tsx` cover profile-sensitive modal behavior.
- `playwright/displayProfiles.spec.ts` covers the three canonical validation viewports, overflow checks on core routes, source-order invariants, modal presentation, and override persistence.

The remaining test gaps are specific rather than broad:

1. No executable proof was found for keyboard-open dialog safety under the new profile system.
2. No executable proof was found for increased text-size or browser-zoom reachability under the new profile system.
3. No test was found for cross-window display-profile preference propagation on web.
4. iOS native FTP behavior still lacks plugin-level tests comparable to Android.

## Final Verdict

The display-profile implementation is substantially more productionized than the initial concern implied. It is centralized, token-driven, has profile-aware modal policy, and already carries focused unit and Playwright coverage.

The remaining issues are now narrower and more honest than they were in review-7:

- one inherited platform-parity item remains open on iOS FTP plugin proof
- one runtime gap exists in cross-window preference propagation on web
- one documentation-and-test gap remains where keyboard/zoom verification is claimed more strongly than the repository currently proves

Final verdict: the repository remains conditionally production-ready for its strongest surfaces, and the display-profile feature is no longer a broad architecture concern. The next productionization pass should focus on finishing the proof obligations the display-profile docs already claim, and on closing the last iOS FTP parity gap.
