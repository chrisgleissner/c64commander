# Coverage Increase Plan: 89% → 92%

## Coverage Pipeline Audit

| Language | Tool | Report Format | Upload Step |
|----------|------|--------------|-------------|
| TypeScript | v8 via Vitest | lcov (`coverage/lcov.info`) | `codecov/codecov-action@v5` in `android.yaml:384-395` |
| Kotlin | JaCoCo 0.8.13 | XML (`jacocoTestReport.xml`) | `codecov/codecov-action@v5` in `android.yaml:579-591` |
| Swift/iOS | Not configured | N/A | Not uploaded |

## Baseline (TypeScript)

| Metric | Value |
|--------|-------|
| Statements | 88.91% |
| Branches | 82.41% |
| Functions | 85.64% |
| Lines | 88.91% |

## High-Impact Targets

| File | Current Stmts | Target |
|------|--------------|--------|
| smokeMode.ts | 74.38% | 92%+ |
| pathDisplay.ts | 75.63% | 92%+ |
| ramOperations.ts | 77.85% | 92%+ |
| hvscIngestionPipeline.ts | 65.95% | 92%+ |
| hvscSongLengthService.ts | 66.51% | 90%+ |
| hvscMediaIndex.ts | 49.27% | 85%+ |
| diskMount.ts | 72.85% | 90%+ |
| hvscService.ts | 78.85% | 90%+ |

## Execution

- Add focused unit tests for uncovered branches
- Target highest-gap files first
- Iterate until coverage >= 92% statements
