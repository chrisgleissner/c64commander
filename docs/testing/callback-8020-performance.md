# Callback 8020 contextful draw measurements

Measured on 2026-10-04 using the attached Pixel 4, C64U (firmware 1.2.1RC, core 1.50),
and the existing saved data, including the HVSC browse index and two SID playlist items.
Baseline application source: `d196115ed` (`1.0.7`). Candidate: the application changes in this PR.

## Simulation and metric

The assumed small display is **320×426 CSS pixels**, the app's minimum supported viewport;
the tablet layout is **800×1280**. Both use Auto display profile and Auto orientation.
Portrait orientation freezes the profile's viewport width, so using a viewport override with
that preference would not exercise the adaptive profiles. The harness asserts `compact`
and `expanded` before collecting each set.

The Pixel WebView ran with CDP CPU throttling rate **2** throughout the latency measurements.
The warmed 80-million-iteration kernel in `playwright/callbackCpu.ts` measured **85.0 ms**
unthrottled versus **171.8 ms** throttled (medians), with the same checksum.
[Calibration samples](performance/callback-8020/cpu-calibration.json).
The browser runner calibrates each host to that 171.8 ms reference; desktop rate 2 alone
would not establish half-Pixel throughput.

This constrains WebView CPU, not the whole SoC or native Android services. It does not
impose a physical RAM ceiling. Retained JavaScript heap is measured, not assumed to be
whole-process RAM or a guarantee for an unreleased handset.

**Contextful draw** is a readiness proxy: time from the real Android key event timestamp
to two animation frames after the requested page has its active route, substantive content,
no page-loading fallback, and all visible open section bodies mounted. Overlays must be open
and contain substantive content. This does not measure captured pixels, animation completion,
or completion of data outside the viewport.

Each surface has ten trials per viewport. The first circuit is kept in the raw data and
excluded from the warm medians below; nine measurements remain per surface. These are warm
navigation measurements, not cold-start guarantees or statistically strong tail estimates.
Task, script and layout duration deltas cover the key operation through readiness plus
350 ms. Results are collected by observation; Android commands go through droidctl.

## Warm draw results

Milliseconds, rounded; all samples and CPU counters are retained in
[baseline](performance/callback-8020/baseline.json),
[candidate](performance/callback-8020/candidate.json) and
[comparison](performance/callback-8020/comparison.json).

| Surface         | Small baseline → candidate |     Change | Tablet baseline → candidate |     Change |
| --------------- | -------------------------: | ---------: | --------------------------: | ---------: |
| Home            |                 1161 → 409 | 65% faster |                  1225 → 607 | 50% faster |
| Play            |                 1241 → 705 | 43% faster |                  1450 → 939 | 35% faster |
| Disks           |                  804 → 644 | 20% faster |                   879 → 764 | 13% faster |
| Config          |                3143 → 1023 | 67% faster |                 3010 → 1085 | 64% faster |
| Settings        |                 1612 → 725 | 55% faster |                  1512 → 809 | 46% faster |
| Docs            |                  425 → 402 |  5% faster |                   444 → 448 |  1% slower |
| Diagnostics     |                  532 → 335 | 37% faster |                   554 → 372 | 33% faster |
| Device switcher |                  354 → 229 | 35% faster |                   372 → 313 | 16% faster |
| Quick menu      |                  365 → 187 | 49% faster |                   385 → 252 | 34% faster |

Tablet Docs changed by **4 ms** in the final repeat, while script time fell 24% and layout
time fell 34%. An earlier candidate repeat measured 29 ms slower there; it is not claimed
as a latency win. Small-screen median script time fell **11–67%** across the nine surfaces;
tablet script time fell **9–61%**. See the raw distributions rather than extrapolating these
medians to every action or sustained CPU/power use.

## Memory and loading

After each viewport run, overlays were closed and the Settings page remained active.
One explicit garbage collection preceded the retained-heap checkpoint:

| Layout | Baseline heap | Candidate heap | DOM elements | Mounted section bodies |
| ------ | ------------: | -------------: | -----------: | ---------------------: |
| 320px  |      94.7 MiB |       86.1 MiB |   1114 → 543 |                 12 → 1 |
| 800px  |      98.5 MiB |       89.8 MiB |   1182 → 644 |                 12 → 2 |

Only remembered heights can reserve space for deferred bodies. Unknown bodies still mount
progressively on the first visit. Visible and near-viewport bodies mount before paint;
scrolling, resize, explicit section requests and keypad traversal can demand them later.
The margin follows viewport height, so larger screens build more content. Height records
are invalidated by viewport, display-profile or text-scale changes.

No page component trees are kept resident. There is one latest height/layout record per
section and one parsed section-state store, checked against the serialized value on each
read. The HVSC parent-folder map exists only during a build, and identical seed/full search
strings share their value. Closed Diagnostics no longer copies and sorts its stores on
unrelated renders. Scroll restoration reads geometry when content changes, instead of
polling a settled page every frame for three seconds.

