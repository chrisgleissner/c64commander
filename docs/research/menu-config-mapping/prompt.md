# Implementation prompt — Menu-aligned configuration projection (multi-device)

> This prompt was rewritten after researching the code it touches, so the
> resulting implementation is **modular, consistent, deduplicated, and able to
> evolve** with changing menu/config structures. A condensed map of the relevant
> code (with `file:line` references) is embedded under **"Codebase grounding"**
> so you do not re-derive it. Treat that map as the ground truth for *where*
> things live; re-read the cited files before changing them, because line numbers
> drift.
>
> **Read "Multi-device strategy" before anything else.** The single biggest
> correctness constraint is that the only device menu we have captured is the
> **C64U**; U64/U2 expose the *same REST config model with subtle differences* but
> a *different menu*. The design must apply familiar C64U terminology wherever a
> device shares the same REST item, **without ever** making a REST-exposed item
> unreachable on a device whose menu we have not captured.

---

## ROLE

You are an expert Capacitor, Android, iOS, and web engineer working in the
**C64 Commander / C64U Remote** codebase. You know the Commodore 64 Ultimate
("C64U"), Ultimate 64 ("U64"/"U64E"/"U64E2"), and Ultimate-II ("U2") device
families, and the difference between **internal REST-exposed configuration
names** and **user-visible device-menu terminology**.

Your task: implement a **minimally invasive, modular, maintainable mapping
layer** that presents configuration using familiar device-menu **terminology**
(and, where captured, the device-menu **hierarchy**), while preserving the current
REST-backed configuration model as the internal source of truth **and guaranteeing
that every REST-exposed item on every device — including categories/items we have
never seen — stays visible and editable on the Config page.**

Two non-negotiable invariants frame everything below:

- **Dynamic discovery, no allow-list gating.** The set of categories/items a device
  exposes is whatever `GET /v1/configs` returns at runtime — the firmware builds it
  dynamically from the subsystems compiled into that device (it iterates its live
  `ConfigStore` registrations; there is no static master list). The app must mirror
  this: render *everything* live REST returns. The mapping may **relabel and regroup**
  items, but it must **never** be able to *hide* or *omit* an item. No hard-coded
  category/item list may ever constrain what is displayed.
- **C64U terminology is a source, not a gate.** The C64U menu is our richest source of
  human-friendly names. Apply those names wherever another device exposes the *same*
  REST item, but never require an item to be "known to the C64U menu" in order to show
  it.

---

## Primary goal

Today the configuration page is a near one-to-one projection of the REST API
configuration categories/items. That is accurate but user-hostile: the device's
own menu uses a different hierarchy and slightly different terminology.

Add a **display/projection layer** with two independently-applied parts (see
"Multi-device strategy"):

1. A **terminology overlay** (friendly labels + value formatters), applied on
   **every** device wherever it exposes a REST item we have a friendlier name for.
2. A **menu hierarchy** (grouping into menu pages/sections), applied where we have
   captured that device family's menu. For **C64U** the captured hierarchy is:

   ```
   Disk file browser · CommoServe file search · Memory & ROMs · Turbo boost ·
   Video setup · Audio setup (Audio mixer / Speaker mixer / SID sockets
   configuration / UltiSID configuration / SID addressing / SID player behavior) ·
   Joystick & controllers · LED lighting · Network services & timezone ·
   Wired network setup · Wi-Fi network setup · Modems · Printers · User interface ·
   Built-in drive A · Built-in drive B · System information
   ```

   On a device whose menu we have **not** captured (U64, U2, or any future family),
   the page keeps the **current REST-category grouping** but still applies part 1.

**The REST API stays the internal source of truth.** Do not rename internal REST
category or item keys in the transport, persistence, API client, or write-back
logic. The mapping is a *projection above* the REST model, computed *over live
REST data* — it relabels and regroups, it never adds, removes, or hides items.

---

## Multi-device strategy (READ FIRST — this is the crux)

### The reality of what we have captured

- **Exactly one device menu has been captured:** the **C64U** menu
  (`docs/c64/devices/c64u/1.1.0/c64u-menu.yaml`). There is **no** U64 menu YAML, **no**
  U2 menu YAML, and no U2 device data at all in the repo. Even C64U firmware 3.14 has
  only a *config* YAML, not a menu YAML.
- We **do** have REST *config* samples for several devices/firmwares (use them as
  fixtures): `docs/c64/devices/c64u/{1.1.0,3.14}/c64u-config.yaml`,
  `docs/c64/devices/u64e/{3.12a,3.14a,3.14d,3.14e}/u64e-config.yaml`, and the top-level
  `docs/c64/c64u-config.yaml` (used by the mock loader).
- **All families share roughly the same REST config model, with subtle differences.**
  Items are keyed by their REST name directly, and the *same* REST `{category,item}`
  identity recurs across families — which is exactly why C64U-derived friendly names
  are reusable elsewhere. Confirmed differences across the sampled devices:
  - **C64U-only categories:** `Speaker Mixer`, `Keyboard Lighting` (full-keyboard
    machine with onboard speaker).
  - **U64e-only category:** `Clock Settings` (manual RTC: Year/Month/Day/…). This is a
    *different feature* from C64U network time-sync, which the C64U menu folds under
    `Network services & timezone` › `Time synchronization` (REST items `SNTP Enable`,
    `TimeZone`, `Time Server 1/2/3` living inside `Network Settings`). The C64U menu has
    **no label for `Clock Settings`** — so on U64e those items have no menu home and no
    C64U-equivalent friendly name. They must still render (humanized) and stay editable.

### Firmware-grounded device differences (from `/home/chris/dev/c64/1541ultimate`)

The firmware defines categories per-subsystem and compiles them per build target, so the
category set is **structurally different across hardware** (file:line refs in the firmware
source; granularity is "enough to design against", not exhaustive):

- **Build gating:** `C64 Ultimate` and `U64 Elite` build the **same** firmware
  (`-DU64=1`) ⇒ they expose the **same** category set and (being the same on-device menu
  code) the C64U *hierarchy* is the closest fit for a U64 Elite too. `U64 Elite-II`
  (`-DU64=2`) and the `Ultimate-II` **cartridge** (`-DU2`, no U64 code) differ.
- **Shared base (all targets):** `C64 and Cartridge Settings`, `Printer Settings`,
  `Tape Settings`, `SoftIEC Drive Settings`, `Modem Settings`, `Ethernet Settings`,
  `Network Settings`, `User Interface Settings`, `Drive A/B Settings`, `Data Streams`.
- **U64 family only (U64==1 and ==2):** `Audio Mixer`, `UltiSID Configuration`,
  `SID Addressing`, `LED Strip Settings`, and — **FPGA-capability-gated at runtime** —
  `SID Sockets Configuration` and `U64 Specific Settings`. None of these exist on a **U2
  cartridge**, which instead exposes **`Audio Output Settings`** (a different category for
  different hardware) and keeps `Clock Settings`.
- **U64ii adds:** `Speaker Mixer` (`#if U64==2`) and `WiFi settings` (ESP32). U64ii
  notably **drops `Clock Settings`** (uses a dummy RTC).
