# C64 Commander Developer Guide

This guide covers development workflows for C64 Commander contributors.

## Prerequisites

- Node.js 18+ and npm
- JDK 17 (for Android builds)
- Android SDK (for device builds)
- git

## Quick start

Clone the repository and build:

```bash
git clone https://github.com/chrisgleissner/c64commander.git
cd c64commander
./local-build.sh
```

This runs the full build pipeline: dependencies, web build, Capacitor sync, tests, and debug APK.

## local-build.sh - One-stop build tool

All common development tasks use `./local-build.sh`:

### Build variants

```bash
./local-build.sh                  # Full build: deps, build, test, APK
./local-build.sh --skip-tests     # Skip all tests
./local-build.sh --skip-apk       # Build without APK generation
```

### Testing

```bash
./local-build.sh --test           # Unit tests only (vitest)
./local-build.sh --test-e2e       # E2E tests only (Playwright, no screenshots)
./local-build.sh --test-e2e-ci    # Full CI mirror: screenshots + e2e + validation
./local-build.sh --validate-evidence  # Validate Playwright evidence structure
```

### Android

```bash
./local-build.sh --emulator       # Launch Android emulator
./local-build.sh --install        # Build and install APK to connected device
./local-build.sh --device R5CRC3ZY9XH --install  # Install to specific device
```

### Screenshots

```bash
./local-build.sh --screenshots    # Update app screenshots in doc/img
```

## Test architecture

### Unit tests (Vitest)

Location: `tests/unit/`, component tests in `src/**/*.test.ts`

Run:
```bash
./local-build.sh --test
```

### E2E tests (Playwright)

Location: `playwright/*.spec.ts`

Key concepts:
- Strict UI monitoring: tests fail on console warnings/errors
- Evidence folders: `test-results/evidence/<describe>--<test>/`
- Numbered screenshots: `01-step.png`, `02-step.png`, etc.
- Video recording: `video.webm` per test
- Trace files: `trace.zip` for debugging

Run:
```bash
./local-build.sh --test-e2e           # E2E only
./local-build.sh --test-e2e-ci        # Full CI mirror
./local-build.sh --validate-evidence  # Validate evidence structure
```

Evidence structure:
```
test-results/
  evidence/
    <describe-slug>--<test-slug>/
      01-<step>.png
      02-<step>.png
      ...
      video.webm
      trace.zip
      error-context.md  (only on failure)
playwright-report/
  index.html
```

### Android JVM tests

Location: `android/app/src/test/java/`

Run:
```bash
cd android && ./gradlew test
```

## Evidence validation

Validate that all test evidence folders have correct structure:

```bash
./local-build.sh --validate-evidence
```

Checks:
- Every folder has at least one PNG
- Every folder has exactly one video.webm
- All files have valid signatures (PNG/WEBM/ZIP)
- No zero-byte files

## CI workflow

CI runs on every push with two parallel jobs:
1. **Web tests** (unit + Playwright) producing Playwright evidence + report
2. **Android build** (Gradle tests + APK/AAB)

Artifacts:
- `playwright-test-results` - Evidence folders + raw Playwright outputs
- `playwright-report` - HTML test report
- `c64-commander-debug-apk` - Debug APK
- Release APK/AAB artifacts on tag builds when signing secrets are present

Performance notes:
- `PLAYWRIGHT_SKIP_BUILD=1` lets Playwright reuse a prebuilt `dist/` (build first).
- The workflow supports a `package_manager` input for `workflow_dispatch` to compare `npm` vs `bun` install speed.

Download artifacts:

```bash
gh run list --workflow android-apk.yaml --limit 5
gh run download <run-id> --name playwright-evidence --dir /tmp/c64-evidence
gh run download <run-id> --name playwright-report --dir /tmp/c64-report
```

Validate downloaded evidence:

```bash
cd /tmp/c64-evidence
node /path/to/c64commander/scripts/validate-playwright-evidence.mjs
```

## Mock mode (internal testing)

The app includes a developer mode with mocked C64U REST + FTP servers:

1. Open Settings → About section
2. Tap 7 times quickly to unlock developer mode
3. Enable "Mock C64U" toggle
4. App connects to 127.0.0.1 with fixture-backed mock servers

Fixtures:
- REST config: `tests/mocks/mockC64Server.ts`
- FTP files: `playwright/fixtures/ftp-root/`

## Project structure

```
src/
  components/       # React components
  hooks/            # React hooks
  lib/              # Core logic
  pages/            # Route pages
  types/            # TypeScript types

playwright/         # E2E tests
tests/              # Unit tests
android/            # Android/Capacitor project
doc/                # Documentation
scripts/            # Build scripts
```

## Code conventions

- **TypeScript** for all source code
- **React** with hooks (no class components)
- **TanStack Query** for server state
- **Tailwind CSS** for styling
- **Shadcn/ui** for component library
- **Vitest** for unit tests
- **Playwright** for E2E tests

## Adding E2E tests

1. Create test file in `playwright/*.spec.ts`
2. Use helper functions from `playwright/testArtifacts.ts`:
   - `startStrictUiMonitoring(page, testInfo)` in beforeEach
   - `attachStepScreenshot(page, testInfo, 'step-name')` for screenshots
   - `assertNoUiIssues(page, testInfo)` in afterEach
   - `finalizeEvidence(page, testInfo)` in afterEach
   - `allowWarnings(testInfo, 'reason')` for expected errors

Example:

```typescript
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('My feature', () => {
  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  test('does something', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/');
    await attachStepScreenshot(page, testInfo, 'initial-state');
    
    await page.click('[data-testid="my-button"]');
    await attachStepScreenshot(page, testInfo, 'after-click');
    
    await expect(page.locator('[data-testid="result"]')).toBeVisible();
    await attachStepScreenshot(page, testInfo, 'final-state');
  });
});
```

## Troubleshooting

### Playwright install fails

```bash
npx playwright install
```

### Android build fails with Gradle errors

```bash
cd android
./gradlew clean
cd ..
./local-build.sh
```

### Tests fail with "Port 4173 already in use"

```bash
lsof -i :4173  # Find process
kill <PID>     # Kill it
```

### Evidence validation fails

Check for missing videos or corrupted files:

```bash
find test-results/evidence -name "video.webm" | wc -l  # Should match test count
find test-results/evidence -name "*.png" -size 0       # Should be empty
```

## Contributing

1. Create feature branch
2. Make changes
3. Run full build: `./local-build.sh --test-e2e-ci`
4. Ensure all tests pass
5. Commit and push
6. Create pull request
7. Wait for CI to pass

## Release process

Releases are created via GitHub Actions on tag push:

```bash
git tag v0.2.0
git push origin v0.2.0
```

CI builds and uploads APK to the release.