A cold HVSC index restore can still occupy the main thread; these changes reduce duplicate
index work but do not make that restore asynchronous.

## Rapid page-to-overlay requests

Thirty additional trials request each overlay immediately after a tab jump, five times per
viewport. Baseline lost **8 of 10** device-switcher requests; candidate lost **0 of 10**.
All thirty candidate overlay draws succeeded.
[Baseline](performance/callback-8020/baseline-urgent.json) and
[candidate](performance/callback-8020/candidate-urgent.json).
Timeouts are recorded as failures, not omitted from latency summaries.

One pending switcher intent spans subscriber gaps. The departing badge cannot consume it
when the URL already identifies another page, and opening is acknowledged after its commit.
Popup focus navigation builds only its own active scope; page traversal still builds every
waiting body in the page's keypad ring.

## Reproduce

Install the baseline and candidate APK in turn through `droid_app.install_app`, preserving
app data. Select Auto orientation and Auto display profile through Settings. Use the same
saved devices, library and section-open decisions for both runs.

```bash
node scripts/contextful-draw-perf.mjs --rounds 10 --output artifacts/contextful-draw/report.json
node scripts/contextful-draw-perf.mjs --rounds 5 --urgent-only --output artifacts/contextful-draw/urgent.json

# Host Chromium: all created pages are constrained before their scripts run.
PLAYWRIGHT_DEVICES=phone node scripts/run-callback-browser.mjs -- npx playwright test contextfulDraw.spec.ts
node scripts/run-callback-browser.mjs -- npm run test:e2e

# Physical input needs the native viewport; CPU stays at the simulated reference.
node scripts/run-callback-hil.mjs -- node tools/hil/merge_gate.mjs \
  --host c64u --iface <LAN-IP> --json artifacts/hil-gate.json
```

Both wrappers restore/close their test sessions. The HIL wrapper assumes the Pixel 4 and
uses rate 2; it is not a calibration for arbitrary Android hardware. No runtime test probes
or coverage instrumentation were included in the measured APKs.

## Validation performed for these measurements

- 14,217 unit/contract tests passed; six existing skips were unchanged.
- Focused regression suites passed. Twenty-two regressions failed against the original
  behavior, including the HIL harness's handling of an open deferred Settings chapter.
- Four calibrated browser checks passed at both widths: visible-body readiness, scroll and
  resize behavior, overlay scoping, and complete keypad traversal.
- Production web build, Capacitor sync, Android debug APK build and lint passed.
- The session-gate unit test now models the browser-location boundary and explicitly
  asserts its login redirect, avoiding JSDOM's unsupported full-document navigation.
- Corrected APK installed and exercised on the Pixel 4 at rate 2.
- The calibrated complete browser run passed 822 tests. Three failures were addressed with
  explicit page readiness, scrolling to a deferred chapter, and waiting for a completed
  asynchronous save; all three focused reruns passed. Additional full-suite and merged/patch
  coverage results are recorded in [PR #453](https://github.com/chrisgleissner/c64commander/pull/453).
- No screenshot files changed: labels, controls, styles and documented visible content are unchanged.

The [complete hardware gate](performance/callback-8020/hardware-gate.json) passed at CPU
rate 2, using the native phone viewport for physical input coordinates:

| Stage          | Result | Evidence                                        |
| -------------- | ------ | ----------------------------------------------- |
| Preflight      | Pass   | Pixel 4; speaker volume 3/25                    |
| Input          | Pass   | Nine cells moved; all 20 rotation checks passed |
| Search latency | Pass   | 120 samples; p95 43.1 ms                        |
| Wire           | Pass   | 0% loss; inter-arrival p99 4.15 ms              |
| A/V clarity    | Pass   | 82 tones; zero defects; 0% dropout              |
| A/V latency    | Pass   | 268 ms wire to speaker; correlation 0.866       |
| Remote SID     | Pass   | Tone present 100%; +1 cent; no gap              |
| Local SID      | Pass   | Tone present 100%; −10.2 cents; no gap          |
| Crossfade      | Pass   | Seamless crossfade                              |

Earlier failures are retained in the local evidence. The input preparation originally
closed an already-open deferred chapter; it now scrolls there before checking its open
state, with a regression that fails against the old helper. One rotation-probe error and
subsequent search timeout did not recur in a separate 20-check rotation run or the quiet
and final full gates; their cause was not established from a passing repeat.

Audible clarity initially lost a pair of notes on both candidate and unchanged baseline.
A wire pacing capture measured 49,808 stereo frames/s despite the configured PAL mode,
3.8% above the documented 47,983 rate. Native ring depth grew until it discarded a backlog.
Reapplying the original PAL mode with sequential NTSC then PAL single-item PUTs restored
the expected 4.00 ms packet cadence and the complete gate passed, with no audio pipeline
change or relaxed assertion. Benchmark baseline and candidate measurements preceded this
rig correction and used the same clock state. Phone speaker volume remained 3/25.
