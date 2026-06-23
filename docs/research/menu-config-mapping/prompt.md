# Implementation prompt — Menu-aligned configuration projection (C64 Ultimate)

> This prompt was rewritten after researching the code it touches, so the
> resulting implementation is **modular, consistent, deduplicated, and able to
> evolve** with changing menu/config structures. A condensed map of the relevant
> code (with `file:line` references) is embedded under **"Codebase grounding"**
> so you do not re-derive it. Treat that map as the ground truth for *where*
> things live; re-read the cited files before changing them, because line numbers
> drift.

---

## ROLE

You are an expert Capacitor, Android, iOS, and web engineer working in the
**C64 Commander / C64U Remote** codebase. You know the Commodore 64 Ultimate
("C64U"), Ultimate 64 ("U64"/"U64E"/"U64E2"), and Ultimate-II ("U2") device
families, and the difference between **internal REST-exposed configuration
names** and **user-visible device-menu terminology**.

Your task: implement a **minimally invasive, modular, maintainable mapping
layer** that presents C64 Ultimate configuration using the device's own menu
hierarchy and labels, while preserving the current REST-backed configuration
model as the internal source of truth.

---

## Primary goal

Today the configuration page is a near one-to-one projection of the REST API
configuration categories/items. That is accurate but user-hostile: the device's
own menu uses a different hierarchy and slightly different terminology.

Add a **display/projection layer** so that, especially on the configuration page,
the user sees the device-menu structure:

```
Disk file browser · CommoServe file search · Memory & ROMs · Turbo boost ·
Video setup · Audio setup (Audio mixer / Speaker mixer / SID sockets
configuration / UltiSID configuration / SID addressing / SID player behavior) ·
Joystick & controllers · LED lighting · Network services & timezone ·
Wired network setup · Wi-Fi network setup · Modems · Printers · User interface ·
Built-in drive A · Built-in drive B · System information
```

**The REST API stays the internal source of truth.** Do not rename internal REST
category or item keys in the transport, persistence, API client, or write-back
logic. The mapping is a *projection above* the REST model, computed *over live
REST data*.

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

- Menu extraction (hierarchy + menu labels + node kinds):
  `docs/c64/devices/c64u/1.1.0/c64u-menu.yaml`
- REST config schema sample (canonical category/item names + options):
  `docs/c64/devices/c64u/1.1.0/c64u-config.yaml`
- Supporting reference: `docs/c64/devices/c64u/1.1.0/c64u-telnet.yaml`,
  `docs/c64/devices/c64u/1.1.0/c64u-config.cfg`
- The mock/demo loader uses the **top-level** `docs/c64/c64u-config.yaml` (see
  `src/lib/mock/mockConfig.ts`), so your projection must also work against that
  fixture in demo/test mode.

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

Build a **data-driven projection** from REST config → menu-facing view model.
It must support: one REST item in exactly one primary menu location; the same
REST item shown in multiple locations as **aliases over shared state**; one menu
section composed of REST items from **different** REST categories; REST-only
items absent from the menu; menu-only actions/status entries that are not
persistent REST config; **device/firmware evolution without touching React
components**; and **fallback to the current REST-shaped layout** when no mapping
exists for a device/firmware.

Implement these pieces (names are suggestions; match local conventions):

1. **Versioned mapping artifact (single source per family+firmware).**
   *Recommended (matches the feature-flags convention):* author a REST-association
   source that carries **only what the menu YAML lacks** — for each menu leaf
   (identified by its menu path) a `restPointer {category,item}`, optional
   `aliasOf`, `formatterId`, and `restOnly`/`menuOnly` (`action`/`status`) flags —
   then a `scripts/compile-menu-mapping.mjs` reads `c64u-menu.yaml` (labels +
   hierarchy + kinds) **+** that association **+** validates against
   `c64u-config.yaml`, and emits a committed
   `src/lib/config/menuMapping/c64u-1.1.0.generated.ts` (a typed menu tree:
   `displayLabel` from the YAML, `restPointer`(s) from the association, node
   `kind`). This keeps **labels in exactly one place (the YAML)** and REST
   identity in exactly one place (the association), cross-checked at build time.
   *Acceptable alternative* if compile tooling is judged overkill: a hand-written
   typed `MenuMapping` TS module per version, with the drift checker (below)
   loading the committed YAMLs to validate it at lint/test time. Either way:
   **typed, versioned, centralized, test-covered; no labels duplicated across
   React components.**

2. **Versioned resolver** — mirror `deriveDeviceCapabilities`. Put it beside the
   capability model or under `src/lib/config/menuMapping/`:
   `resolveMenuMapping({family, firmwareVersion}) → mapping | null`. Fallback
   chain: exact `family+version` → nearest lower version within family → latest
   within family → `null`. `null` ⇒ the page renders the **current REST-shaped
   layout** unchanged.

