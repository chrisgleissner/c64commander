# Dual-Resolution Testing Infrastructure

## Overview

The Playwright E2E test suite now supports automated testing across two Android device profiles:

- **android-phone** (Playwright Pixel 5 preset): 393×727 CSS px @ 2.75 device scale (≈1080×2000 physical, default for all tests)
- **android-tablet**: 1600×2560, scale 2 (layout tests only by default)

## Default Behavior

Without any configuration, the test suite runs:

- **Phone**: All tests
- **Tablet**: Only tests marked with `@layout` tag

This ensures layout-critical tests are validated on both screen sizes while keeping CI time reasonable.

## Marking Layout-Sensitive Tests

To mark a test as layout-sensitive, add `@layout` to its title:

```typescript
import { layoutTest } from './layoutTest';

layoutTest('my dialog stays within viewport @layout', async ({ page }) => {
  // Test implementation
});
```

## Device Selection

### Environment Variable

Set `PLAYWRIGHT_DEVICES` to control which devices run:

```bash
# Run only phone tests
PLAYWRIGHT_DEVICES=phone npx playwright test

# Run only tablet tests (all tests, not just layout)
PLAYWRIGHT_DEVICES=tablet npx playwright test

# Run both explicitly
PLAYWRIGHT_DEVICES=phone,tablet npx playwright test

# Alias for phone,tablet
PLAYWRIGHT_DEVICES=all npx playwright test
```

### CLI Flag (local-build.sh)

```bash
# Run E2E tests on tablet only
./local-build.sh --test-e2e --devices tablet

# Run full CI mirror on both devices
./local-build.sh --test-e2e-ci --devices phone,tablet
```

## No-Clipping Invariant

The `assertNoUiIssues` function now includes automatic horizontal overflow detection:

- Checks all rendered elements against viewport width
- Fails tests if any element extends beyond the viewport
- Provides diagnostic information about overflowing elements

This runs automatically in tests using `startStrictUiMonitoring` + `assertNoUiIssues`.

## Screenshot Organization

Screenshots are organized under the canonical evidence structure:

```text
test-results/evidence/
  playwright/
    <testId>/
      android-phone/
        screenshots/
          01-step.png
      android-tablet/
        screenshots/
          01-step.png
```

This allows visual comparison across devices without name collisions.

## CI Integration

The dual-resolution infrastructure is fully integrated with existing CI workflows:

- Default CI runs: phone for all tests, tablet for layout tests
- Evidence validation automatically handles device-prefixed directories
- Coverage collection works across both device profiles

## Adding New Layout Tests

1. Identify tests that validate:
   - Dialogs and modals
   - File/disk browsers
   - Playlist rendering
   - Path display
   - Any UI that adapts to screen width

2. Convert to `layoutTest` and add `@layout` tag to title

3. Run locally on both devices to verify:

   ```bash
   npx playwright test my-test.spec.ts --project=android-phone
   npx playwright test my-test.spec.ts --project=android-tablet
   ```

## Performance Impact

- Default runs add ~10 extra tests (layout tests on tablet)
- Minimal CI time increase (~5-10 seconds)
- Full dual-device runs (with `--devices all`) approximately double E2E time
