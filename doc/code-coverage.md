# Code Coverage Strategy

## Overview

C64 Commander uses a comprehensive multi-language code coverage approach that tracks coverage across:

1. **TypeScript/TSX unit coverage** (Vitest + V8)
2. **Web E2E/browser coverage** merged into the web LCOV artifact during CI
3. **Kotlin/Java Android coverage** (JaCoCo for Android unit tests)
4. **Python agent coverage** (`pytest --cov --cov-branch`)
5. **Swift native iOS coverage** (SwiftPM/Xcode -> lcov in the iOS workflow)

All coverage reports are aggregated and submitted to [Codecov](https://codecov.io/gh/chrisgleissner/c64commander) for unified tracking and visualization.

## Coverage Tools

### TypeScript/TSX Coverage (Vitest + V8)

**Tool**: Vitest with V8 coverage provider
**Configuration**: `vitest.config.ts`
**Command**: `npm run test:coverage`

**What's covered**:

- All TypeScript files in `src/**/*.{ts,tsx}`
- Excludes: test files, type definitions, config files, `main.tsx`

**Reporters**:

- `text` - Console output during test runs
- `lcov` - LCOV format for Codecov upload (`coverage/lcov.info`)
- `html` - Human-readable HTML report (`coverage/index.html`)
- `json` - Machine-readable JSON report (`coverage/coverage-final.json`)

**Coverage gate**:

- `vitest.config.ts` intentionally does **not** enforce internal thresholds.
- CI enforces **91% line coverage** and **91% branch coverage** through `scripts/check-coverage-threshold.mjs`.
- The default gate input is `coverage/lcov-merged.info`, with fallback to `coverage/lcov.info` when the merged file is not present.

### Kotlin Coverage (Jacoco)

**Tool**: Jacoco via Gradle
**Configuration**: `android/app/build.gradle`
**Command**: `cd android && ./gradlew testDebugUnitTest jacocoTestReport`

**What's covered**:

- All Kotlin source files in `android/app/src/main/java/`
- Excludes: R.class, BuildConfig, Manifest, test files, android framework classes

**Reports**:

- `xml` - XML format for Codecov upload (`android/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml`)
- `html` - Human-readable HTML report (`android/app/build/reports/jacoco/jacocoTestReport/html/`)

**Test files**:

- Unit tests: `android/app/src/test/java/`
- Integration tests: `android/app/src/androidTest/java/`

### E2E and merged web coverage (Playwright + NYC)

**Tool**: Playwright
**Configuration**: `playwright.config.ts`
**Commands**:

- `npm run test:e2e` - Run Playwright tests
- `npm run screenshots` - Run screenshot-specific Playwright coverage
- `scripts/collect-coverage.sh` - Build the merged LCOV artifact used by CI

**What's covered**:

- Full user workflows across all pages
- Configuration management
- Disk management and file operations
- Music playback and controls
- HVSC integration
- FTP operations

**Test specs**: `playwright/**/*.spec.ts`

## Coverage Aggregation & Upload

### Local Coverage

**TypeScript/TSX**:

```bash
npm run test:coverage
```

View report: `open coverage/index.html`

**Kotlin**:

```bash
cd android
./gradlew testDebugUnitTest jacocoTestReport
```

View report: `open app/build/reports/jacoco/jacocoTestReport/html/index.html`

### CI pipeline coverage

The Android workflow (`.github/workflows/android.yaml`) currently:

1. runs `npm run test:coverage`
2. builds with browser coverage probes enabled
3. runs Playwright to produce browser coverage
4. merges LCOV into `coverage/lcov-merged.info`
5. validates artifacts with `scripts/verify-coverage-artifacts.mjs`
6. enforces the 91% line/branch gate with `scripts/check-coverage-threshold.mjs`
7. uploads merged web LCOV, Android JaCoCo XML, and Python agent coverage XML to Codecov

The iOS workflow (`.github/workflows/ios.yaml`) exports Swift coverage to `ios/native-tests/swift-lcov.info` and uploads it to Codecov under the `swift` flag.

### CI threshold policy

- The enforced web gate uses **merged LCOV** (`coverage/lcov-merged.info`) in the Android workflow.
- `scripts/check-coverage-threshold.mjs` also supports a local/unit-only fallback to `coverage/lcov.info`.
- `scripts/report-coverage.mjs` and `scripts/verify-coverage-artifacts.mjs` operate on the same merged-artifact model.

### Codecov Integration

**Dashboard**: <https://codecov.io/gh/chrisgleissner/c64commander>

**Badge** (in README.md):

```markdown
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
```

**Flags**:

- `web` - merged web LCOV upload
- `android` - Android JaCoCo upload
- `python` - Python agent coverage upload
- `swift` - iOS native coverage upload

Codecov automatically:

- Merges coverage from multiple languages
- Tracks coverage trends over time
- Comments on PRs with coverage changes
- Fails builds if coverage drops significantly (configurable)

## Current enforcement summary

- Web coverage gate: **91% lines / 91% branches** on merged LCOV
- Python agent gate: branch coverage is enforced in CI via `pytest --cov-branch`
- Android and iOS native coverage are uploaded for visibility and review
- Playwright coverage contributes to the merged web artifact rather than using a separate threshold file

## Best Practices

1. **Write tests first** for new features (TDD)
2. **Run coverage locally** before committing
3. **Never skip tests** or comment out failing code
4. **Fix root causes** of test failures, don't mask them
5. **Keep tests fast** - unit tests should run in seconds
6. **Use mocks judiciously** - prefer real implementations when possible
7. **Test edge cases** - null values, empty arrays, error conditions
8. **Document complex test scenarios** with comments

## Testing Stack

### Unit Testing

- **Vitest** - Fast, modern test runner for TypeScript/TSX
- **React Testing Library** - Component testing utilities
- **JUnit** - Kotlin unit tests

### Integration Testing

- **Playwright** - E2E testing with real browser automation
- **Mock servers** - `mockC64Server.ts`, `mockFtpServer.ts`
- **Test fixtures** - Realistic test data in `playwright/fixtures/`

### Coverage Reporting

- **V8** - Built-in coverage for V8 engine (TypeScript)
- **Jacoco** - Industry-standard for JVM (Kotlin)
- **Codecov** - Unified coverage dashboard and CI integration

## Troubleshooting

### Coverage Not Generated

**TypeScript**:

```bash
# Clean coverage directory
rm -rf coverage
npm run test:coverage
```

**Kotlin**:

```bash
# Clean build directory
cd android
./gradlew clean
./gradlew testDebugUnitTest jacocoTestReport
```

### Coverage Upload Fails

Check Codecov token:

```bash
echo $CODECOV_TOKEN
```

Verify files exist:

```bash
ls -la coverage/lcov.info
ls -la android/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml
```

### Low Coverage for New Code

1. Check what's not covered:

   ```bash
   npm run test:coverage
   open coverage/index.html
   ```

2. Identify missing tests for:
   - Branches (if/else, switch, ternary)
   - Error handling (catch blocks)
   - Edge cases (null, empty, invalid input)

3. Add targeted tests:

   ```typescript
   describe('new feature', () => {
     it('handles error case', () => {
       expect(() => myFunction(null)).toThrow();
     });
   });
   ```

## Resources

- [Vitest Coverage](https://vitest.dev/guide/coverage)
- [Jacoco Documentation](https://www.jacoco.org/jacoco/trunk/doc/)
- [Codecov Documentation](https://docs.codecov.com/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
