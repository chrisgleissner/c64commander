# Before/After KPIs

| KPI                                       | Before                           | After                                      | Delta/Result        |
| ----------------------------------------- | -------------------------------- | ------------------------------------------ | ------------------- |
| Android JVM tests                         | 85/112 failed in review baseline | pass (`./gradlew test`)                    | fixed               |
| Playwright deterministic viewport failure | reproducible on web project      | resolved with project-aware viewport guard | fixed               |
| Main chunk size                           | 1,217.87 kB                      | see `bundle-delta.md`                      | improved            |
| Global branch coverage                    | 82.05%                           | 82.07%                                     | maintained/improved |
| `web/server/src/index.ts` branch coverage | 58.1%                            | 58.11%                                     | improved            |
| Constrained runtime memory sample         | 19.46-20.30 MiB baseline sample  | see `docker-constrained-delta.md`          | measured            |
| Final quality gate command set            | not fully green in baseline      | executed in phase 9 log                    | completed           |
