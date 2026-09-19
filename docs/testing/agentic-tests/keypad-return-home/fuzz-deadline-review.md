# Adversarial review — the nightly fuzz overrun

The nightly `fuzz` workflow was cancelled by its own job cap on five consecutive nights
(runs 34924726102, 35051519183, 35177899376, 35302887638, 35418281403). This is the review of the
fix, written against it rather than for it.

## What the overrun actually was

`scripts/run-fuzz.mjs` turned `--fuzz-time-budget` into `FUZZ_TIME_BUDGET_MS` and handed it to each
Playwright shard. Inside the shard it became `startTime + budget - shutdownBuffer`, which bounded
the session loop and nothing else. Outside it ran the production build, each shard's teardown and
report writing, and `mergeReports()`.

`mergeReports()` is the expensive one. For every session it runs `ffprobe` for the video duration,
`ffmpeg -vf fps=1` to extract one PNG per second of that video, hashes every extracted frame, and
raw-decodes the sampled frames through `analyzeImageQuality`. In run 35418281403 the step ran for
8905 s against a 7200 s budget. The build in the sibling deterministic job took 25 s, so
approximately 1675 s of the 1705 s overrun was the merge.

## Where the first fix put the enforcement

The first fix fixed the shards: a deadline computed at process start, a reserve carved out of the
budget, a watchdog that SIGTERMs the shards a little after their own budget ends, and signal
handlers so a cancellation also falls through to reporting. It also stopped a shard that never
wrote its own report from skipping that shard's completed sessions during the merge.

That is correct and necessary, but it is not where the overrun happened. With the shards bounded,
`mergeReports()` was still unbounded: a night whose sessions produced more video than the reserve
allows for would have overrun the budget again, and the stated outcome — "a run given 2 h finishes,
with its report written, inside 2 h" — would still not hold. The reserve was an estimate of the
merge's cost, not a limit on it.

## What was added

Per-session screenshot analysis and frame extraction now stop once the run deadline has passed.
Sessions and videos still reach the merged report; only their frames go ungraded, and the number of
sessions that skipped it is printed rather than left silent. The artifact-validation error also
names the deadline when a stopped run is why the sessions directory is not there, instead of
reporting it as a missing artifact and sending the reader after a broken recorder.

## Second-order effect the first fix did not account for

The deterministic job passes `--fuzz-time-budget 5m` and had been getting the full 300 s of
fuzzing, because the budget bounded only the shard loop. With the budget covering the build (25 s,
measured in the same run) and a 25% reserve (75 s), its shards would have received about 200 s. The
job would still have passed, a third less fuzzing than before with nothing saying so. Its budget is
now 7m, which restores roughly the previous fuzzing time; the step still finishes far inside the
30 minute cap.

## The budget arithmetic, re-checked

Job cap 9000 s. Measured outside the fuzz step: 106 s before, 20 s after, 126 s total. A 7200 s
budget plus 126 s is 7326 s, leaving 1674 s (18.6%) of headroom for a cold `npm ci` or a Playwright
browser install that misses its cache. `timeout-minutes: 150` does not need to move, and did not.

Inside the 7200 s: reserve 1800 s, build about 25 s, so the shards fuzz for about 5375 s and the
watchdog fires 120 s after that. The merge's cost scales with the number of sessions, so 5375 s of
shard time should need roughly 1250 s of merging against the measured 1675 s for 7200 s of shard
time — inside the 1800 s reserve, and now cut off at the deadline if it is not. The deliberate
trade is about 30 minutes less fuzzing per night for a nightly that finishes and reports.

## What is covered by a test and what is not

`tests/unit/scripts/fuzzDeadline.test.ts` covers the deadline arithmetic, including that an
already-exhausted budget starts no further work. Replacing the whole of `scripts/fuzzDeadline.mjs`
with a stand-in reproducing the previous semantics fails 9 of its 10 cases.

The two guards inside `mergeReports()` are not unit-tested: they are call-site applications of
`hasDeadlinePassed`, which is, and `mergeReports` is a 700-line function over a real run directory.
They were exercised end to end instead: `PLAYWRIGHT_SKIP_BUILD=1 node scripts/run-fuzz.mjs
--fuzz-time-budget 1s` starts no shards and still writes `README.md`, `fuzz-issue-summary.md`,
`fuzz-issue-report.json`, `fuzz-run-metrics.json` and `visual-stagnation-report.json`, then fails
with `The run was stopped before these were produced: run time budget exhausted`.

## One claim narrowed

The change routes `SIGINT` and `SIGTERM` to the same shard-stopping path, and the commit describes
a cancelled run as still writing its reports. That holds for a run the deadline stops, because the
reserve is still ahead of it. It does not hold in general for a job cancelled from GitHub: the
runner allows a short grace period before it kills the process, and a merge over a full night's
sessions does not fit in it. The reliable guarantee is the deadline-stopped one; a cancellation
that arrives early enough is a bonus, not a property to depend on.

## Items noted and deliberately not changed

`actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4` and `actions/upload-artifact@v4`
log Node 20 deprecation warnings across this workflow. `runs-on: ubuntu-latest` migrates to
Ubuntu 26 on 2026-10-19. Both are repo-wide and belong in their own change.
