# Diagnostics Screenshots

This directory holds the current diagnostics overlay screenshots used for documentation and review.

## Contents

### Overview (`doc/img/app/diagnostics/`)

- `01-overview.png`: default diagnostics overlay showing health summary, filters, activity, and analysis controls together.

### Header (`doc/img/app/diagnostics/header/`)

- `01-expanded.png`: expanded health summary header with seeded latency percentiles visible.
- `02-health-check-detail.png`: completed health-check detail showing REST, FTP, CONFIG, RASTER, and JIFFY outcomes with latency and overall result.
- `03-health-check-live-progress.png`: in-flight health-check detail showing completed, running, and pending probes in the documented execution order.

### Activity (`doc/img/app/diagnostics/activity/`)

- `01-visible-list.png`: activity list with mixed action, REST, and FTP entries visible.
- `02-expanded-problems.png`: expanded problem entry showing the compact full-detail payload for diagnostics failures.
- `03-expanded-actions.png`: expanded REST POST action showing request headers, request body, response headers, response body, response status, latency, and only partially redacted secret-like header values.
- `04-expanded-logs.png`: expanded log entry showing structured app-log detail.
- `05-expanded-traces.png`: expanded trace entry showing the traced request payload.
- `06-collapsed-after-toggle.png`: the list after a second tap collapses the expanded row again.
- `07-problems-only.png`: activity list filtered to diagnostics problems only.
- `08-actions-only.png`: activity list filtered to action summaries only.
- `09-logs-only.png`: activity list filtered to logs only.
- `10-traces-only.png`: activity list filtered to traces only.
- `11-errors-only.png`: activity list filtered to error-severity entries across activity types.

### Filters (`doc/img/app/diagnostics/filters/`)

- `01-summary-bar.png`: compact filter summary bar visible in the main overlay.
- `02-editor.png`: filter editor sheet with activity type, contributor, and severity controls.

### Connection (`doc/img/app/diagnostics/connection/`)

- `01-view.png`: connection view showing the current device target and ports.
- `02-edit.png`: connection editor with host and port fields ready to update.

### Analysis (`doc/img/app/diagnostics/analysis/`)

- `01-latency.png`: latency analysis popup with request timing percentiles and chart.
- `02-history.png`: health history timeline with seeded state transitions.

### Tools (`doc/img/app/diagnostics/tools/`)

- `01-menu.png`: overflow tools menu with export and clear actions visible.

### Profile-specific screenshots (`doc/img/app/diagnostics/profiles/`)

- `profiles/compact/01-overview.png`: compact display profile overview.
- `profiles/medium/01-overview.png`: medium display profile overview.
- `profiles/expanded/01-overview.png`: expanded display profile overview.
