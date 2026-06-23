---
name: menu-mapping-authoring
description: Use when capturing a new device-menu YAML (a new family or firmware) and bootstrapping its REST<->menu association for the Config-page menu mapping layer, or when re-validating/extending the existing C64U mapping. Covers the draft_association.py authoring aid and the compile-menu-mapping pipeline.
argument-hint: (optional) target such as the family/firmware being mapped, e.g. "u64e 3.14e"
user-invocable: true
disable-model-invocation: true
---

# Menu Mapping Authoring Skill

## Purpose

Add or maintain the **menu ⇄ config mapping layer** that presents REST configuration
using familiar device-menu terminology (Layer A) and, where a menu is captured, the
menu hierarchy (Layer B). The REST `{category,item}` identity stays the canonical
source of truth for read keys and write-back; the mapping only relabels/regroups and
routes everything unmatched to a fallback (it can never hide an item).

Two invariants frame all work here:

- **Lossless / no static gating** — every live `GET /v1/configs` item must render on
  every device. No allow-list, family literal, or category roster gates rendering.
- **C64U terminology is a source, not a gate** — menu labels are reused wherever any
  device exposes the same REST `{category,item}`, never required for an item to show.

## When to use

- A new device menu YAML was captured under `docs/c64/devices/<family>/<ver>/<family>-menu.yaml`
  and needs its association sidecar bootstrapped.
- The C64U mapping needs extension or re-validation after a menu/config sample changes.
- A `npm run menu-mapping:check` drift failure in `npm run lint` needs diagnosis.

Do NOT use for runtime rendering changes alone (that is the React projection layer) or
for renaming REST keys (forbidden — identity is canonical).

## Tools

- `scripts/menu-mapping/draft_association.py` — authoring aid (NOT part of the build).
  Walks a `*-menu.yaml`, auto-matches each settings leaf to a REST item in its target
  category (normalized label match), and prints a review report or emits the
  association YAML. Reusable per family via its top RULES block.
  - `python3 scripts/menu-mapping/draft_association.py` → report
    (matched / menu-only / **UNMATCHED** / unmapped-REST-items).
  - `python3 scripts/menu-mapping/draft_association.py --emit` → write the YAML
    (refuses to emit while any leaf is UNMATCHED).
- `scripts/compile-menu-mapping.mjs` — the real safety net. Reads the association +
  menu YAML, validates against the `*-config.yaml` sample, emits the committed
  `src/lib/config/menuMapping/<family>-<ver>.generated.ts`.
  - `npm run menu-mapping:compile` → regenerate.
  - `npm run menu-mapping:check` → fail (exit 1) on stale generated file or association
    drift. Wired into `npm run lint`; runs in `prebuild`/`predev`/`prestart`.

## Workflow

1. **Confirm sources.** Ensure `<family>-menu.yaml` (hierarchy + labels + kinds) and a
   `<family>-config.yaml` REST sample exist under `docs/c64/devices/<family>/<ver>/`.
   Treat both as reference; never turn YAML `selected:` values into defaults.
2. **Retarget the RULES block** in `draft_association.py` for the new family: MENU/CFG/
   OUT paths, FAMILY/FIRMWARE, and the per-menu-category REST mappings (`DEFAULT_CAT`,
   `SECTION_CAT`, `OVERRIDE`, `ALIAS_SECTIONS`, `EXPLICIT_MENU_ONLY`). Do NOT fabricate a
   hierarchy for a family whose menu was not captured — those families render the
   REST-grouped layout (+ Layer A) until a real menu YAML is added.
3. **Draft + review.** Run the report. Resolve every UNMATCHED leaf via an `OVERRIDE`
   (label differs from REST item) or by listing it menu-only. Sanity-check the
   "unmapped REST items" list — these become `intentionallyUnmapped` (advanced/REST-only)
   and must render in the fallback at runtime.
4. **Emit + register.** `--emit`, review the YAML diff, add the new target to the
   `TARGETS` array in `scripts/compile-menu-mapping.mjs`, register it in the runtime
   resolver (`resolveMenuMapping`), and run `npm run menu-mapping:compile`.
5. **Validate.** `npm run menu-mapping:check`, `npm run typecheck`, then the mapping unit
   tests. Fix every compile/drift error — they are authoring nudges, never runtime gates.

## Safety Rules

- The compile `intentionallyUnmapped` list is a DEV-TIME completeness nudge only; it is
  never consulted at runtime. At runtime, anything unmapped renders in the fallback.
- Never gate Config-page rendering on a static category/item list or family literal.
- Keep the generated `*.generated.ts` committed and never hand-edit it.
- Scope validation to the mapping subsystem; do not require a clean tree or commits.

## Output

A committed association YAML + regenerated `*.generated.ts`, a registered resolver
target, and green `menu-mapping:check` — with any residual menu-only/unverified items
documented in `docs/research/menu-config-mapping/WORKLOG.md`.

## References

- `docs/research/menu-config-mapping/README.md` — Layer A vs Layer B, how to add a family.
- `docs/research/menu-config-mapping/PLANS.md` / `WORKLOG.md` — task context + decisions.
