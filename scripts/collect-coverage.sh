#!/bin/bash
set -e

echo "==> Collecting coverage from all sources..."

# 1. Run unit tests with coverage
echo "==> Running unit tests with coverage..."
npm run test:coverage

# 2. Ensure E2E coverage directory exists
mkdir -p .nyc_output

# 3. Run E2E tests (which will collect coverage via Istanbul instrumentation)
echo "==> Running E2E tests with coverage..."
npm run test:e2e

# 4. Merge all coverage reports
echo "==> Merging coverage reports..."
npx nyc merge .nyc_output coverage/e2e-coverage.json
npx nyc merge coverage coverage/merged-coverage.json

# 5. Generate reports from merged coverage
echo "==> Generating merged coverage reports..."
npx nyc report \
  --temp-dir .nyc_output \
  --report-dir coverage/merged \
  --reporter=lcov \
  --reporter=text \
  --reporter=html \
  --reporter=json

# 6. Copy merged LCOV to root coverage dir for Codecov
cp coverage/merged/lcov.info coverage/lcov-merged.info

echo ""
echo "==> Coverage collection complete!"
echo "  Unit test coverage: coverage/lcov.info"
echo "  E2E coverage: .nyc_output/"
echo "  Merged coverage: coverage/lcov-merged.info"
echo "  HTML report: coverage/merged/index.html"