- **Runtime (not just compile-time) gating:** `SID Sockets Configuration` and `U64
  Specific Settings` depend on a live FPGA capability check — so even two devices on the
  same firmware can present different categories.

**Why this matters for the design (do not skip):** the *captured samples already disagree
with the current firmware source* — e.g. `Speaker Mixer`/`Keyboard Lighting`/`WiFi
settings` appear in sampled C64U/U64e configs where the present firmware gates them to
other variants. That drift is **expected and permanent**: firmware versions, board
variants, and runtime FPGA capabilities all shift the set. **No static source — a captured
sample, a grep of firmware HEAD, or a `ProductFamilyCode` literal — can reliably predict a
given device's categories.** The only authority is that device's live `GET /v1/configs`.
This is the concrete justification for the no-hard-coding invariant: build the projection
so it is *indifferent* to which categories exist, mapping the ones it recognizes and
passing everything else straight through to the user.

### Why discovery MUST stay dynamic (firmware grounding)

`/v1/configs` is **not** a fixed schema. The firmware
(`/home/chris/dev/c64/1541ultimate`) builds the category list at runtime by iterating
its registered `ConfigStore` objects (`route_configs.cc` walks `cfg->getStores()`); each
hardware subsystem registers its own store, and a category exists **iff** that subsystem
is compiled/instantiated on that device. There is **no static master list** of categories
in the firmware. (This is also why `docs/research/device-discovery/firmware-capabilities.md`
states config categories "differ by device … observable from `GET /v1/configs` at runtime".)

**Consequence — the hard rule:** the app must display **everything** `GET /v1/configs`
returns, on every device, with **no allow-list, denylist, or per-family category roster**
deciding what is shown. The mapping layer may move an item to a friendlier place and give
it a friendlier name; it must be *structurally incapable* of dropping one. A category or
item the codebase has never seen (a future firmware, a U2 cartridge, a family we have no
sample for) MUST appear on the Config page automatically.

### The two layers (apply independently)

Separate the two concerns the original single artifact conflated. This is what makes the
work both **low-risk** and **cross-device**:

| Layer | Keyed by | Source | Applies on | Risk |
|---|---|---|---|---|
| **A. Terminology overlay** — friendly label + `formatterId` per item | REST `{category,item}` | C64U menu YAML (richest name source) | **Every** device that exposes that REST item | Low — purely additive relabel via existing `ConfigItemRow` props; cannot affect fetch/grouping/write-back |
| **B. Menu hierarchy** — which menu page/section an item lives under, multi-category grouping, aliases | `family + firmwareVersion` | A captured device menu YAML (only C64U 1.1.0 today) | Only when a menu for that family/firmware resolves; else current REST-category grouping | Higher — gated to where we have ground truth |

- **Layer A always runs.** Build it as a reverse index `{category,item} → {label, formatterId}`
  derived from the (C64U) menu YAML. On any device, for any live REST item: if the index
  has a friendly label, show it; otherwise fall back to the acronym-preserving humanizer
  (see "Label casing rules"). This delivers "familiar terminology where possible" on
  U64/U2 *without* a per-device menu.
  - Guard: an overlay entry is a cosmetic case/spacing/acronym fix or a clearly safe
    rename of a *shared* item. If a specific C64U label would be **misleading** on another
    family, scope that one entry to C64U; default is shared.
- **Layer B runs only when `resolveMenuMapping(family, firmwareVersion)` returns a
  hierarchy.** When it returns `null` (U64, U2, unmapped firmware), the page renders the
  **current REST-category-grouped layout** — but Layer A still relabels within it. The
  result: C64U gets the full menu tree; everyone else gets today's layout with friendlier
  names; nobody loses access to anything.

### Degradation ladder (must hold for every device)

1. C64U on a firmware whose menu resolves → full menu hierarchy (Layer B) + friendly
   labels (Layer A) + REST-only fallback section for anything the hierarchy didn't claim.
2. C64U on a firmware with no exact menu → nearest-version C64U menu (resolver fallback
   chain), Layer A labels, and **new/unknown items from that firmware auto-route to the
   REST-only fallback section** (never dropped).
3. U64 / U2 / unknown family → no Layer B; current REST-category grouping; Layer A labels
   where the item is shared; everything reachable by definition (it *is* the live REST
   layout, only relabeled).

At **every** rung, the invariant holds: **the page is a complete, lossless view of live
`GET /v1/configs`.** A regression test must assert this against each sampled device fixture
(C64U 1.1.0/3.14, U64e 3.12a/3.14e) plus a synthetic unknown-category config.

---

## How to work (execution contract)

1. Create the plan file **`docs/research/menu-config-mapping/PLANS.md`** (see
   "Plan & worklog deliverables" — note this is **not** the repo-root `PLANS.md`).
2. After creating it, **begin implementation immediately and continue
   autonomously** until all acceptance criteria are met. Keep `PLANS.md` current.
3. Maintain **`docs/research/menu-config-mapping/WORKLOG.md`** with concise,
   factual notes: decisions, files changed, tests run, remaining risks.
4. Do not push branches, open PRs, or do release work unless explicitly asked.

---

## Codebase grounding (researched — read before you build)

### Authoritative input files (note the **lowercase** paths)

- **Menu extraction — C64U ONLY** (hierarchy + menu labels + node kinds):
  `docs/c64/devices/c64u/1.1.0/c64u-menu.yaml`. This is the *only* captured menu in the
  repo. There is no U64/U2 menu YAML. It is the source for Layer A (terminology) and the
  one family that gets Layer B (hierarchy).
- REST config schema sample (canonical category/item names + options):
  `docs/c64/devices/c64u/1.1.0/c64u-config.yaml`
- **Cross-device REST config fixtures (use these to prove device-universal reachability):**
  `docs/c64/devices/c64u/3.14/c64u-config.yaml` (newer C64U firmware; slightly different
  item set — exercises the intra-family version fallback + unknown-item routing) and
  `docs/c64/devices/u64e/{3.12a,3.14a,3.14d,3.14e}/u64e-config.yaml` (U64 family — has
  `Clock Settings`, lacks `Speaker Mixer`/`Keyboard Lighting`; exercises the no-Layer-B
  path with Layer A still applied).
- Supporting reference: `docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml`,
  `docs/c64/devices/c64u/1.1.0/c64u-config.cfg`
- The mock/demo loader uses the **top-level** `docs/c64/c64u-config.yaml` (see
  `src/lib/mock/mockConfig.ts`), so your projection must also work against that
  fixture in demo/test mode.
- **Firmware ground truth** for *why* the category set is dynamic and device-specific:
  `/home/chris/dev/c64/1541ultimate` (per-subsystem `ConfigStore` registrations;
  `software/api/route_configs.cc` enumerates them live) and the summary in
  `docs/research/device-discovery/firmware-capabilities.md`. Consult these — do **not**
  re-encode the firmware's category set as a static list in the app.

**The menu YAML is already structured** as `config.menu_tree` (the hierarchy) +
`config.categories.<MenuCategory>.items.<MenuLabel>` with `kind: section |
action | password | file_picker` and nested `items`. It is keyed by **menu
labels**, not REST keys, and its own header states: *"It is a menu extraction,
not yet a completed REST-to-menu mapping."* Your job is to supply that
REST-to-menu association.

