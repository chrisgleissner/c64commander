# Prompt Workflow Contract

This folder contains reusable review and analysis prompts.

## Production Review Cycle

Use the production prompts as a direct handoff pair:

1. `review.prompt.md`
   - Performs the production review directly.
   - Creates the next numbered review folder under `doc/research/review-<n>/`.
   - Writes the review report and seeds `carry-forward.md` with inherited and newly discovered open items.
   - Must not remediate findings.

2. `review-fix.prompt.md`
   - Remediates confirmed findings from the latest review report.
   - Updates `remediation-log.md` and `carry-forward.md` in the same review folder.
   - Must never rewrite the audit report.

## Documentation Review Cycle

Use the documentation prompts as a separate direct handoff pair:

1. `doc-review.prompt.md`
   - Performs a doc-only audit across `README.md`, `doc/`, `docs/`, and documented UI screenshots.
   - Creates the next numbered doc review folder under `doc/research/doc-review-<n>/`.
   - Writes the doc review report and seeds `carry-forward.md` with unresolved documentation issues.
   - Must not remediate findings.

2. `doc-fix.prompt.md`
   - Fixes confirmed issues from the latest doc review.
   - Updates `remediation-log.md` and `carry-forward.md` in the same doc review folder.
   - Must never rewrite the audit report.

## Required Review Artifacts

- `doc/research/review-<n>/review-<n>.md`
- `doc/research/review-<n>/remediation-log.md`
- `doc/research/review-<n>/carry-forward.md`

## Required Doc Review Artifacts

- `doc/research/doc-review-<n>/doc-review-<n>.md`
- `doc/research/doc-review-<n>/remediation-log.md`
- `doc/research/doc-review-<n>/carry-forward.md`

## Carry-Forward Contract

`carry-forward.md` is the durable handoff document between remediation passes and the next review cycle.

Each open item should preserve:

- a stable item ID
- source review number
- current status (`open`, `blocked`, `deferred`, or `resolved`)
- concise problem summary
- evidence or affected paths
- next action or blocker

If a remediation pass cannot finish an item, that item must remain in `carry-forward.md` with an updated status and next action so the next review cycle inherits it automatically.
