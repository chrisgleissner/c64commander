# iOS Baseline Rationale

Chosen low-resource baseline: **iPhone 6s**.

## Why this baseline
- 2 GB RAM class (memory pressure comparable to low-end modern constraints).
- Apple A9 dual-core CPU at ~1.84 GHz (close to requested ~2 GHz dual-core class).
- Smaller screen (4.7-inch) is stricter for density/readability than 5.5-inch Android baseline, which helps catch layout pressure risks.
- Practical as a conservative floor for WKWebView and bridge behavior, even when CI simulators use newer iPhone profiles.

## Constraint mapping to Android baseline
- Android baseline: 3 GB RAM, ~2-core ~2 GHz, 5.5-inch.
- iPhone 6s mapping: lower RAM (2 GB) + similar core frequency class + smaller display.
- Result: if UI/perf is acceptable on this iOS floor, Android 3 GB devices should have RAM headroom; if not, issues likely affect both platforms.

## Caveat
- iPhone 6s max OS support is older than current iOS releases; OS/runtime drift risk remains and must be validated on at least one currently supported iOS simulator/device profile in CI.
