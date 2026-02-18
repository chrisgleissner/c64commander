# Telemetry Summary (Example)

## Run Metadata
- commit_sha: example-sha
- run_id: example-run
- job_name: example-job
- sampling_interval_sec: 3
- start_timestamp: 1739788800
- end_timestamp: 1739788806

## Per-Process
### android / c64-ci-constrained-3gb / uk.gleissner.c64commander (samples=2)
| metric | min | median | max |
|---|---:|---:|---:|
| cpu_percent | 12.4 | 13.2 | 14.1 |
| rss_kb | 210432 | 212266 | 214100 |
| total_pss_kb | 240120 | 241765 | 243410 |

### docker / linux-amd64-docker / c64commander-smoke (samples=1)
| metric | min | median | max |
|---|---:|---:|---:|
| cpu_percent | 36.2 | 36.2 | 36.2 |
| rss_kb | 120340 | 120340 | 120340 |

## Aggregate
### all / all / __aggregate__ (samples=3)
| metric | min | median | max |
|---|---:|---:|---:|
| cpu_percent | 17.6 | 36.2 | 48.3 |
| rss_kb | 165220 | 330330 | 398752 |

## Notes
- Capacitor TypeScript runs in WebView V8 and can increase native/off-heap memory usage.
- Compare Android dalvik/native/total PSS trends to identify the growth source.