Treat both YAMLs as **reference**, not runtime defaults:
- Do **not** use `selected:` values as application defaults or expected live values.
- Some scalars may be mis-parsed (`OFF`, `On`, `Yes`, `No` unquoted) — do not
  infer type semantics from sample values.
- Use **live REST** for current values/options; menu YAML for hierarchy/labels;
  REST YAML for canonical REST names.

### REST configuration data model (the internal source of truth)

- Types: `ConfigCategory`, `ConfigResponse` in `src/lib/c64api.ts` (~`:527`);
  normalized item shape `NormalizedConfigItem` in
  `src/lib/config/normalizeConfigItem.ts` (`{ value, options?, details? }`),
  value extraction in `src/lib/config/configValueExtractor.ts` (tolerates
  `selected`/`value`/`current`/… shapes).
- **Identity = `{ category: string, item: string }`** — exact firmware strings,
  no normalization. There is no separate ID layer. Use this as your stable
  REST pointer.
- Read hooks (`src/hooks/useC64Connection.ts`): `useC64Categories`,
  `useC64Category(category)`, `useC64ConfigItem(category,item)`,
  `useC64ConfigItems(category, items[])`, `useC64AllConfig()`. **All per-category
  hooks are keyed by `routingEpoch`** (incremented on `"c64u-connection-change"`)
  so in-flight reads abort on connection handoff — see
  [[config-reads-aborted-on-connect]]. `useC64AllConfig` tolerates per-category
  failures.
- Write path (`src/lib/c64api.ts`): `setConfigValue` →
  `PUT /v1/configs/{cat}/{item}?value=…` (single item, **no body**);
  `updateConfigBatch` → single-item payloads routed to **PUT**, true multi-item to
  `POST /v1/configs`. **Single writes must stay PUT** — POST buffers the body to a
  tempfile and kills the device's network stack — see
  [[led-slider-post-configs-crash]] and `docs/research/config-update-api-approaches.md`.
- Safeguards you MUST preserve: `src/lib/config/configWriteThrottle.ts` (serial
  queue + cooldown/backoff, resettable by generation),
  `src/hooks/useInteractiveConfigWrite.ts` (coalesces rapid writes — latest
  intent, debounced reconciliation), `src/lib/config/validateConfigWrite.ts`
  (enum/range validation), `src/lib/config/deviceSafetySettings.ts` (cooldown
  modes), CPU-Speed space-padding + Turbo/CPU write-ordering in `c64api.ts`.
- Known item-name constants already centralized:
  `src/lib/config/configItems.ts`.

### Configuration page UI

- Page: `src/pages/ConfigBrowserPage.tsx`, route `/config` (registered via
  `src/components/.../SwipeNavigationLayer.tsx` + `tabRoutes.ts`). Inner
  `CategorySection` renders a collapsible per-category section; items render via
  **`src/components/ConfigItemRow.tsx`**.
- **Control type** is inferred in `src/lib/config/controlType.ts`
  (`inferControlKind({name, category, currentValue, possibleValues})` →
  `password|checkbox|slider|select|text`). It keys off **REST `name`/`category`**.
- **`ConfigItemRow` already exposes the display hooks you need:** props
  `label?`, `labelClassName?`, `formatOptionLabel?`, `readOnly?` — and
  `displayLabel = label ?? name`. This is your injection point: pass the **menu
  label** as `label`, a display formatter as `formatOptionLabel`, while still
  passing the **REST `name`/`category`** for control-type inference and
  write-back.
- Edits flow `onValueChange` → `useC64SetConfig` / `useC64UpdateConfigBatch`
  carrying `{category, item, value}` (REST identity).
- Optimistic/echo state: `src/hooks/useAuthoritativeConfigValueState.ts`,
  **currently keyed by `itemName` within a category section**. ⚠️ See "Hazards".
- **Pre-existing scattered special-cases** that this work should *consolidate*
  (or at minimum not multiply): CPU-Speed write-guard
  (`category === "U64 Specific Settings" && name === "CPU Speed"`), Audio Mixer
  "Reset", Clock "Sync", Ethernet/Wi-Fi DHCP field-disabling. Prefer expressing
  these as mapping metadata over hard-coded `if`s in JSX.
- Existing tests to keep green / extend:
  `tests/unit/pages/ConfigBrowserPage.test.tsx`,
  `tests/unit/components/ConfigItemRow*.test.tsx`,
  `tests/contract/lib/config.test.ts`, and Playwright
  `playwright/configEditingBehavior.spec.ts`, `configVisibility.spec.ts`,
  `homeConfigManagement.spec.ts`, `demoConfig.spec.ts`.

### Device family / firmware / capability gating (the versioning substrate)

- `ProductFamilyCode = "C64U"|"U64"|"U64E"|"U64E2"|"U2"`
  (`src/lib/savedDevices/store.ts`), `DeviceFamily = ProductFamilyCode|"unknown"`.
- Capability model: `src/lib/deviceCapabilities/capabilityModel.ts` —
  `deriveDeviceCapabilities(input) → DeviceCapabilities { family, firmwareVersion,
  coreVersion, supports* }`. **This is the pattern to mirror** for a versioned
  mapping resolver.
