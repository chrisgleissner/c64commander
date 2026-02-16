# Release Artifact Naming Standardization Plan

## Objective
Implement a clean, production-grade artifact naming scheme for GitHub Releases.

## Target Artifact Names
- `c64commander-<version>-android.apk`
- `c64commander-<version>-android.apk.sha256`
- `c64commander-<version>-android-play.aab`
- `c64commander-<version>-ios.ipa`
- `c64commander-<version>-ios.ipa.sha256`

## Artifacts to Exclude from Public Releases
- Debug APKs
- `app-release.aab` (rename to standardized name)
- Any artifact containing "debug", "unsigned", or tool-specific names like "altstore"

## Tasks

### 1. Locate Build Outputs
- [x] Identify Android APK build output location
- [x] Identify Android AAB build output location
- [x] Identify iOS IPA build output location
- [x] Document current artifact names

### 2. Analyze CI Workflows
- [x] Find APK build workflow
- [x] Find AAB build workflow
- [x] Find IPA build workflow
- [x] Find release upload workflow

### 3. Modify CI Workflows
- [x] Add APK rename step: `c64commander-${VERSION}-android.apk`
- [x] Add AAB rename step: `c64commander-${VERSION}-android-play.aab`
- [x] Add IPA rename step: `c64commander-${VERSION}-ios.ipa`
- [x] Add SHA256 checksum generation for each artifact

### 4. Filter Release Artifacts
- [x] Exclude debug APKs from release uploads
- [x] Exclude files containing "debug" or "unsigned"
- [x] Remove old `app-release.aab` naming

### 5. Update Documentation
- [x] Update README if artifact names are referenced (not needed - uses generic terms)

### 6. Validation
- [ ] Verify artifact names match required format
- [ ] Verify no debug artifacts in release
- [ ] Verify checksums are correct

## Constraints
- Do not change versioning semantics
- Do not change signing configuration
- Do not modify build contents
- Only change artifact naming and release packaging

## Implementation Summary

### Android Workflow Changes (`.github/workflows/android.yaml`)

1. **android-packaging job**:
   - Added rename step for release APK: `c64commander-${APP_VERSION}-android.apk`
   - Added SHA256 checksum generation for APK
   - Added rename step for AAB: `c64commander-${APP_VERSION}-android-play.aab`
   - Updated artifact upload paths

2. **release-artifacts job**:
   - Removed debug APK download and upload steps
   - Updated release APK path to use new naming
   - Updated AAB path to use new naming
   - Added SHA256 checksum file to release upload

### iOS Workflow Changes (`.github/workflows/ios.yaml`)

1. **ios-package-altstore job** (renamed to "iOS | Package IPA"):
   - Changed IPA naming from `c64commander-${APP_VERSION}-altstore-unsigned.ipa` to `c64commander-${APP_VERSION}-ios.ipa`
   - Updated artifact name from `ios-altstore-unsigned-ipa` to `ios-ipa`
   - SHA256 checksum already generated (kept existing logic)
