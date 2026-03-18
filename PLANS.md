# Diagnostics UX — Audit and Remediation Plan

Classification: `UI_CHANGE` + `CODE_CHANGE`

## Phase 1: Spec Assertions (PASS/FAIL)

| ID  | Description                                | Spec  | Status |
| --- | ------------------------------------------ | ----- | ------ |
| A01 | Single unified badge; no legacy indicators | §2.1  | PASS   |
| A02 | Connection Status popover eliminated       | §2.1  | PASS   |
| A03 | Badge health via shape (5 glyphs)          | §8.3  | PASS   |
| A04 | Badge connectivity via text label          | §8.3  | PASS   |
| A05 | Badge state matrix                         | §8.4  | PASS   |
| A06 | Badge aria-label matrix                    | §8.5  | PASS   |
| A07 | Badge min tap target 44x44                 | §8.10 | PASS   |
| A08 | Badge data-testid, data attrs              | §8.10 | PASS   |
| A09 | Overlay title/desc correct                 | §9.3  | PASS   |
| A10 | Overlay structure order                    | §9.2  | PASS   |
| A11 | Summary default expanded, reset on re-open | §10.1 | PASS   |
| A12 | Collapsed summary format                   | §10.3 | PASS   |
| A13 | Overall health row explanation phrase      | §10.4 | PASS   |
| A14 | Last activity rows visible                 | §10.5 | PASS   |
| A15 | Last activity format                       | §10.5 | PASS   |
| A16 | Contributor order App/REST/FTP             | §10.6 | PASS   |
| A17 | Contributor phrase truncation              | §10.6 | PASS   |
| A18 | Expanded contributors session totals       | §10.6 | PASS   |
| A19 | Contributor row scopes stream              | §10.7 | PASS   |
| A20 | Primary problem spotlight                  | §10.8 | PASS   |
| A21 | Spotlight constraints                      | §10.8 | PASS   |
| A22 | Spotlight scrolls to stream entry          | §10.8 | PASS   |
| A23 | Retry when Offline/Not connected           | §10.9 | PASS   |
| A24 | Retry disabled while Checking              | §10.9 | PASS   |
| A25 | "Change host in Settings" link             | §10.9 | PASS   |
| A26 | Quick-focus 4 toggles                      | §11.1 | PASS   |
| A27 | Default Problems+Actions; min 1            | §11.2 | PASS   |
| A28 | Search behind Refine on compact            | §11.3 | PASS   |
| A29 | Origin filters (User/System)               | §11.3 | PASS   |
| A30 | Indicator filter one active                | §12.4 | PASS   |
| A31 | Stream filtered by indicator               | §12.4 | PASS   |
| A32 | Presets per entry path                     | §12.7 | PASS   |
| A33 | Reset filters control                      | §12.8 | PASS   |
| A34 | Stream newest first                        | §13.1 | PASS   |
| A35 | Problem entry badges                       | §13.3 | PASS   |
| A36 | Empty session message                      | §14.1 | PASS   |
| A37 | No results message                         | §14.3 | PASS   |
| A38 | Load older entries pagination              | §15.1 | PASS   |
| A39 | Share all exports all                      | §16.1 | PASS   |
| A40 | Share filtered exports filtered            | §16.1 | PASS   |
| A41 | Clear all confirmation text                | §16.2 | PASS   |
| A42 | Fixed terminology                          | §20   | PASS   |
| A43 | No field duplication                       | §21   | PASS   |
| A44 | Compact auto-expand primary problem        | §8.9  | PASS   |
| A45 | DiagnosticsActivityIndicator deleted       | §2.1  | PASS   |
| A46 | ConnectivityIndicator deleted              | §2.1  | PASS   |
| A47 | Legacy test files removed                  | §2.1  | PASS   |

## Gap Register

| ID  | Description                                             | Status     |
| --- | ------------------------------------------------------- | ---------- |
| G14 | Branch coverage below 91% gate (90.81%)                 | IN PROGRESS |
|     | - UnifiedHealthBadge healthLabel branches not covered   |            |
|     | - DiagnosticsDialog trace indicator/origin filter gaps  |            |

## Remediation Status

| Step                                          | Status    |
| --------------------------------------------- | --------- |
| R01 Delete legacy files                       | completed |
| R02 Delete legacy tests                       | completed |
| R03 Add contributor stream filtering          | completed |
| R04 Add origin filters + Refine               | completed |
| R05 Add "Change host in Settings" link        | completed |
| R06 Fix share-filtered export                 | completed |
| R07 Spotlight scroll-to + compact auto-expand | completed |
| R08 Session totals + explanation phrase       | completed |
| R09 Reset summary on re-open                  | completed |
| R10 Add pagination                            | completed |
| R11 Update tests                              | completed |
| R12 Validate lint/test/build/coverage         | completed |
| R13 Add coverage for UnifiedHealthBadge health label branches | in-progress |
| R14 Add coverage for DiagnosticsDialog trace filter branches  | in-progress |
| R15 Re-validate coverage ≥ 91%                | pending |

## Work Log

- [prior] All spec gaps resolved (R01–R12)
- [2026-03-18] Coverage gate check: 90.81% branches (below 91% gate)
  - UnifiedHealthBadge.tsx: 58.33% branches (lines 147,149,151,154 uncovered)
  - DiagnosticsDialog.tsx: 78.64% branches (lines 873-876,879-881 uncovered)
  - Adding targeted regression tests (R13, R14)

## Verification Evidence

- **Tests**: 353 files, 4121 tests — all passing
- **Coverage**: 92.64% statements, **90.81% branches** (below 91% gate — R13/R14 in progress)
- **Lint**: 0 errors (3 warnings, pre-existing)
- **Build**: clean
- **TypeScript**: clean (no type errors)