3. **Projection function (pure, node-testable)** —
   `projectConfigToMenu(liveRestConfig, mapping) → { tree, drift }`. For each
   mapping node, resolve its `restPointer` against **live** REST data and emit a
   view-model node carrying `displayLabel`, `menuPath`, `restPointer`, current
   value, options, editability, `formatterId`, and alias metadata. Then:
   - **Unmapped-live detection:** any live REST `{category,item}` not claimed by
     the mapping → route into the **fallback section** (this is also what makes
     unknown *future* REST items reachable). Record in `drift.unmappedRestItems`.
   - **Stale-mapping detection:** any `restPointer` with no matching live item →
     omit from the tree (never error at runtime) and record in
     `drift.staleMappingRefs`.
   - **Menu-only nodes** (`kind: action|status`, or leaves with no `restPointer`)
     are rendered as non-persistent UI per "UI requirements" — never fabricated as
     config items.

4. **UI rendering** — `ConfigBrowserPage` renders the projected tree; keep the
   existing write-back pipeline and all safeguards. No per-item string hacks in
   JSX — labels/formatters come from the view model.

5. **Drift checker** — `scripts/compile-menu-mapping.mjs --check` (or a dedicated
   `scripts/check-menu-mapping-drift.mjs`) wired into `npm run lint`, plus
   `tests/unit/scripts/*.test.ts`, modeled on
   `check-stale-variant-names.mjs`/`configDrift.test.ts`. It must fail on:
   unmapped REST items not in the explicit fallback allowlist, stale mapping
   pointers, label drift between mapping and `c64u-menu.yaml`, and any menu leaf
   lacking both a `restPointer` and a `menuOnly` flag.

6. **Fallback area** — a clearly distinguished section (e.g. **"Advanced
   (REST-only) settings"**) that renders everything the mapping does not claim,
   so no configuration item is ever unreachable.

Hard rules: do **not** scatter string replacements through React components; do
**not** mutate REST responses into menu shapes before write-back; keep canonical
REST identity intact end-to-end.

---

## The mapping data (initial baseline for C64U 1.1.0)

Use the tables below as the **REST → menu-path association** (the data for piece
#1). **Display labels come from `c64u-menu.yaml`** at the target path; the
"Menu label" columns must match it (the drift checker enforces this). Map **all**
items a category exposes by walking live REST ∪ menu YAML — the lists below are
the non-obvious cases, not an exhaustive enumeration (e.g. `Printer Settings`
also has `Emulation`; map it too).

Verify every REST name below against `c64u-config.yaml` before encoding
(researched and confirmed present as of fw 1.1.0).

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
- Render the menu-facing hierarchy as the primary structure (fallback to current
  REST-shaped layout when `resolveMenuMapping` returns `null`).
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
3. **Project over live data, never over the YAML.** The generated mapping is
   static structure only; values/options/editability always come from the live
   REST fetch. Unknown future REST items must surface in the fallback section
   automatically.
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
4. Implement `resolveMenuMapping` (#2) and `projectConfigToMenu` (#3) as pure,
   node-tested modules.
5. Render the projection in `ConfigBrowserPage` (#4); reuse `ConfigItemRow`
   `label`/`formatOptionLabel`/`readOnly`; keep REST identity for control-type +
   write-back; implement the multi-category fetch and alias state-sharing; add the
   REST-only fallback section.
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
- **Unknown future REST category/item remains reachable** (feed the mock a
  category not in the mapping → it appears in fallback).
- `resolveMenuMapping` fallback chain (exact / nearest-lower / latest / null).

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
mapping layer exists; how to add a mapping for a new firmware/family (drop YAMLs
under `docs/c64/devices/<family>/<version>/`, author the association, run the
compile/check, register in the resolver); how the REST-only fallback works; and
the invariant that **REST `{category,item}` stays canonical for write-back**.

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

- Config page is primarily **menu-aligned** for C64U 1.1.0 (REST-shaped fallback
  when no mapping resolves).
- Write-back still uses canonical REST `{category, item}` names — proven by tests,
  including via alias edits.
- **All** REST items remain reachable (mapped or in the REST-only/advanced
  fallback), including unknown future ones.
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
keys, or test selectors.

---

## Final report (when finished)

Report: files changed; mapping architecture summary; how REST write-back identity
is preserved (incl. alias proof); how unmapped/REST-only settings are handled; how
multi-category nodes and alias shared-state were solved; tests + builds run with
exact commands and results; and remaining risks/known gaps (especially menu-only
actions lacking real endpoints, and the ms-multiplier verification outcome).
