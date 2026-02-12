# iOS CI Introduction Plan (AltStore-first)

Based on: `doc/research/ios-porting-research.md`

## Outcome

Deliver an iOS app pipeline that is usable end-to-end without local macOS or an owned iOS device:

- CI builds and tests iOS on GitHub-hosted macOS runners.
- CI publishes an unsigned AltStore IPA artifact.
- CI runs a focused iOS-native Maestro regression set and publishes iOS screenshot artifacts.
- `README.md` contains clear iOS installation instructions (AltStore path) and operator notes.
- Android remains the primary release path and is not blocked by iOS optional lanes during rollout.

## Scope and constraints

- AltStore-first distribution; paid Apple Developer signing lane is prewired but disabled.
- iOS baseline compatibility: iOS 17/18, prefer iOS 26 runtime when available on runner.
- Docker on Linux is out of scope for iOS simulator execution.
- iOS Demo Mode is deferred; Android Demo Mode remains unchanged.
- Keep Android/iOS divergence minimal by preserving existing TS bridge contracts.

## Plan interaction protocol

### Common required reading

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `README.md`
- `doc/research/ios-porting-research.md`
- `doc/testing/maestro.md`

### Execution rule

- Complete phases in order.
- Do not start a phase before the previous phase done-when criteria are met.
- Keep all iOS CI behavior deterministic (explicit runtime/device selection, explicit artifacts).

## Phase 1: Bootstrap iOS platform in repo

**Goal**: Add deterministic Capacitor iOS project scaffolding that can be built by CI.

**Primary references**:

- `package.json`
- `capacitor.config.*`
- `ios/App/App.xcworkspace` (generated)
- `ios/App/App/Info.plist`

### Tasks

- Generate and commit iOS platform:
  - `npm run build`
  - `npx cap add ios`
  - `npx cap sync ios`
- Add deterministic npm scripts in `package.json`:
  - `cap:add:ios`, `cap:sync:ios`, `cap:open:ios`, `ios:build:sim`, `ios:build:device`
- Ensure app id/name remain sourced from Capacitor config and not duplicated.
- Add ATS baseline entries in `ios/App/App/Info.plist` for local C64U HTTP access.

### Done when

- Clean checkout can run `npx cap sync ios` successfully.
- iOS workspace exists in repo and simulator build command can run on macOS.

## Phase 2: Create GitHub iOS CI workflow skeleton

**Goal**: Introduce a dedicated workflow that builds iOS simulator artifacts deterministically.

**Primary references**:

- `.github/workflows/android-apk.yaml`
- `.github/workflows/ios-ci.yaml` (new)

### Tasks

- Create `.github/workflows/ios-ci.yaml` with jobs:
  - `ios-prepare`
  - `ios-build-simulator`
- Configure triggers:
  - `pull_request`, `push` on `main`, `workflow_dispatch`, optional tag trigger.
- Implement runtime resolver in workflow:
  - List runtimes via `xcrun simctl list runtimes`
  - Select runtime with policy `26 -> 18 -> 17 -> fail`
- Pin simulator device policy:
  - Prefer `iPhone 13`; fail with diagnostics if unavailable.
- Publish build artifact:
  - `ios/build/Build/Products/Debug-iphonesimulator/App.app`

### Done when

- PR workflow builds simulator app on macOS runner.
- Job logs show selected Xcode, runtime, and simulator UDID.

## Phase 3: Implement minimum iOS native parity for usable app flows

**Goal**: Enable high-value flows on iOS without UI forks.

**Primary references**:

- `src/lib/native/folderPicker.ts`
- `src/lib/native/ftpClient.ts`
- `src/lib/native/secureStorage.ts`
- `src/lib/native/secureStorage.ios.ts`
- `src/lib/native/featureFlags.ts`
- `src/lib/native/backgroundExecution.ts`
- `src/lib/native/diagnosticsBridge.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt` (plugin contract reference)
- `ios/App/App/` (new plugin implementations)

### Tasks

- Add iOS native plugin implementations with same method contracts and plugin names for:
  - Folder picker and tree/file operations.
  - FTP list/read operations.
  - Secure storage backed by Keychain.
  - Feature flags backed by UserDefaults.
- Keep background execution behavior explicit on iOS:
  - No-op allowed initially, but deterministic logging required.
- Keep diagnostics bridge optional on iOS, but remove any silent catch behavior.
- Do not introduce page-level Android/iOS forks unless functionally unavoidable.

### Done when

- iOS simulator supports launch + local import + FTP browse + credential persistence.
- No iOS-touching path has silent exception swallowing.

## Phase 4: Add iOS Maestro gating and screenshot artifacts

