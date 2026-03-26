# Archive Client Simplification Worklog

## 2026-03-26T00:00:00Z - Task classification and baseline scope

- Classified the work as DOC_PLUS_CODE because it changes executable archive code plus repository process artifacts and documentation.
- Read the archive client, archive config, settings persistence, online archive hook, source navigation, item-selection UI, and related tests before editing.
- Confirmed the current implementation still contains two archive client subclasses, backend-based config resolution, retired-source settings/UI, and source-specific tests/mocks.

## 2026-03-26T00:08:00Z - Full impact inventory

- Searched the repository for retired-source literals, archive backend usage, and archive client config types.
- Verified the removal scope includes runtime code, test mocks, Settings page state, Play Files source groups, item-selection interstitial buttons, telnet documentation, and stale process artifacts in PLANS.md and WORKLOG.md.
- Decision: remove the retired source completely rather than leaving dormant feature flags or compatibility branches, because the acceptance criteria require zero remaining references.

## 2026-03-26T00:16:00Z - Refactor plan locked

- Decided to keep one concrete client class, `CommoserveClient`, and move source identity into config fields (`id`, `name`, `baseUrl`, `headers`, `enabled`).
- Decided to keep the current host/client-id/user-agent override UX, but translate those settings into the new config model before client construction so external behavior remains unchanged.
- Decided to remove archive backend persistence entirely and simplify the UI to a single CommoServe enablement toggle plus override fields.

## 2026-03-26T00:24:00Z - Implementation in progress

- Replaced the archived multi-backend plan with the current convergence plan in PLANS.md.
- Began editing core archive types/config/client code, then the settings/UI/source-selection code, followed by tests and documentation.
- Verification pending after implementation: lint, coverage, build, generated-asset refresh, and final repository-wide literal sweep.
