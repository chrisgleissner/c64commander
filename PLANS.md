# Release Artifact Naming Standardization Plan

## Objective
Standardize public GitHub Release artifact names for Android and iOS and remove internal/CI-style names from published assets.

## Required Public Artifact Names
- `c64commander-<version>-android.apk`
- `c64commander-<version>-android.apk.sha256`
- `c64commander-<version>-android-play.aab`
- `c64commander-<version>-ios.ipa`
- `c64commander-<version>-ios.ipa.sha256`

## Constraints
- Keep versioning semantics unchanged
- Keep signing configuration unchanged
- Keep build contents unchanged
- Change only artifact naming and release packaging
- Keep CI logic intact unless required for renaming/filtering

## Execution Tasks
1. Locate Android and iOS build outputs.
2. Identify current artifact names and upload paths.
3. Modify CI workflows to rename APK, AAB, and IPA before upload.
4. Remove debug artifacts from release publishing.
5. Exclude artifacts containing `debug` or `unsigned` from published release assets.
6. Update checksum generation logic to:
   - `sha256sum <artifact> > <artifact>.sha256`
7. Ensure release uploads publish only standardized artifacts.
8. Update README references if artifact names are documented.
9. Validate dry-run outputs and checksum correctness.

## Validation Steps
- Run web build/test checks required by repository policy.
- Validate workflow YAML references only standardized release filenames.
- Confirm no uploaded release asset path contains `debug`, `unsigned`, `altstore`, or `app-release.aab`.
- Confirm checksum commands use `sha256sum <artifact> > <artifact>.sha256`.
- Confirm final expected release asset set is exactly:
  - `c64commander-<version>-android.apk`
  - `c64commander-<version>-android.apk.sha256`
  - `c64commander-<version>-android-play.aab`
  - `c64commander-<version>-ios.ipa`
  - `c64commander-<version>-ios.ipa.sha256`
