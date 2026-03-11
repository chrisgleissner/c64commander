# Plans

## Documentation Audit And Remediation

### Scope

- Audit every file under `.planning/codebase/`.
- Audit the canonical repository documentation under `doc/`.
- Check overlapping durable docs in `README.md`, `AGENTS.md`, and `docs/` when they affect accuracy or duplication decisions.
- Migrate only durable, validated information from `.planning/codebase/` into `doc/`.
- Delete `.planning/` completely after migration and validation.

### Assumptions and constraints

- The codebase is the source of truth for current behavior.
- `doc/` is the canonical location for durable repository documentation.
- `docs/` remains the public/site-facing folder; it is inspected for overlap but is not the migration target for this task.
- Historical investigation records in `doc/research/` and `doc/testing/investigations/` may remain when they are clearly time-scoped evidence rather than current-state canonical reference docs.
- Planning artifacts must not be archived elsewhere. Anything worth keeping must be rewritten into deduplicated `doc/` content.

### Inventory of `.planning/codebase`

| File | Topic | Initial classification |
| --- | --- | --- |
| `.planning/codebase/ARCHITECTURE.md` | App layers, runtime shape, data flow | Durable architecture summary |
| `.planning/codebase/STACK.md` | Languages, frameworks, build/runtime stack | Durable stack summary |
| `.planning/codebase/STRUCTURE.md` | Directory layout and code placement | Durable developer workflow summary |
| `.planning/codebase/TESTING.md` | Test commands, layout, mocking, coverage | Mixed: durable workflow + stale thresholds |
| `.planning/codebase/CONVENTIONS.md` | Naming, imports, logging, style | Durable workflow summary with stale formatting note |
| `.planning/codebase/CONCERNS.md` | Structural hotspots and technical risk | Durable in topic, partially stale in detail |
| `.planning/codebase/INTEGRATIONS.md` | REST/FTP/HVSC/storage integrations | Durable architecture/integration summary |

### Inventory of relevant `doc/` and overlapping canonical docs

| File | Role |
| --- | --- |
| `doc/architecture.md` | Canonical architecture overview |
| `doc/developer.md` | Canonical contributor workflow guide |
| `doc/code-coverage.md` | Canonical coverage strategy and CI gate description |
| `doc/features-by-page.md` | Canonical implemented UI feature surface |
| `doc/c64/c64u-rest-api.md` | REST API reference |
| `doc/c64/c64u-ftp.md` | FTP behavior reference |
| `doc/c64/c64u-openapi.yaml` | REST schema source |
| `README.md` | Top-level project and developer entrypoint |
| `AGENTS.md` | Agent-facing orientation; not canonical over `doc/` |
| `docs/index.md` | Public site index; overlap checked only for navigation consistency |

### Mapping table

| Source document | Accuracy | Needed | Duplicates existing `doc/`? | Final disposition | Target |
| --- | --- | --- | --- | --- | --- |
| `.planning/codebase/ARCHITECTURE.md` | Partially accurate | Yes, in rewritten form | Yes | Merge + rewrite | `doc/architecture.md` |
| `.planning/codebase/STACK.md` | Mostly accurate | Yes, in rewritten form | Partly | Merge + rewrite | `doc/architecture.md` |
| `.planning/codebase/STRUCTURE.md` | Mostly accurate | Yes, in rewritten form | Partly | Merge + rewrite | `doc/developer.md` |
| `.planning/codebase/TESTING.md` | Partially accurate | Yes, partly | Yes | Partially merge + delete | `doc/developer.md`, `doc/code-coverage.md` |
| `.planning/codebase/CONVENTIONS.md` | Partially accurate | Yes, in rewritten form | Partly | Merge + rewrite | `doc/developer.md` |
| `.planning/codebase/CONCERNS.md` | Partially accurate | Yes, partly | No exact canonical home | Partially merge + delete | `doc/developer.md` |
| `.planning/codebase/INTEGRATIONS.md` | Mostly accurate | Yes, in rewritten form | Partly | Merge + rewrite | `doc/architecture.md` |

### Per-document status

| Document | Status | Notes |
| --- | --- | --- |
| `.planning/codebase/ARCHITECTURE.md` | Reviewed | Playback/services details need rewrite into canonical architecture doc |
| `.planning/codebase/STACK.md` | Reviewed | Versions broadly match code; merge into architecture stack summary |
| `.planning/codebase/STRUCTURE.md` | Reviewed | Structure guidance is useful; merge into developer guide |
| `.planning/codebase/TESTING.md` | Reviewed | Coverage-threshold note is stale; only workflow guidance should survive |
| `.planning/codebase/CONVENTIONS.md` | Reviewed | Prettier observation is stale; naming/logging guidance should survive |
| `.planning/codebase/CONCERNS.md` | Reviewed | Large-file and non-strict-TypeScript concerns remain valid; counts need refresh |
| `.planning/codebase/INTEGRATIONS.md` | Reviewed | Integration summary is useful; merge into architecture doc |
| `doc/architecture.md` | Updated | Intro now reflects Web/Android/iOS runtimes plus validated stack/integration summary |
| `doc/developer.md` | Updated | Formatting, documentation map, conventions, and hotspot guidance consolidated |
| `doc/code-coverage.md` | Updated | Threshold and CI aggregation details corrected against scripts/workflows |
| `doc/testing/test-coverage-summary.md` | Deleted | Stale duplicate removed |
| `doc/index.md` | Created | Canonical `doc/` entrypoint added |
| `README.md` | Updated | Developer section now links to `doc/index.md` |