**Goal**: Add focused iOS CI regression coverage and realistic screenshot output.

**Primary references**:

- `.maestro/config.yaml`
- `.maestro/` (existing Android flows)
- `doc/testing/maestro.md`
- `.github/workflows/ios-ci.yaml`
- `test-results/evidence/`

### Tasks

- Add iOS-tagged Maestro flows and subflows:
  - `ios-smoke-launch`
  - `ios-local-import`
  - `ios-ftp-browse`
  - `ios-secure-storage-persist`
  - `ios-diagnostics-export`
  - `ios-playback-basics`
- Define tags:
  - `ios`, `ci-critical-ios`, optional `slow`.
- Extend workflow with `ios-maestro-critical` job:
  - Run `maestro test .maestro --include-tags ios,ci-critical-ios --format junit --output test-results/maestro/ios-junit.xml`
- Extend workflow with `ios-screenshots` job:
  - Use Maestro `takeScreenshot` plus `xcrun simctl io <udid> screenshot ...` at deterministic checkpoints.
- Publish artifacts only (no auto-commit):
  - `test-results/maestro/**`
  - `test-results/evidence/maestro/**`
  - `test-results/artifacts/ios-screenshots/**`

### Done when

- iOS Maestro critical suite runs on PR CI and fails the lane on regression.
- iOS screenshot bundle is available as downloadable CI artifact.

## Phase 5: Add AltStore packaging and disabled paid-signing lane

**Goal**: Produce usable install artifact now, and keep paid path ready for one-switch activation.

**Primary references**:

- `.github/workflows/ios-ci.yaml`
- `README.md`

### Tasks

- Add `ios-package-altstore` job to create unsigned IPA:
  - Archive with `CODE_SIGNING_ALLOWED=NO`.
  - Build `Payload/App.app` and zip to `c64commander-altstore-unsigned.ipa`.
  - Publish checksum file.
- Add disabled `ios-package-paid` job:
  - Gate with `if: vars.IOS_PAID_SIGNING_ENABLED == 'true'`.
  - Document required secrets/vars in workflow comments and README.
- Ensure tag-trigger path publishes IPA artifacts for release consumption.

### Done when

- CI produces downloadable unsigned IPA + checksum.
- Paid-signing lane is present but inert by default.

## Phase 6: README installation and operator documentation

**Goal**: Make iOS artifact readily usable by end users and testers.

**Primary references**:

- `README.md`
- `doc/research/ios-porting-research.md`

### Tasks

- Add iOS installation chapter to `README.md`:
  - Prerequisites: AltStore on iPhone and Apple ID constraints.
  - Download IPA artifact from GitHub Actions/Release.
  - Install via AltStore.
  - Re-sign/refresh expectations (7-day cadence for free Apple ID).
- Add iOS troubleshooting subsection:
  - Expired app signature.
  - App ID/free-account limit issues.
  - Runtime compatibility note (validated on iOS 17/18 CI matrix policy).
- Keep Android install section unchanged as primary path.

### Done when

- A new tester without local macOS can install the CI-produced IPA using README steps only.
- README clearly states current support scope and known AltStore constraints.

## Phase 7: Rollout policy and quality gates

**Goal**: Introduce iOS CI without destabilizing existing Android delivery.

**Primary references**:

- `.github/workflows/android-apk.yaml`
- `.github/workflows/ios-ci.yaml`
- `README.md`

### Tasks

- Stage gate policy:
  - Stage A: iOS jobs informative (non-blocking) until first stable week.
  - Stage B: `ios-build-simulator` + `ios-maestro-critical` required for PR merge.
  - Stage C: `ios-package-altstore` required on tags.
- Keep Android workflow and release criteria unchanged throughout rollout.
- Add failure triage checklist in workflow comments:
  - runtime missing, simulator unavailable, Maestro selector drift, packaging errors.

### Done when

- iOS lanes are stable for one week of PR traffic.
- Required checks policy is enabled for chosen iOS jobs.

## Definition of done (program-level)

The plan is complete when all conditions are true:

- `ios/` platform is committed and synchronized by CI.
- `.github/workflows/ios-ci.yaml` runs simulator build, iOS Maestro critical flows, iOS screenshots, and AltStore IPA packaging.
- CI artifacts include:
  - simulator `.app`
  - iOS Maestro results/evidence
  - iOS screenshot pack
  - `c64commander-altstore-unsigned.ipa` + checksum
- `README.md` includes iOS installation and troubleshooting instructions for AltStore.
- Paid signing path exists but remains disabled by default.
- Android remains primary and unaffected.

## Tracking checklist

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 complete
- [x] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete
