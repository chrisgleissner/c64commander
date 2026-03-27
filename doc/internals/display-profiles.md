# Display Profiles Specification

## 1. Scope

This document defines the display-profile model for C64 Commander.

It is the source of truth for:

- profile names and detection
- layout invariants
- allowed profile-specific adaptations
- page and component obligations
- display-profile verification scope

It does not redefine workflow semantics, page responsibilities, or CTA inventory already specified elsewhere.

## 2. Goals

- Keep one UI system across Android, iOS, and Web.
- Preserve the existing UX model: source choice, scoped selection, then collection-based play or mount.
- Support narrow mobile screens without horizontal overflow or precision-dependent controls.
- Support larger screens without oversized line lengths, sparse composition, or undersized targets.
- Keep profile branching explicit, minimal, and centralized.

## 3. Non-Negotiable Invariants

The following rules apply in all display profiles:

- Source selection happens before source navigation.
- Selection views remain scoped to one source.
- Playback happens only from the playlist.
- Mounting happens only from the disk collection.
- Primary CTA labels and source names remain unchanged.
- Lists remain query-driven, virtualized where required, and deterministically ordered.
- Long labels and paths must wrap or truncate safely; horizontal page scrolling is forbidden.
- Safe-area insets, browser chrome, and on-screen keyboards must not hide primary actions.

Display profiles may change presentation and interaction density. They must not change workflow semantics.

## 4. Internal And User-Facing Names

Internal profile names:

- Compact
- Medium
- Expanded

User-facing labels:

- Small display
- Standard display
- Large display

Mapping:

| Internal | User-facing      |
| -------- | ---------------- |
| Compact  | Small display    |
| Medium   | Standard display |
| Expanded | Large display    |

Automatic mode maps the current viewport to one internal profile.

## 5. Detection Model

Profile detection must be centralized and width-based.

Initial thresholds:

| Profile  | Width        |
| -------- | ------------ |
| Compact  | `<= 360 px`  |
| Medium   | `361-599 px` |
| Expanded | `>= 600 px`  |

Rules:

- Width is measured in CSS pixels.
- Components must consume the resolved profile; they must not perform ad hoc breakpoint checks.
- Width decides the profile. Height, orientation, keyboard presence, and text scaling add constraints but do not change the resolved profile.
- Manual override, if exposed, must map to the same three internal profiles.

Rationale:

- `<= 360 px` covers constrained phones.
- `361-599 px` is the standard single-column mobile baseline.
- `>= 600 px` covers tablets, wide phones in landscape, and wider web viewports that need large-display treatment.

## 6. Baseline Strategy

Medium is the canonical baseline.

| Profile  | Strategy                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- |
| Compact  | Structural adaptation of constrained surfaces                                                       |
| Medium   | Canonical single-column mobile layout                                                               |
| Expanded | Canonical information architecture with bounded width, larger scale, and optional secondary columns |

Rules:

- Medium defines default spacing, hierarchy, and control composition.
- Compact is the only profile allowed to replace interaction patterns when the Medium pattern is not usable at narrow width.
- Expanded may rearrange secondary content to use available width, but it must preserve the same primary reading order and the same core actions.

## 7. Compact Profile

Compact exists to protect usability on narrow screens.

Required outcomes:

- no horizontal scrolling
- reliable one-handed tap targets
- no reliance on fine drag precision
- clear access to primary actions without hidden overflow

Allowed adaptations:

| Medium pattern                                    | Compact adaptation                                            |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Dense multi-control rows                          | Stacked rows                                                  |
| Inline secondary editors                          | Separate full-screen editor or sheet                          |
| Side-by-side action groups                        | Vertical action list                                          |
| Wide dialogs or panels                            | Full-screen presentation                                      |
| Controls that depend on horizontal drag precision | Stepper, segmented control, discrete select, or numeric field |
| Multi-column supporting content                   | Single column                                                 |

Constraints:

- Do not remove actions that exist in Medium.
- Do not move playback or mounting into selection views.
- Do not replace a control solely for stylistic consistency; replace it only when the baseline control is not reliably usable in the Compact width budget.

## 8. Medium Profile

Medium is the reference composition.

Required characteristics:

- single-column page flow
- standard dialog presentation for ordinary modal actions
- inline editing where it remains readable and stable
- standard spacing and touch-target sizes
- documentation screenshots should default to this profile unless a profile-specific difference is being shown

## 9. Expanded Profile

Expanded exists to improve readability and compositional balance on wide viewports.

Required outcomes:

- content width remains readable
- controls remain comfortably reachable and visually grouped
- extra width is used intentionally, not as empty gutters

Allowed adaptations:

- increase typography, spacing, and target size
- apply a page-level max width to primary reading surfaces
- place secondary panels beside primary content when that does not change task order
- increase list preview height or visible item count when virtualization rules remain intact

Prohibited adaptations:

- introducing alternative workflows
- moving primary actions to distant corners solely to fill space
- turning core list or form pages into dense desktop-style tables

Expanded is not a different product surface. It is the same UX with better use of width.

## 10. Modal And Overlay Rules

Modal presentation is profile-sensitive.

| Surface type        | Compact                                                                                        | Medium                                                         | Expanded                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Confirmation dialog | Full-screen when content or action rows would be cramped; otherwise centered and viewport-safe | Centered and viewport-safe                                     | Centered and viewport-safe                                     |
| Selection browser   | Full-screen                                                                                    | Full-screen or large dialog, but source scope remains explicit | Full-screen or large dialog, but source scope remains explicit |
| Secondary editor    | Full-screen                                                                                    | Centered dialog or inline editor                               | Centered dialog, inline editor, or side panel                  |

Rules:

- Every modal must remain fully visible inside the viewport.
- Keyboard appearance must not hide the title, primary field, or primary confirm action.
- Compact may promote a surface to full-screen to preserve usability; that does not change the workflow type.

## 11. Component Obligations

The following shared surfaces must render correctly in all profiles:

- `SelectableActionList`
- `ItemSelectionDialog`
- `QuickActionCard`
- config widgets
- disk-group controls
- page headers and top-level action areas

Required behavior:

- consume centralized display-profile context
- preserve semantic action ordering across profiles
- avoid profile-specific copies of the same component
- keep loading, error, empty, and disabled states layout-safe in every profile

## 12. Page-Level Expectations

The following page expectations are mandatory.

Home:

- quick-action clusters may stack in Compact
- status cards may gain spacing and width bounds in Expanded
- mixer and stream controls must avoid overflow at narrow widths

Play and Disks:

- list headers, bulk-action areas, and filters must remain usable without horizontal overflow
- preview lists and view-all surfaces must preserve virtualization and deterministic ordering in every profile
- source-selection and source-browsing surfaces must preserve the same source order and navigation model in every profile

Config and Settings:

- long labels, hostnames, and values must wrap or truncate safely
- inline editors may move to full-screen editing in Compact when needed
- Expanded may use width for better grouping, but not for denser, harder-to-scan rows

## 13. Accessibility And Resilience Rules

Display-profile support is incomplete unless these constraints hold:

- primary actions remain reachable at increased text size and browser zoom
- no interaction requires a drag target smaller than the standard touch target budget for the active profile
- focus order remains logical after Compact stacking or Expanded side-by-side composition
- orientation changes do not reset task state
- profile changes do not discard selections, filters, or in-progress edits unless the current surface is explicitly closed

## 14. Verification Matrix

Display-profile verification must cover at least:

| Profile  | Canonical validation viewport |
| -------- | ----------------------------- |
| Compact  | `360 x 640`                   |
| Medium   | `393 x 727`                   |
| Expanded | `800 x 1280`                  |

Required checks:

- no horizontal overflow on primary pages and modal surfaces
- stable access to all existing primary CTAs
- no semantic drift in source selection, scoped navigation, playlist actions, or disk actions
- safe rendering of long names, paths, hostnames, and diagnostics text
- layout-safe behavior with keyboard open and with increased text size or zoom

## 15. Implementation Rules

- Profile resolution must live in one shared resolver.
- Layout branching must happen at shared layout boundaries, not scattered width checks.
- Prefer token or variant changes before component forks.
- Compact-specific structural changes must be explicit and narrow.
- Expanded-specific changes must improve width usage, not merely enlarge whitespace.

## 16. Screenshot Asset Rules

Documentation screenshots under `doc/img/app/` must follow the display-profile contract.

- Medium is the default documentation profile.
- Baseline screenshots that represent the default UI stay in the existing page folders such as `doc/img/app/home/` and `doc/img/app/settings/`.
- Profile-specific screenshots live under `doc/img/app/<page>/profiles/<profile>/`.
- Allowed profile folder names are `compact`, `medium`, and `expanded`.
- Compact and Expanded screenshots should only be generated for surfaces whose visible behavior differs from the Medium baseline.
- Profile-specific modal or browser captures should stay under the same page area, for example `doc/img/app/play/import/profiles/compact/`.
- `npm run screenshots` compares regenerated screenshots against `HEAD` after decoding PNG pixels, so metadata-only PNG byte drift is discarded automatically.
- The prune step accepts only a tightly bounded tolerance: anti-aliased-only differences or at most 8 non-AA diff pixels globally. Anything larger is kept as a real change candidate.
- If screenshot churn appears, debug determinism first: Chromium launch flags, fixed clock seeding, font readiness, and motion suppression are part of the contract. Do not widen the tolerance to hide the churn.

Examples:

- `doc/img/app/home/00-overview-light.png` for the default Medium baseline.
- `doc/img/app/home/profiles/compact/01-overview.png` for a Compact-specific Home view.
- `doc/img/app/play/import/profiles/expanded/02-c64u-file-picker.png` for an Expanded selection-browser surface.
- New shared components must declare how they behave in Compact, Medium, and Expanded before they are considered complete.

## 17. Summary

C64 Commander supports three display profiles:

- Compact for constrained width
- Medium as the canonical mobile baseline
- Expanded for tablet and other wide viewports

The profiles may change composition, density, and presentation style. They must not change source flow, selection scope, playlist semantics, disk semantics, or CTA meaning.
