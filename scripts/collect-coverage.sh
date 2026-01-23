#!/bin/bash
set -e

echo "==> Collecting coverage from all sources..."

# 0. Clean prior coverage output
rm -rf .nyc_output coverage/e2e coverage/merged coverage/lcov-merged.info

# 1. Run unit tests with coverage
echo "==> Running unit tests with coverage..."
npm run test:coverage

# 2. Ensure E2E coverage directory exists
mkdir -p .nyc_output

# 3. Build coverage-instrumented assets for Playwright
echo "==> Building web app for E2E coverage..."
VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 npm run build

# 4. Run E2E tests (which will collect coverage via Istanbul instrumentation)
echo "==> Running E2E tests with coverage..."
VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 PLAYWRIGHT_SKIP_BUILD=1 npm run test:e2e

# 5. Generate E2E coverage report
echo "==> Generating E2E coverage report..."
npx nyc report \
  --temp-dir .nyc_output \
  --report-dir coverage/e2e \
  --reporter=lcov \
  --reporter=text-summary

# 6. Merge unit + E2E LCOV for Codecov
echo "==> Merging LCOV reports for Codecov..."
npx lcov-result-merger \
  "coverage/{lcov.info,e2e/lcov.info}" \
  coverage/lcov-merged.info

echo ""
echo "==> Coverage collection complete!"
echo "  Unit test coverage: coverage/lcov.info"
echo "  E2E coverage: .nyc_output/"
echo "  Merged coverage: coverage/lcov-merged.info"
echo "  E2E HTML report: coverage/e2e/index.html"
