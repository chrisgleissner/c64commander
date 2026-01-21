# Code Coverage Strategy

## Overview

C64 Commander uses a comprehensive multi-language code coverage approach that tracks coverage across:

1. **TypeScript/TSX** (React UI and business logic)
2. **Kotlin** (Android native code for HVSC ingestion and native plugins)
3. **E2E tests** (Playwright for integration testing)

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

**Coverage thresholds** (baseline, aim to increase):

```typescript
{
  statements: 10,
  branches: 55,
  functions: 35,
  lines: 10
}
```

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

### E2E Testing (Playwright)

**Tool**: Playwright  
**Configuration**: `playwright.config.ts`  
**Commands**:

- `npm run test:e2e` - Run all E2E tests
- `npm run screenshots` - Generate screenshot tests

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

### CI Pipeline Coverage

The GitHub Actions workflow (`.github/workflows/android-apk.yaml`) automatically:

1. **Run TypeScript tests with coverage**:

   ```yaml
   - name: Run unit tests with coverage
     run: npm run test:coverage
   ```

2. **Run Kotlin tests with coverage**:

   ```yaml
   - name: Run Android tests with coverage
     run: |
       cd android
       ./gradlew testDebugUnitTest jacocoTestReport
   ```

3. **Run E2E tests** (for integration coverage):

   ```yaml
   - name: Run Playwright e2e tests
     run: npm run test:e2e
   ```

4. **Upload all coverage to Codecov**:

   ```yaml
   - name: Upload coverage to Codecov
     uses: codecov/codecov-action@v5
     with:
       files: ./coverage/lcov.info,./android/app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml
       flags: unittests,android
       token: ${{ secrets.CODECOV_TOKEN }}
   ```

### Codecov Integration

**Dashboard**: <https://codecov.io/gh/chrisgleissner/c64commander>

**Badge** (in README.md):

```markdown
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
```

**Flags**:

- `unittests` - TypeScript/TSX unit tests
- `android` - Kotlin/Android tests

Codecov automatically:

- Merges coverage from multiple languages
- Tracks coverage trends over time
- Comments on PRs with coverage changes
- Fails builds if coverage drops significantly (configurable)

## Coverage Goals

### Short-term (Current Baseline)

- TypeScript: 10% lines, 55% branches
- Kotlin: Establish baseline (first measurements)
- E2E: Maintain 100% of critical user paths

### Medium-term (Next Quarter)

- TypeScript: 50% lines, 70% branches
- Kotlin: 60% lines, 70% branches
- Add component-level testing for React components

### Long-term (6+ Months)

- TypeScript: 80% lines, 85% branches
- Kotlin: 80% lines, 85% branches
- Full E2E coverage of all user-facing features

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