### Validation checklist

- [x] Install dependencies and run baseline validation (`npm run test && npm run lint && npm run build`)
- [x] Inventory `.planning/codebase`
- [x] Inventory relevant canonical docs under `doc/`
- [x] Validate planning-file claims against current code, config, and workflows
- [x] Rewrite canonical docs in `doc/`
- [x] Remove stale duplicate docs identified during the audit
- [x] Confirm no remaining `doc/` references rely on `.planning`
- [x] Re-run repository validation after documentation changes
- [x] Review final doc set for overlap, factual drift, and broken links

### Cleanup checklist

- [x] Delete `.planning/codebase/*`
- [x] Delete any superseded canonical duplicate docs in `doc/`
- [x] Remove the `.planning/` directory
- [x] Confirm repository searches show no remaining `.planning` references outside `.gitignore`

### Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Rewriting docs could accidentally restate stale planning assumptions | Validate every preserved claim against source files, scripts, or workflows before writing |
| Deleting a doc may remove still-useful information | Preserve only after rewriting into a canonical target doc and record the mapping here |
| Coverage/build docs may drift because CI logic moved from Vitest config into scripts/workflows | Validate against `package.json`, `vitest.config.ts`, `.github/workflows/*.yaml`, and `scripts/check-coverage-threshold.mjs` |
| Historical research docs can be mistaken for current reference docs | Keep time-scoped historical docs as historical only; concentrate canonical current-state guidance in `doc/architecture.md`, `doc/developer.md`, `doc/code-coverage.md`, and `doc/index.md` |

### Final completion checklist

- [x] Every `.planning/codebase` file has an explicit disposition recorded
- [x] Every durable fact worth keeping has been migrated into `doc/`
- [x] Existing canonical docs updated to match current code
- [x] Stale duplicate canonical docs removed
- [x] `.planning/` deleted entirely
- [x] Final validation completed
- [x] Final audit summary written below

### Final audit summary

#### Inventory reviewed

- Reviewed all 7 files in the deleted `.planning/codebase/` snapshot.
- Reviewed the canonical current-state docs that overlap those topics: `doc/architecture.md`, `doc/developer.md`, `doc/code-coverage.md`, `doc/features-by-page.md`, `doc/c64/*`, plus overlapping entrypoints in `README.md`.

#### Documents migrated or merged

- Merged architecture, stack, and integration content from:
  - `.planning/codebase/ARCHITECTURE.md`
  - `.planning/codebase/STACK.md`
  - `.planning/codebase/INTEGRATIONS.md`
  into `doc/architecture.md`
- Merged structure, conventions, testing workflow, and durable concern/hotspot content from:
  - `.planning/codebase/STRUCTURE.md`
  - `.planning/codebase/CONVENTIONS.md`
  - `.planning/codebase/TESTING.md`
  - `.planning/codebase/CONCERNS.md`
  into `doc/developer.md` and `doc/code-coverage.md`
- Added `doc/index.md` as the canonical entrypoint for the internal documentation set.

#### Documents deleted

- Deleted all files under `.planning/codebase/`
- Deleted the entire `.planning/` directory
- Deleted `doc/testing/test-coverage-summary.md` because it was a stale duplicate of current coverage documentation

#### Key accuracy corrections made

- Corrected the canonical architecture overview to describe the actual multi-runtime target surface (Web, Android, and iOS), not an Android-only shell framing.
- Corrected architecture/module summaries to reflect the current `src/lib/playback/` and `src/lib/sourceNavigation/` roles in addition to SID utilities.
- Corrected developer guidance to match the current Prettier configuration (`printWidth: 120`, YAML `tabWidth: 2`) rather than the stale planning note.
- Corrected coverage documentation to match the live CI pipeline:
  - merged LCOV gate at `coverage/lcov-merged.info`
  - 90% line / 90% branch enforcement through `scripts/check-coverage-threshold.mjs`
  - Codecov uploads for `web`, `android`, `python`, and `swift`
- Refreshed structural hotspot documentation with current line counts and the still-placeholder `tests/unit/pages/PlayFilesPage.test.tsx`.

#### Duplication eliminated

- Removed the stale duplicate coverage summary file under `doc/testing/`.
- Eliminated the now-redundant `.planning/codebase/` copies after their durable content was rewritten into canonical `doc/` targets.
- Added `doc/index.md` so canonical current-state docs are discoverable without relying on planning artifacts.

#### Validation evidence

- Baseline validation before remediation passed: `npm run test && npm run lint && npm run build`
- Post-change validation passed: `npm run test && npm run lint && npm run build`
- Repository search confirms no remaining `.planning` references in `doc/`; remaining references are only in this audit record and `.gitignore`
- `./build` was attempted twice after the doc changes (`--skip-install`, then `--skip-install --skip-format`) but produced no further progress output in this environment after entering formatting / `cap:build`, so the final validation record relies on the successful direct `npm` checks above

#### Rationale for removing `.planning`

The `.planning/codebase/` files were a dated February 2026 snapshot that mixed still-useful summaries with stale implementation details. Their durable value now lives in rewritten, deduplicated canonical docs under `doc/`, so keeping the original planning copies would only preserve drift and duplication. The repository no longer depends on `.planning`.