- **Governing principle (do not violate):** *no product-family literal as a
  feature gate — derive from live runtime signals.* See the header doc-comment in
  `capabilityModel.ts` and `docs/research/device-discovery/firmware-capabilities.md`.
  Reconciliation for this task: the mapping is a **display overlay projected over
  whatever `GET /v1/configs` actually returns**. It never asserts an item exists;
  it relabels/regroups live items and routes everything unmatched to a fallback.
  - The capability model itself states `family` is **"for display/labels only — it
    is NEVER used as a feature gate."** `resolveMenuMapping` uses `family +
    firmwareVersion` strictly to *select which captured menu hierarchy (Layer B) to
    paint* — a pure display/labels concern, squarely within that allowance. It must
    **never** decide *whether* an item renders: that is governed only by live
    `GET /v1/configs`. Layer A (terminology) does not consult family at all — it is
    keyed by REST `{category,item}`.
  - Corollary you'll hit: a **C64U is internally U64-family**, which is *why* its
    REST exposes the `U64 Specific Settings` category. Expect it; do not "fix" it.
- Connected identity (family + `firmware_version` + `core_version`) is on
  `useC64Connection().status.deviceInfo`. Per-version `docs/c64/devices/...`
  folders are **docs-only at runtime today** — no code loads them yet.

### Terminology / labels / formatters already in the repo (REUSE, don't duplicate)

- i18n is a minimal custom `t(key, fallback)` (en-only) in `src/lib/i18n/` —
  config item/category text is **not** translated today; do not over-invest here.
- Value formatters to **reuse directly**:
  - `src/lib/ui/sliderValueFormat.ts` — `formatDbValue` (**already trims the
    leading space**, e.g. `" 0 dB"` → `"0 dB"`, and renders `+N dB`) and
    `formatPanValue`.
  - `src/lib/config/sidDetails.ts` — `formatAddressValue` (`$XXXX`/`Unmapped`),
    plus `SID_LAYOUT` (a label↔item table — a *fragment of the mapping you're
    building*; reference, don't fork).
  - `src/pages/home/utils/uiLogic.ts` — `formatSelectOptionLabel`,
    `normalizeOptionToken`, `parseNumericOption`.
- Existing mapping **fragments to consolidate/reference, not duplicate**:
  `src/lib/lighting/constants.ts` `LIGHTING_SURFACE_TO_CATEGORY`
  (`case → "LED Strip Settings"`, `keyboard → "Keyboard Lighting"`),
  `src/pages/home/constants.ts` (`HOME_CONFIG_OPTION_DOMAINS`,
  `DRIVE_CONTROL_SPECS`), `src/lib/config/homeStreams.ts` (`STREAM_LAYOUT`),
  `src/lib/sourceNavigation/sourceTerms.ts` (`SOURCE_LABELS`).
- **No acronym-aware case helper exists.** Because the **menu YAML is the label
  authority**, you will rarely need to case-transform mapped items. Build a small
  acronym-preserving humanizer **only** for the REST-only/fallback area (items
  with no menu label) — see "Label casing rules".
- `src/lib/telnet/telnetTypes.ts` `TELNET_ACTIONS` already encodes a device-menu
  taxonomy (`"Built-in Drive A"`, `"Built-in Drive B"`, `"Software IEC"`,
  `"Power & Reset"`, `"Printer"`, `"Configuration"`). Your config-menu hierarchy
  must be **consistent** with these names (e.g. "Built-in drive A") — do not
  introduce a third, divergent menu taxonomy.

### Repo conventions you MUST follow (this is what makes it evolvable)

The repo has a strong, consistent **"authoritative source → committed generated
TS → runtime consumer → fail-fast `:check` in `npm run lint`"** pattern. Mirror
it exactly:
- Exemplar: `src/lib/config/feature-flags.yaml` →
  `scripts/compile-feature-flags.mjs` →
  `src/lib/config/featureFlagsRegistry.generated.ts` (committed) →
  `src/lib/config/featureFlags.ts`, validated by `feature-flags:check` (wired into
  `npm run lint`). Generated TS is committed so fresh clones type-check.
- Drift-guard exemplar: `scripts/check-stale-variant-names.mjs` +
  `tests/unit/scripts/checkStaleVariantNames.test.ts` (exported helpers,
  allowlist, `exit(1)` on offenders, a unit test asserting "no offenders").
- There is already a config-drift test to model REST cross-checks on:
  `tests/unit/lib/diagnostics/configDrift.test.ts` (mocks `getC64API`
  `getCategories`/`getCategory`).
- Generated artifacts live in `src/generated/` (e.g. `variant.ts`).
- Tests: dual Vitest projects `unit-jsdom` (React) / `unit-node` (pure logic) in
  `vitest.config.ts`; tests under `tests/unit/**` mirroring `src/`; fixtures via
  `setMockConfigLoader(() => yaml)` and `createMockC64Server(initial, itemDetails)`
  (`tests/mocks/mockC64Server.ts`); render with raw RTL + a
  `QueryClientProvider` wrapper; **91% line + 91% branch** coverage gate
  (`scripts/check-coverage-threshold.mjs`); value-assertions, **no snapshots**.

---

## Required architecture

Build a **data-driven projection** from REST config → menu-facing view model,
structured as the **two independent layers** from "Multi-device strategy". It must
support: one REST item in exactly one primary menu location; the same REST item shown
in multiple locations as **aliases over shared state**; one menu section composed of
REST items from **different** REST categories; REST-only items absent from the menu;
menu-only actions/status entries that are not persistent REST config; **device/firmware
evolution without touching React components**; graceful **fallback to the current
REST-grouped layout** when no menu hierarchy exists for a device/firmware; and — above
all — **lossless rendering of every live REST item on every device**.

Implement these pieces (names are suggestions; match local conventions):

1. **Mapping artifact (one captured menu YAML → two derived structures).**
   *Recommended (matches the feature-flags convention):* author a REST-association
   source that carries **only what the menu YAML lacks** — for each menu leaf
   (identified by its menu path) a `restPointer {category,item}`, optional
   `aliasOf`, `formatterId`, and `restOnly`/`menuOnly` (`action`/`status`) flags —
   then a `scripts/compile-menu-mapping.mjs` reads `c64u-menu.yaml` (labels +
   hierarchy + kinds) **+** that association **+** validates against
   `c64u-config.yaml`, and emits a committed `src/lib/config/menuMapping/c64u-1.1.0.generated.ts`.
   From that one source, expose **both** derived structures:
   - **(1a) Terminology overlay (Layer A) — device-agnostic.** A flat reverse index
     `restKey({category,item}) → {label, formatterId}` covering every leaf that has a
     `restPointer`. This is consumed on **all** devices and carries **no hierarchy**.
   - **(1b) Menu hierarchy (Layer B) — C64U 1.1.0.** The typed menu tree
     (`displayLabel` from the YAML, `restPointer`(s) from the association, node `kind`).
   This keeps **labels in exactly one place (the YAML)** and REST identity in exactly
   one place (the association), cross-checked at build time. *Acceptable alternative* if
   compile tooling is judged overkill: a hand-written typed module per version + the
   drift checker loading the committed YAMLs to validate it. Either way: **typed,
   versioned, centralized, test-covered; no labels duplicated across React components.**

2. **Hierarchy resolver (Layer B only)** — mirror `deriveDeviceCapabilities`. Put it
   beside the capability model or under `src/lib/config/menuMapping/`:
   `resolveMenuMapping({family, firmwareVersion}) → hierarchy | null`. Fallback chain:
   exact `family+version` → nearest lower version **within the same family** → latest
   within family → `null`. `null` ⇒ no Layer B for this device ⇒ the page renders the
   **current REST-category-grouped layout**. **Never** cross families (a U64 must not
   borrow the C64U *hierarchy* — only the shared Layer A labels travel across families).
   The terminology overlay (1a) needs **no** resolver; it always applies.

3. **Projection function (pure, node-testable)** —
   `projectConfigToMenu(liveRestConfig, { hierarchy, overlay }) → { tree, drift }`.
   - **If `hierarchy` is present:** for each hierarchy node, resolve its `restPointer`
     against **live** REST data and emit a view-model node carrying `displayLabel`,
     `menuPath`, `restPointer`, current value, options, editability, `formatterId`, and
     alias metadata.
   - **If `hierarchy` is null:** emit the REST-category-grouped tree directly from live
     data (today's layout), applying `overlay` labels/formatters per item.
   - **In BOTH branches, apply the overlay** to every emitted leaf (overlay label wins
     over the raw REST name; otherwise humanize), and then:
     - **Unmapped-live detection:** any live REST `{category,item}` not claimed by the
       hierarchy → route into the **fallback section**. This is the mechanism that keeps
       unknown *future* REST items, U2-only categories, and device-specific categories
       (e.g. U64e `Clock Settings`) reachable. Record in `drift.unmappedRestItems`.
       **This routing is unconditional and data-driven — it must not consult any
       allow-list to decide whether to render** (see #5).
     - **Stale-mapping detection:** any `restPointer` with no matching live item → omit
       from the tree (never error at runtime) and record in `drift.staleMappingRefs`.
       (This is normal cross-firmware/device behavior, e.g. `Speaker Mixer` on a U64.)
     - **Menu-only nodes** (`kind: action|status`, or leaves with no `restPointer`) are
       rendered as non-persistent UI per "UI requirements" — never fabricated as config.
   - **Lossless guarantee:** `projectConfigToMenu` must emit a node for **every** live
     REST `{category,item}` exactly once (mapped *or* in fallback). Add an assertion/test
     that the set of REST identities in the output tree equals the set in the input.

4. **UI rendering** — `ConfigBrowserPage` renders the projected tree; keep the
   existing write-back pipeline and all safeguards. No per-item string hacks in
   JSX — labels/formatters come from the view model.

5. **Drift checker (a C64U authoring aid — NOT a runtime gate).** `scripts/compile-menu-mapping.mjs
   --check` (or a dedicated `scripts/check-menu-mapping-drift.mjs`) wired into
   `npm run lint`, plus `tests/unit/scripts/*.test.ts`, modeled on
   `check-stale-variant-names.mjs`/`configDrift.test.ts`. It validates the **C64U**
   hierarchy against the **C64U** config sample only (`c64u-config.yaml` — never another
   device's config), and fails on: C64U-known REST items neither mapped nor in an
   explicit "intentionally-unmapped (advanced)" list, stale mapping pointers, label drift
   between mapping and `c64u-menu.yaml`, and any menu leaf lacking both a `restPointer`
   and a `menuOnly` flag. **Crucial:** that "intentionally-unmapped" list is a *dev-time
   completeness nudge for C64U authoring only*. It MUST NOT exist in, or be consulted by,
   the runtime projection — at runtime, anything unmapped renders in the fallback section
   unconditionally, on every device. The checker must never assert "these are all the
   categories that exist" — there is no such closed set.

6. **Fallback area (the device-universal safety net)** — a clearly distinguished section
   (e.g. **"Advanced (REST-only) settings"**) that renders **everything the active
   hierarchy does not claim**, so no configuration item is ever unreachable — on C64U
   (advanced/unmapped items), on U64/U2 (when there is no Layer B, this *is* effectively
   the whole page, REST-grouped + relabeled), and for any unknown future category.

Hard rules: do **not** scatter string replacements through React components; do
**not** mutate REST responses into menu shapes before write-back; do **not** gate
rendering on any static category/item list; keep canonical REST identity intact
end-to-end.

---

## The mapping data (initial baseline for C64U 1.1.0)

This is the **C64U 1.1.0** association — it feeds **both** Layer A (the device-agnostic
terminology overlay, via each row's REST↔label pair) **and** Layer B (the C64U menu
hierarchy). Use the tables below as the **REST → menu-path association** (the data for
piece #1). **Display labels come from `c64u-menu.yaml`** at the target path; the "Menu
label" columns must match it (the drift checker enforces this). Map **all** items a
category exposes by walking live REST ∪ menu YAML — the lists below are the non-obvious
cases, not an exhaustive enumeration (e.g. `Printer Settings` also has `Emulation`; map
it too).

Verify every REST name below against `c64u-config.yaml` before encoding
(researched and confirmed present as of fw 1.1.0).

**Cross-device handling of categories absent from these tables** (e.g. U2 cartridge
`Audio Output Settings`, U64e `Clock Settings`, anything from a future firmware): they
are **not** errors and **not** to be added speculatively to the C64U hierarchy. On a C64U
they simply won't appear in live REST (stale-mapping detection ignores their absence); on
another device they arrive via live REST and flow to the **fallback section**, relabeled
by Layer A where a shared friendly name exists and humanized otherwise. A category mapped
here but missing on a given device (e.g. `Speaker Mixer`/`Keyboard Lighting` on a plain
U64, which the firmware gates to other variants) is likewise just omitted at runtime — no
fabrication, no error.

### Category-level placement

| REST category | Menu location |
|---|---|
| `Audio Mixer` | `Audio setup` › `Audio mixer` |
| `Speaker Mixer` | `Audio setup` › `Speaker mixer` |
| `SID Sockets Configuration` | `Audio setup` › `SID sockets configuration` |
| `UltiSID Configuration` | `Audio setup` › `UltiSID configuration` |
| `SID Addressing` | `Audio setup` › `SID addressing` |
| `U64 Specific Settings` | **Split** across `Video setup`, `Joystick & controllers`, `Audio setup` › `SID player behavior`, `Turbo boost`, `LED lighting` › `Power LED (if installed)` (rest → fallback) |
| `C64 and Cartridge Settings` | Mostly `Memory & ROMs` (rest → fallback) |
| `SoftIEC Drive Settings` | No supplied menu page → fallback/advanced |
| `Printer Settings` | `Printers` |
| `Network Settings` | `Network services & timezone` (+ nested `Services`, `Time synchronization`) |
| `Ethernet Settings` | `Wired network setup` |
| `WiFi settings` | `Wi-Fi network setup` |
| `Tape Settings` | No supplied menu page → fallback/advanced |
| `LED Strip Settings` | `LED lighting` › `Case lights` |
| `Keyboard Lighting` | `LED lighting` › `Keyboard lights` |
| `Drive A Settings` | `Built-in drive A` (+ ROM aliases under `Memory & ROMs` › `Drive A`) |
| `Drive B Settings` | `Built-in drive B` (+ ROM aliases under `Memory & ROMs` › `Drive B`) |
| `Data Streams` | No supplied menu page → keep reachable (fallback/advanced or existing streaming area). **Do not hide.** |
| `Modem Settings` | `Modems` (+ nested `Handshaking`, `Automated responses`, `Tweaks`) |
| `User Interface Settings` | `User interface` |

### `U64 Specific Settings` (the hardest split)

`Video setup`: `System Mode`→`System mode`, `HDMI Scan Resolution`→`HDMI scan
resolution`, `HDMI Scan lines`→`HDMI scan lines`, `Palette Definition`→`Palette
definition`, `Analog Video Mode`→`Analog video mode`, `Digital Video
Mode`→`Digital video mode`.

`Joystick & controllers`: `Joystick Swapper`→`Joystick input`. (Note: the menu's
`Paddle override` has **no REST item** in 1.1.0 → treat as menu-only/absent, not a
fabricated config item.)

`Audio setup` › `SID player behavior`: `SID Player Autoconfig`→`SID player
autoconfig`, `Allow Autoconfig uses UltiSid`→`Allow autoconfig uses UltiSID`.

`Turbo boost`: `Turbo Control`→`Turbo control`, `CPU Speed`→`CPU speed`,
`Badline Timing`→`Badline timing`, `SuperCPU Detect (D0BC)`→`SuperCPU detect
(D0BC)`. (Preserve the existing CPU-Speed/Turbo write-ordering + padding
safeguards.)

`LED lighting` › `Power LED (if installed)`: `LED Select Top`→`Output 1`,
`LED Select Bot`→`Output 2`.

Fallback/advanced (no clear menu home in 1.1.0): `C64U Model`, `HDMI Tx Swing`,
`UserPort Power Enable`, `Adjust Color Clock`, `Serial Bus Mode`, `SpeedDOS
Parallel Cable`, `Burst Mode Patch`.

### `C64 and Cartridge Settings` → `Memory & ROMs`

`Kernal ROM`→`Kernal ROM`, `Basic ROM`→`BASIC ROM`, `Char ROM`→`Character ROM`,
`Cartridge`→`Cartridge`, `RAM Expansion Unit`→`RAM expansion unit`,
`REU Size`→`Size`, `Map Ultimate Audio $DF20-DFFF`→`Ultimate audio`,
`Command Interface`→`Command interface`.

Fallback/advanced: `Cartridge Preference`, `Bus Operation Mode`, `Bus Sharing -
ROMs`, `Bus Sharing - I/O1`, `Bus Sharing - I/O2`, `Bus Sharing - Interrupts`,
`Fast Reset`, `REU Preload`, `REU Preload Image`, `REU Preload Offset`,
`DMA Load Mimics ID:`.

### Audio setup label corrections (display only)

`Vol UltiSid 1/2`→`Vol UltiSID 1/2`; `Vol Socket 1/2`→`Vol socket 1/2`;
`Vol Sampler L/R`→`Vol sampler L/R`; `Vol Drive 1/2`→`Vol drive 1/2`;
`Vol Tape Read/Write`→`Vol tape read/write`; `SID Socket 1/2 1K Ohm
Resistor`→`SID socket 1/2 1K ohm resistor`; `Auto Address Mirroring`→`Auto addr
mirroring`. Keep any existing **`Visual SID address editor`** as a menu-only
action (it is not a REST item).

### Network

`Network Settings` → `Network services & timezone`. Top level: `Host Name`→`Host
name`, `Unique ID`→`Unique ID`, `Network Password`→`Network password` (password
field — masked). `Services` section: `Ultimate Ident Service`/`Ultimate DMA
Service`/`Telnet Remote Menu Service`/`FTP File Service`/`Web Remote Control
Service` (sentence-case, keep acronyms), `Log to Syslog Server`→`Log to Syslog
server`. `Time synchronization` section: `SNTP Enable`→`SNTP enable`,
`TimeZone`→`Timezone`, `Time Server 1/2/3`→`Time server 1/2/3`.

`Ethernet Settings` → `Wired network setup`; `WiFi settings` → `Wi-Fi network
setup`: both expose `Use DHCP`, `Static IP`, `Static Netmask`→`Static netmask`,
`Static Gateway`→`Static gateway`, `Static DNS`. Preserve the existing
DHCP-disables-static-fields behavior (express it as mapping metadata if feasible).

**Menu-only entries (NOT REST config — do not fabricate):** Wi-Fi `Enable`,
`Disable`, `Disconnect`, `Connect to last AP`, `Select AP from list`, `Enter AP
manually`, `Forget APs`, `Status`; and the `Status` sub-sections under **both**
Wired and Wi-Fi (`Status`/`Active IP address`/`Interface MAC`/`Connected to`).
Implement actions only if a real endpoint/app action already exists; otherwise
omit or render disabled per existing UI conventions. (The original spec called out
only Wi-Fi actions — generalize: any menu `kind: action|status` leaf is
menu-only.)

### LED lighting

`Power LED (if installed)`: `LED Select Top`→`Output 1`, `LED Select Bot`→`Output
2`. `Case lights` ← `LED Strip Settings`; `Keyboard lights` ← `Keyboard Lighting`
(reuse `LIGHTING_SURFACE_TO_CATEGORY`): `LedStrip Mode`→`Mode`, `LedStrip Auto SID
Mode`→`Music detect`, `LedStrip Pattern`→`Pattern`, `Strip Intensity`→`Brightness`,
`Fixed Color`→`Color`, `Color tint`→`Tint`. `LedStrip SID Select` is REST-only
(not in menu) → keep reachable within the relevant lighting section's
advanced/fallback.

### Drives

`Drive A Settings` → `Built-in drive A` (and `Drive B Settings` → `Built-in drive
B`, same shape). Top level: `Drive`→`Drive`, `Drive Type`→`Drive type`, `Drive
Bus ID`→`Drive bus ID`. `ROMs` section: `ROM for 1541/1571/1581 mode` (same
labels). `Advanced` section: `Extra RAM`, `Disk swap delay`, `Resets when C64
resets`, `Freezes in menu`, `GCR Save Align Tracks`→`GCR save align tracks`,
`Leave Menu on Mount`→`Leave menu on mount`, `D64 Geos Copy Protection`→`D64 GEOS
copy protection`.

**Aliases:** the `ROM for 15x1 mode` items also appear under `Memory & ROMs` ›
`Drive A`/`Drive B`. Alias nodes must point at the **same** REST `{category,item}`
so edits from either location mutate one source — see "Hazards".

### Modems → `Modems`

Top level: `Modem Interface`→`Modem interface`, `ACIA (6551) Mapping`→`ACIA (6551)
mapping`, `Hardware Mode`→`Hardware mode`, `Listening Port`→`Listening port`.
`Handshaking`: `Do RING sequence (incoming)`, `Drop connection on DTR low`, `RTS
Handshake (Rx)`→`RTS handshake (Rx)`, `CTS Behavior`→`CTS behavior`, `DCD
Behavior`→`DCD behavior`, `DSR Behavior`→`DSR behavior`, `Automatic Rx
Pushback`→`Automatic Rx pushback`. `Automated responses`: `Modem Offline/Connect/
Busy Text`→`Modem offline/connect/busy text`. `Tweaks`: `Set Socket Opt
TCP_NODELAY`→`Set socket opt TCP_NODELAY`, `Loop Delay`→`Loop delay`.

### Printers → `Printers`

Use the menu labels from `c64u-menu.yaml`, preserving acronyms: `IEC printer`,
`Bus ID`, `Output file`, `Output type`, `Ink density`, `Page top margin (default
is 5)`, `Page height (default is 60)`, `Emulation`, `Commodore charset`, `Epson
charset`, `IBM table 2`.

### User interface → `User interface`

`Interface Type`→`Interface type`, `Navigation Style`→`Navigation style`, `Color
Scheme`→`Color scheme`, `Auto Save Config`→`Auto save config`, `Ulticopy Uses
disk name`→`Ulticopy uses disk name`, `Filename overflow squeeze` (same).

---

## Value display rules

Display-only transforms; **never** corrupt the value sent back to REST (preserve
option identity for write-back). Apply small explicit formatters, not a global
case conversion (options contain acronyms, addresses, filenames, exact firmware
strings).

- **Reuse `formatDbValue`** (`src/lib/ui/sliderValueFormat.ts`) — it already
  trims `" 0 dB"` → `"0 dB"`. Do not re-implement dB trimming.
- **CPU Speed:** REST options are bare (`" 1"`, `" 2"`, … — see
  `HOME_CPU_SPEED_OPTIONS`) but the menu shows `1 MHz`. Add a display formatter
  that appends `MHz`. Keep the raw padded value for write-back.
- **`Disk swap delay` / `Loop Delay` (ms):** the menu sample shows ms while REST
  is numeric. **Verify before applying any multiplier** — check
  `1541ultimate/` firmware, `docs/c64/c64u-rest-api.md`, and existing code;
  sample `selected:` values are not authoritative. If unconfirmed, display the raw
  value (optionally with a `ms` suffix only if certain). Document the decision in
  `WORKLOG.md`.
- **Passwords:** masked in display; never leak into logs, diagnostics, tests,
  screenshots, or analytics. (`ConfigItemRow` already infers a `password` control
  kind for names containing "password".)

Put any genuinely new formatters in one small module (e.g.
`src/lib/config/menuValueFormatters.ts`) referenced by `formatterId`, and reuse
the existing `formatDbValue`/`formatPanValue`/`formatAddressValue`/`uiLogic`
helpers rather than duplicating them.

---

## Label casing rules

The **menu YAML is authoritative** for mapped labels — do not invent "nicer"
labels where the YAML provides one. The acronym-preserving humanizer is only for
the **REST-only/fallback** area (items with no menu label). Preserve these tokens
exactly: `C64`, `C64U`, `U64`, `U2`, `SID`, `UltiSID`, `ROM`, `RAM`, `REU`, `IEC`,
`DMA`, `FTP`, `SNTP`, `IP`, `DNS`, `DHCP`, `ACIA`, `DTR`, `RTS`, `CTS`, `DCD`,
`DSR`, `GEOS`, `GCR`, `HDMI`, `RGB`, `CVBS`, `SVideo`, `TCP_NODELAY`.

---

## UI requirements

**Configuration page:**
- Render the menu-facing hierarchy (Layer B) as the primary structure **when it resolves**;
  otherwise render the current REST-category-grouped layout. **Either way, apply the Layer A
  terminology overlay** so a U64/U2/unknown device still gets familiar item labels. The page
  is always a complete, lossless view of live `GET /v1/configs`.
- Preserve all edit capabilities, validation, and write-back behavior.
- Preserve every device-fragility safeguard: PUT-for-single-writes, throttle/
  backoff, interactive-write coalescing, routing-epoch read keying, pending-write
  and password states, loading/error/disabled handling.
- Clearly distinguish menu-aligned settings from the REST-only/advanced fallback.
- **No duplicate mutable state for aliases** (see "Hazards").
- Mind label length vs the adaptive horizontal/vertical layout in `ConfigItemRow`
  / `useDisplayProfile` (longer menu labels may shift rows to vertical — fine, but
  verify on compact profiles for Android/iOS/web).

**Home / Play / Disks (audit + minimal, relevant changes only):**
- These already centralize most terminology (`src/pages/home/constants.ts`,
  `src/lib/sourceNavigation/sourceTerms.ts`, `src/lib/config/homeStreams.ts`) and
  contain **pre-existing ad-hoc REST→display-label mappings** (e.g. HomePage shows
  "Video Mode" for REST `System Mode`; `DRIVE_CONTROL_SPECS`; `STREAM_LAYOUT`
  VIC/Audio/Debug). Where it reduces duplication and risk, **reconcile these with
  the shared mapping layer** rather than leaving parallel copies. Keep scope tight.
- **Disks:** the app uses a **source abstraction** (`Local`/`C64U`/`HVSC`/
  `CommoServe`), not the device storage roots (`SD`/`Flash`/`Temp`/`USB2`). Do not
  invent storage-root labels or persistent mappings for menu-only browser entries;
  align only genuine overlaps.
- **Play:** align audio/SID-player/turbo/video/streaming terms where relevant;
  **do not hide `Data Streams`**.
- Do not change feature-flag keys, telnet `menuPath` strings, analytics keys, or
  test selectors as a side effect of relabeling — these are HIGH-risk. Relabel
  display strings, not identifiers.
- Do not rename the app product (it comes from the variant system /
  `targetDisplayMapper`, never hard-code device product names).

---

## Hazards & correctness requirements (do not skip)

1. **Alias shared state.** `useAuthoritativeConfigValueState` currently keys
   optimistic/echo state by `itemName` within a category render scope. Aliases
   (e.g. drive ROMs shown under both `Built-in drive A` and `Memory & ROMs`) live
   under different menu parents. Editing either must update **one** REST source
   and reflect in both. Re-key shared/pending state by canonical
   `{category, item}` (routing-epoch aware) so no alias becomes independent
   mutable state. Add an explicit test for this.
2. **Multi-category menu nodes.** A single menu node aggregates items from several
   REST categories (e.g. `LED lighting` ← `U64 Specific Settings` + `LED Strip
   Settings` + `Keyboard Lighting`; `Audio setup` ← 5+ categories). The current
   page lazily fetches **one** category per expanded section. Drive fetching from
   the **set of REST categories** a node references (reuse `useC64Category` per
   category, or `useC64AllConfig`), preserving routing-epoch keying and lazy
   loading so device load/backoff behavior is unchanged.
3. **Project over live data, never over the YAML, and never gate on a static list.**
   The generated mapping is static structure only; values/options/editability always
   come from the live REST fetch. Unknown future REST items, device-specific categories,
   and entire unmapped families must surface automatically (in the fallback section or the
   REST-grouped layout). No code path may consult a fixed category/item roster to decide
   whether to render — only to decide where/how to label.
4. **Coverage/parallel-E2E stability.** Be aware of the known flake classes when
   adding effects/hooks: [[react-effect-setstate-coverage-hang]],
   [[configbrowser-focusring-oom]], [[config-reads-aborted-on-connect]]. Bail on
   value-equality in effects; do not add timeouts to mask loops.

---

## Implementation steps

1. Inspect the cited files; confirm REST names against `c64u-config.yaml` and
   labels against `c64u-menu.yaml`.
2. Create `docs/research/menu-config-mapping/PLANS.md` (phases, files, tasks,
   tests, termination criteria). Keep it updated.
3. Build the mapping artifact (#1) + compile/check tooling, wired into
   `npm run lint`.
4. Implement `resolveMenuMapping` (#2, hierarchy-or-null) and `projectConfigToMenu`
   (#3) as pure, node-tested modules — including the **null-hierarchy branch** that emits
   the REST-grouped layout with the Layer A overlay applied, and the lossless assertion.
5. Render the projection in `ConfigBrowserPage` (#4); reuse `ConfigItemRow`
   `label`/`formatOptionLabel`/`readOnly`; keep REST identity for control-type +
   write-back; implement the multi-category fetch and alias state-sharing; add the
   REST-only fallback section. Verify on a U64e fixture that labels still apply with no
   hierarchy and nothing is dropped.
6. Add the drift checker (#5) + tests.
7. Reconcile Home/Play/Disks terminology minimally (audit per "UI requirements").
8. Add tests (next section). Update docs.

---

## Tests (mirror existing conventions)

`unit-node` for pure logic; `unit-jsdom` for components; fixtures via
`setMockConfigLoader`/`createMockC64Server`; value-assertions, no snapshots; keep
the 91%/91% gate green.

- Category + item mapping (incl. label-corrections).
- Split categories — especially `U64 Specific Settings` across its 5 destinations.
- **Aliases** — drive ROM entries: editing one location updates one REST source;
  no duplicate state.
- Fallback handling for REST-only items (`SoftIEC`, `Tape`, `Data Streams`,
  `LedStrip SID Select`, the U64/C64 advanced items).
- **Stale + unmapped drift detection** (the checker + a unit test asserting no
  drift for 1.1.0, like `checkStaleVariantNames.test.ts`).
- Value formatters (dB reuse, CPU `MHz`, verified-or-not ms).
- Multi-category node fetch resolves correctly.
- Component test: config page renders the menu hierarchy; fallback section present.
- **Regression:** write-back still sends canonical REST `{category,item}` (assert
  the mutation/`setConfigValue` args under both a primary and an alias edit).
- Passwords masked and never logged.
- `resolveMenuMapping` fallback chain (exact / nearest-lower / latest / null), and
  that it **never** returns a cross-family hierarchy.
- **Lossless projection (the headline guarantee), driven from the real fixtures.** For
  **each** of `c64u-config.yaml` (1.1.0 + 3.14) and `u64e-config.yaml` (3.12a + 3.14e):
  the set of REST `{category,item}` identities the page renders equals the set in the
  fixture — nothing dropped, nothing duplicated. Assert it as a set-equality, not a count.
- **No-Layer-B path (U64/U2):** with `resolveMenuMapping → null` (feed a U64e fixture),
  the page renders the REST-category-grouped layout **and** Layer A relabels shared items
  (e.g. `Static Netmask` → `Static netmask`), while device-specific categories
  (`Clock Settings`) render fully and editable.
- **Terminology overlay is device-agnostic:** a shared REST item carries the same friendly
  label whether the active mapping is the C64U hierarchy or the null/REST-grouped layout.
- **Unknown future / cross-device category remains reachable AND editable:** feed the mock
  a synthetic category never seen anywhere (mimicking a U2 `Audio Output Settings` or a
  future firmware) → it appears in the fallback section, renders its items, and a write
  to one still issues the correct `{category,item}` PUT. (This is the U2 stand-in, since
  no U2 fixture exists — do not fabricate a U2 menu.)
- **No static category list anywhere:** a guard/test (or code-review checklist item)
  ensuring no module enumerates "all categories" as a gate on rendering.

---

## Validation suite (run, record exact commands + results in WORKLOG.md)

- `npm run typecheck`
- `npm run lint` (includes `feature-flags:check`, the new mapping `:check`,
  display-profile + stale-name guards)
- `npm test` (or targeted `vitest run` for new files first)
- `npm run test:coverage` if practical (heavy; chunked)
- Relevant E2E if practical: `npm run test:e2e` (config specs) — use
  `--workers=1` to distinguish real regressions from x8-stress artifacts.
- `npm run build` (web). Android/iOS builds only if the environment supports them.

---

## Documentation

Add a concise developer note (e.g.
`docs/research/menu-config-mapping/README.md` or under `docs/c64/`): why the
mapping layer exists; the **Layer A (terminology overlay, device-agnostic) vs Layer B
(menu hierarchy, family+firmware) split**; how to add a hierarchy for a new
firmware/family (capture its menu YAML under `docs/c64/devices/<family>/<version>/`,
author the association, run the compile/check, register in the resolver) — noting that
**shared items already get Layer A labels with zero new work**, so adding a family is
purely additive; how the REST-only fallback keeps everything reachable; and the two
invariants — **REST `{category,item}` stays canonical for write-back**, and **the page
always renders the full live `GET /v1/configs` with no static gating**.

---

## Plan & worklog deliverables (path note)

The repo-root `PLANS.md` and `WORKLOG.md` are **already tracked** and currently
hold the active branch's unrelated work (123 KB / 251 KB). **Do not overwrite
them.** Put this task's plan/worklog at
`docs/research/menu-config-mapping/PLANS.md` and
`docs/research/menu-config-mapping/WORKLOG.md` (co-located with this prompt; the
`docs/research/` prefix is already allow-listed by the stale-name guard). If the
outer environment explicitly insists on the root files, append a clearly delimited
new section instead of replacing existing content, and flag it.

---

## Acceptance criteria

- **Lossless on every device (the headline criterion):** the Config page renders
  **every** item from live `GET /v1/configs`, on C64U, U64, U2, and any unknown/future
  family — proven by set-equality tests over the C64U **and** U64e fixtures plus a
  synthetic unknown-category config. No allow-list, denylist, family literal, or static
  category roster anywhere gates what is shown.
- Config page is **menu-aligned (Layer B hierarchy)** for C64U 1.1.0; on other families it
  is the REST-category-grouped layout. The **Layer A terminology overlay applies on all
  families** wherever an item is shared.
- Write-back still uses canonical REST `{category, item}` names — proven by tests,
  including via alias edits and via a write to an item in the fallback section.
- Menu-only actions/status are never represented as persistent REST config.
- The mapping is centralized, typed, versionable, and test-covered; labels live in
  one place (the menu YAML); no scattered REST→menu string hacks in components.
- Aliases share one REST source (no duplicate mutable state).
- Deterministic drift detection (unmapped + stale + label drift) runs in
  `npm run lint`.
- Home/Play/Disks terminology audited; only relevant, low-risk changes made.
- All device-fragility safeguards + write throttling/backoff preserved.
- Relevant automated checks pass.
- `docs/research/menu-config-mapping/PLANS.md` and `WORKLOG.md` accurately reflect
  the work.

---

## Non-goals

Do not change the REST API; do not alter Telnet/FTP/REST transport unless a bug
directly blocks this; do not redesign the app; do not remove advanced settings;
do not infer unsupported Wi-Fi actions; do not hide streaming settings; do not
turn YAML sample `selected:` values into defaults; do not push/PR/release unless
asked; do not rename REST keys, feature-flag keys, telnet `menuPath`s, analytics
keys, or test selectors. **Do not fabricate a U64 or U2 menu hierarchy** — none has
been captured; those families render the REST-grouped layout (+ Layer A) until a real
menu YAML is added. **Do not gate Config-page rendering on any static category/item
list, `ProductFamilyCode` literal, or capability flag** — rendering follows live
`GET /v1/configs` only (capability gating remains for actions like power/streaming,
never for which config items display).

---

## Final report (when finished)

Report: files changed; mapping architecture summary (the Layer A overlay vs Layer B
hierarchy split, and where each is consumed); **proof the page is lossless on every
sampled device** (set-equality results for C64U 1.1.0/3.14 + U64e 3.12a/3.14e + the
synthetic unknown-category config); how REST write-back identity is preserved (incl.
alias proof and a fallback-item write); how unmapped/REST-only and device-specific
categories (`Clock Settings`, U2 `Audio Output Settings`) are handled; how multi-category
nodes and alias shared-state were solved; **a one-paragraph "how to add a U64/U2 (or future
firmware) menu" recipe**; tests + builds run with exact commands and results; and remaining
risks/known gaps (especially menu-only actions lacking real endpoints, the ms-multiplier
verification outcome, and any place a static list could creep back in to gate rendering).
