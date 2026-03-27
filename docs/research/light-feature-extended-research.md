# Light Feature Extended Research

## 1. Scope

This document evaluates how to extend the C64 Ultimate light feature in C64 Commander without changing the app's current structural simplicity.

The research is grounded in the current repository state:

- implemented Home lighting controls in `HomePage` and `LightingSummaryCard`
- generic Config browsing in `ConfigBrowserPage`
- config transport in `useC64Connection`, `useInteractiveConfigWrite`, and `c64api`
- app pacing controls in `appSettings`, `configWriteThrottle`, `slider`, and `sliderBehavior`
- device capability fixtures in `doc/c64/c64u-config.yaml` and versioned device snapshots under `doc/c64/devices`
- UX constraints from `doc/ux-guidelines.md` and `doc/display-profiles.md`

This is a design and product research document only. It does not prescribe code-level implementation steps.

## 2. Phase 1: Capability Analysis

### 2.1 Current app exposure

Current lighting control is config-backed rather than runtime-streamed.

- Home is the primary light surface. It exposes a case-light card and a keyboard-light card inside an already dense operational dashboard.
- Config is the raw fallback surface. It can expose whatever the device reports for a category, including hardware-specific fields the Home page does not model.
- There is no dedicated lighting page, no light-specific tab, and no lighting event stream.
- The device performs the actual animation and SID-reactive rendering. The app only selects modes and parameters.

### 2.2 Capability matrix

#### 2.2.1 Parameter matrix

| Parameter | Case light: `c64u/3.14` | Keyboard light: `c64u/3.14` | Variant drift seen in fixtures | Current app exposure | Product implication |
| --- | --- | --- | --- | --- | --- |
| Category presence | `LED Strip Settings` | `Keyboard Lighting` | `Keyboard Lighting` appears only in the in-tree `c64u/3.14` fixture; OpenAPI and older U64E examples list only `LED Strip Settings` | Home and Config for both when category exists | Keyboard support must be capability-detected, not assumed |
| Mode | `Off`, `Fixed Color`, `SID Music`, `Rainbow`, `Rainbow Sparkle`, `Sparkle`, `Default` | `Off`, `Fixed Color`, `SID Music`, `Rainbow`, `Rainbow Sparkle`, `Default` | `u64e/3.14a` and `u64e/3.14d` stop at `Rainbow`; `u64e/3.12a` used `SID Pulse`, `SID Scroll 1`, `SID Scroll 2` | Home and Config | Feature design must treat mode tokens as device-provided capabilities, not a fixed enum |
| Pattern | `SingleColor`, `Left to Right`, `Right to Left`, `Serpentine`, `Outward` | `Single Color`, `Left to Right`, `Right to Left`, `Outward`, `Circular` | `u64e/3.14a` and `u64e/3.14d` expose only `SingleColor`, `Left to Right`, `Right to Left` | Home and Config | Case and keyboard cannot share one hardcoded pattern vocabulary |
| Fixed color | 25 named colors | 25 named colors | `u64e/3.12a` exposes raw `Fixed Color Red/Green/Blue` channels instead of a named color list | Home and Config on newer schema; legacy RGB remains Config-only | First-wave feature design should normalize color as an abstract `colorSpec`, not assume named colors always exist |
| Tint | `Pure`, `Bright`, `Pastel`, `Whisper` | `Pure`, `Bright`, `Pastel`, `Whisper` | Absent in `u64e/3.12a` | Home and Config | Tint is optional capability, not universal |
| Intensity | `0..31` | `0..31` | Consistent across examined fixtures | Home slider and Config | Safe common parameter for cross-device profiles |
| SID select | `UltiSID1-A` through `UltiSID2-D` | `UltiSID1-A` through `UltiSID2-D` | Consistent across examined newer fixtures | Home and Config | Music-reactive features can target a specific SID voice/channel, but only through device-native SID modes |
| LED strip type | Not shown in `c64u/3.14` | Not shown | `u64e/3.14a` and `u64e/3.14d` expose `LedStrip Type` with `WS2812` and `APA102` | Config only | Hardware topology belongs to advanced config, not the reusable feature layer |
| LED strip length | Not shown in `c64u/3.14` | Not shown | `u64e/3.14a` and `u64e/3.14d` expose `LedStrip Length` `1..40` | Config only | Hardware sizing should remain outside profile/automation UX |
| Raw RGB channels | Not shown in `c64u/3.14` | Not shown | `u64e/3.12a` exposes `Fixed Color Red/Green/Blue` `0..255` | Config only | Legacy devices need graceful downscoping rather than pretending the newer Home model is universal |

#### 2.2.2 Static, dynamic, and music-reactive behavior

| Behavior class | Confirmed device-backed examples | App responsibility | Constraint |
| --- | --- | --- | --- |
| Static | `Off`, `Fixed Color` | choose mode and parameters | app can request state, but device owns final rendering |
| Dynamic autonomous | `Rainbow`, `Rainbow Sparkle`, `Sparkle`, `Default` | choose mode and coarse parameters | app should not attempt to simulate these frame-by-frame |
| Music-reactive | `SID Music`, legacy `SID Pulse`, `SID Scroll 1`, `SID Scroll 2`, plus `LedStrip SID Select` | choose device-native reactive mode and SID source | app has no evidence of waveform-level control or custom DSP path |

#### 2.2.3 Control-path and timing matrix

| Aspect | Current behavior | Product implication |
| --- | --- | --- |
| Read path | `useC64ConfigItems` fetches by category and item, with placeholder snapshot data and 30s default staleness | lighting UX should tolerate slightly stale readbacks and optimistic local state |
| Simple writes | Select-style updates call `setConfigValue` through the shared Home config action layer | each non-slider change is a discrete config mutation |
| Global config write pacing | `scheduleConfigWrite` serializes standard config writes with a configurable minimum interval; default `200 ms`, rounded to `100 ms`, range `0..2000 ms` | any design that depends on rapid repeated writes is structurally weak |
| Slider preview pacing | shared slider preview interval defaults to `200 ms`, range `100..500 ms`, and explicitly includes lighting controls | live preview can be responsive, but only at coarse control cadence |
| Interactive slider transport | `useInteractiveConfigWrite` uses `immediate: true`, latest-intent coalescing, and a debounced reconciliation fetch after `250 ms` | continuous dragging should be modeled as "latest intent wins", not as a complete event history |
| Machine-state gating | interactive writes wait for machine transitions to settle | light features cannot assume writes are always accepted immediately during reset/reboot flows |
| Background read suppression | interactive write bursts temporarily suspend background reads with cooldown | heavy automation should minimize needless churn to avoid self-interference |
| Batch transport | REST `POST /v1/configs` accepts batch updates; current lighting usage batches only within one category at a time | paired case + keyboard edits should conceptually use one resolved state, but cross-category atomicity is not yet proven |
| Runtime ownership | the app writes config; the device renders light output | app-side design should prefer profile selection and rule resolution over animation synthesis |

### 2.3 Device-side vs app-side responsibilities

#### Device-side responsibilities

- render static and animated light output
- execute SID-reactive behavior
- interpret mode, pattern, tint, and color tokens
- persist configuration when explicitly saved to flash

#### App-side responsibilities

- discover which categories and fields exist
- present quick controls and advanced controls
- serialize writes safely
- coalesce slider intent
- reconcile optimistic state after writes
- expose reusable abstractions such as profiles and automation rules if added

### 2.4 Constraints

#### Hard constraints

- There is no dedicated lighting runtime API, only generic config endpoints.
- The current bottom navigation is full: Home, Play, Disks, Config, Settings, Docs.
- Home is already dense and is documented as a quick-control dashboard, not a deep editor.
- The app must remain simpler than the C64 Ultimate UI.
- Device-native modes differ by device and firmware. Keyboard lighting is not universal in the available evidence.
- Current pacing supports discrete updates and coarse slider previews, not app-driven frame animation.
- Hardware-specific fields such as LED type and length exist on some fixtures but not others.
- Legacy color encoding differs from the newer named-color schema.

#### Soft constraints

- Shallow hierarchy is preferred over deep feature trees.
- Advanced lighting should be reachable from the main lighting area, not hidden in unrelated settings.
- Compact layouts must remain safe without horizontal overflow or dense desktop-style editors.
- Users need strong explainability when automation changes light state.
- Manual control must remain faster than automation configuration.

#### Unknowns

- Whether multi-category `POST /v1/configs` updates are applied atomically across case and keyboard categories.
- Whether `Default` mode has stable semantics across firmware versions.
- Whether keyboard lighting exists on all relevant hardware families or only specific products.
- Whether the firmware can safely tolerate more aggressive automation write cadence than the current app deliberately allows.
- Whether the device exposes any future event or telemetry surface suitable for richer light automation.
- Whether legacy RGB-only devices should be normalized into first-wave Light UX or intentionally downscoped to raw Config editing.

## 3. Phase 2: Divergent Idea Space

The idea space below intentionally maximizes variety before feasibility pruning.

| # | Idea | Complexity | Core concept | Input signals | Output behavior | Why it is meaningfully distinct |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Scene Cards | Low | One-tap curated looks for both surfaces | user tap only | applies prebuilt paired light states | manual preset application, not automation or editing |
| 2 | Surface Split Composer | Medium | Treat case and keyboard as coordinated but independent roles | user edits, surface capabilities | asymmetric paired output with mirror or contrast relationships | cross-surface composition rather than single-surface tweaking |
| 3 | Event Beacon | Medium | Short temporary flashes or pulses for app/device events | mount, save, play, error, warning events | timed temporary override then return | ephemeral signaling rather than persistent state |
| 4 | Circadian Palette | Medium | Time-window-based lighting behavior | local time and schedule | switches profile by time segment | schedule-driven rather than context-driven |
| 5 | Playback Aura | Medium | Lighting follows playback state and playback context | play, pause, stop, source, now-playing state | source-aware play-state lighting | media-state automation rather than generic source mapping |
| 6 | Connection Sentinel | Low | Lighting communicates connection and diagnostics state | connected, retrying, disconnected, demo, error state | ambient status look with critical override behavior | operational telemetry made visible through light |
| 7 | Config Snapshot Glow | Low | App config snapshots carry lighting signatures | active local app config snapshot | light signature changes when snapshot changes | tied to app-stored configuration identity rather than runtime state |
| 8 | Theme Matcher | Low | Lighting echoes the app theme or display profile | app theme and display profile | harmonized app/device palette | UI-theme alignment rather than device-context alignment |
| 9 | Touch Preview Hold | Low | Preview a lighting state while pressing, commit only if confirmed | touch hold or press-and-hold gesture | temporary preview then revert or apply | interaction mechanic, not a new lighting logic source |
| 10 | Profile Library | Medium | Save, pin, duplicate, and reuse named light setups | user-saved profiles | reusable manual base states | reusable state layer rather than one-off editing |
| 11 | Lighting Stories | High | User-triggered multi-step sequences with short progression | manual trigger and elapsed time | runs a short scripted scene | sequence playback rather than single resolved state |
| 12 | Rule Grid | High | General if-this-then-that automation builder | multiple app/device predicates | selected rule result drives lighting | general automation grammar rather than a fixed feature |
| 13 | Quiet Launch | Low | Startup-safe low-intensity state with automatic restore | app launch, reconnect, startup window, time preference | conservative boot state then handoff | startup policy rather than steady-state theme |
| 14 | Surface Roles Presets | Low | Prebuilt structural relationships like mirror, halo, keyboard focus | user selection | coordinated pair layout applied instantly | structural pairing shortcut rather than freeform editing |
| 15 | Context Lens | Medium | Explain why the current light state is active | resolved owner, active rule, fallback state | diagnostic explanation overlay | explainability layer rather than new light output |
| 16 | Session Locker | Low | Freeze the current light state and suppress non-critical automation | user lock action | current state remains active until unlock | conflict-control mechanism rather than content creation |
| 17 | Contrast Guardian | Medium | Detect weak or harsh combinations and suggest safer alternatives | chosen colors, tint, intensity, capabilities | warns or nudges toward safer combinations | validation and guardrails rather than new expression |
| 18 | Batch Studio | High | Advanced side-by-side editor for both surfaces | user edits and capability map | full paired edit session with compare/apply | editor-depth concept rather than automation |
| 19 | Script Slots | High | Constrained local scripts or macros for lighting behavior | script trigger, app state, user variables | scripted profile changes or overrides | programmable behavior rather than fixed feature models |
| 20 | Source Identity Map | Medium | Lighting reflects the active source context across Play and Disks | Local, C64U, HVSC, disk context, idle state | source-specific paired look | content-origin identity rather than raw playback status |

Diversity check:

- direct derivations from the inspiration signals: `Event Beacon`, `Circadian Palette`, `Playback Aura`, `Profile Library`, `Rule Grid`, `Script Slots` = 6 of 20 = 30%
- the remaining 14 ideas are dominated by cross-surface composition, explainability, startup policy, validation, source identity, and interaction mechanics

## 4. Phase 3: Evaluation Matrix

### 4.1 Scoring model

Scale: `1` = weak, `5` = strong.

For `Implementation Complexity`, `UX Complexity`, `Performance Impact`, and `Dependency on Unavailable Signals`, a higher score is better:

- higher `Implementation Complexity` score means easier to build within current constraints
- higher `UX Complexity` score means lower cognitive burden
- higher `Performance Impact` score means lower runtime cost
- higher `Dependency on Unavailable Signals` score means less reliance on signals the app does not currently have

Weights:

- `Uniqueness`: `0.15`
- `User Value`: `0.22`
- `Implementation Viability`: `0.18`
- `Implementation Complexity`: `0.10`
- `UX Complexity`: `0.08`
- `Risk of Duplication`: `0.07`
- `Performance Impact`: `0.10`
- `Signal Availability`: `0.10`

Weighted total formula:

`UQ*0.15 + UV*0.22 + VI*0.18 + IC*0.10 + UX*0.08 + DR*0.07 + PF*0.10 + SG*0.10`

### 4.2 Score table

| Idea | UQ | UV | VI | IC | UX | DR | PF | SG | Weighted total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Scene Cards | 3 | 4 | 5 | 4 | 4 | 3 | 5 | 5 | 4.16 |
| Surface Split Composer | 4 | 5 | 5 | 4 | 4 | 4 | 5 | 5 | 4.60 |
| Event Beacon | 4 | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 4.10 |
| Circadian Palette | 3 | 3 | 5 | 5 | 4 | 4 | 5 | 5 | 4.11 |
| Playback Aura | 3 | 4 | 4 | 4 | 4 | 3 | 5 | 4 | 3.88 |
| Connection Sentinel | 4 | 5 | 5 | 4 | 4 | 5 | 5 | 5 | 4.67 |
| Config Snapshot Glow | 4 | 3 | 5 | 5 | 4 | 5 | 5 | 5 | 4.33 |
| Theme Matcher | 3 | 3 | 4 | 4 | 4 | 4 | 5 | 5 | 3.83 |
| Touch Preview Hold | 4 | 3 | 4 | 4 | 4 | 4 | 5 | 5 | 3.98 |
| Profile Library | 3 | 5 | 5 | 4 | 4 | 4 | 5 | 5 | 4.45 |
| Lighting Stories | 4 | 4 | 3 | 2 | 3 | 5 | 3 | 5 | 3.61 |
| Rule Grid | 4 | 4 | 3 | 2 | 2 | 4 | 4 | 3 | 3.36 |
| Quiet Launch | 3 | 4 | 5 | 5 | 5 | 4 | 5 | 5 | 4.41 |
| Surface Roles Presets | 2 | 4 | 5 | 5 | 5 | 2 | 5 | 5 | 4.12 |
| Context Lens | 4 | 3 | 4 | 4 | 4 | 5 | 5 | 5 | 4.05 |
| Session Locker | 4 | 4 | 4 | 4 | 4 | 4 | 5 | 5 | 4.20 |
| Contrast Guardian | 4 | 3 | 4 | 4 | 5 | 5 | 5 | 5 | 4.13 |
| Batch Studio | 3 | 4 | 4 | 3 | 3 | 3 | 5 | 5 | 3.80 |
| Script Slots | 4 | 3 | 2 | 1 | 2 | 5 | 4 | 2 | 2.83 |
| Source Identity Map | 5 | 4 | 4 | 4 | 4 | 5 | 5 | 4 | 4.32 |

### 4.3 Score rationale

- **Scene Cards**: `UQ3` curated presets are common; `UV4` fast payoff for casual users; `VI5` maps directly to known fields; `IC4` requires moderate storage and selection UI; `UX4` familiar mental model; `DR3` overlaps the profile concept; `PF5` apply-only behavior is cheap; `SG5` needs no new signals.
- **Surface Split Composer**: `UQ4` emphasizes paired-surface structure; `UV5` unlocks the main unexplored expressive space; `VI5` uses existing per-surface controls; `IC4` needs an editor and normalization logic but no new runtime channel; `UX4` manageable with good presets; `DR4` not redundant with raw Home cards; `PF5` discrete writes only; `SG5` depends only on existing capabilities and user input.
- **Event Beacon**: `UQ4` uses light as transient feedback; `UV4` strong for device awareness; `VI4` feasible through timed overrides; `IC4` manageable but needs override timing; `UX4` understandable if restrained; `DR4` distinct from profiles; `PF5` low-cost if brief; `SG4` depends on app event coverage rather than new device telemetry.
- **Circadian Palette**: `UQ3` schedule automation is familiar; `UV3` useful but generic; `VI5` easy to implement with local time; `IC5` simple scheduling; `UX4` low burden; `DR4` not strongly redundant; `PF5` infrequent state changes; `SG5` only needs local time.
- **Playback Aura**: `UQ3` overlaps other media-aware ideas; `UV4` attractive to music users; `VI4` plausible from app playback state; `IC4` moderate; `UX4` understandable; `DR3` duplicates parts of source mapping and event ideas; `PF5` low cost if state-based; `SG4` depends on clean playback-state ownership.
- **Connection Sentinel**: `UQ4` makes operational health visible without opening diagnostics; `UV5` strong day-to-day value; `VI5` grounded in existing connection state; `IC4` moderate mapping UI only; `UX4` easy if status bands stay simple; `DR5` highly differentiated; `PF5` negligible runtime cost; `SG5` depends on signals the app already has.
- **Config Snapshot Glow**: `UQ4` ties lighting to app-snapshot identity; `UV3` narrower audience; `VI5` easy because snapshot state already exists; `IC5` straightforward; `UX4` simple if optional; `DR5` very differentiated; `PF5` cheap; `SG5` uses local state already available.
- **Theme Matcher**: `UQ3` aesthetically familiar; `UV3` mostly cosmetic; `VI4` feasible from app theme state; `IC4` moderate; `UX4` light mental load; `DR4` separate from device context; `PF5` cheap; `SG5` uses signals already present.
- **Touch Preview Hold**: `UQ4` interaction-led rather than automation-led; `UV3` good refinement but modest standalone value; `VI4` feasible with existing preview cadence; `IC4` moderate; `UX4` understandable with clear affordances; `DR4` distinct from most ideas; `PF5` reuses preview path; `SG5` needs no new signals.
- **Profile Library**: `UQ3` profile libraries are familiar; `UV5` very high practical value; `VI5` fits existing config-backed state; `IC4` needs persistence and compatibility rules; `UX4` familiar if kept simple; `DR4` not redundant with raw controls; `PF5` cheap; `SG5` uses only local and config state.
- **Lighting Stories**: `UQ4` expressive sequence concept; `UV4` good for demos and rituals; `VI3` weaker because timed app ownership is brittle; `IC2` high complexity; `UX3` more complex to author; `DR5` unique; `PF3` more lifecycle churn; `SG5` no new signals needed.
- **Rule Grid**: `UQ4` flexible automation grammar; `UV4` powerful for power users; `VI3` possible but risky within current app simplicity goals; `IC2` high complexity; `UX2` high cognitive load; `DR4` distinct; `PF4` manageable if sparse; `SG3` rule usefulness depends on signal breadth the app only partially has.
- **Quiet Launch**: `UQ3` startup policy is not novel but relevant; `UV4` strong comfort and night-use value; `VI5` grounded in app lifecycle and simple states; `IC5` simple; `UX5` very low burden; `DR4` distinct enough from general profiles; `PF5` near-zero steady-state cost; `SG5` needs only startup and local preference state.
- **Surface Roles Presets**: `UQ2` closely overlaps split composition; `UV4` helpful shortcut value; `VI5` very feasible; `IC5` easy; `UX5` simple; `DR2` heavily subsumed by split composer presets; `PF5` cheap; `SG5` needs no new signals.
- **Context Lens**: `UQ4` explainability is unusual in light features; `UV3` moderate because it supports other features more than standing alone; `VI4` feasible through state introspection; `IC4` moderate; `UX4` simple when on-demand; `DR5` highly distinct; `PF5` cheap; `SG5` uses resolved internal state only.
- **Session Locker**: `UQ4` explicit automation freeze is differentiated; `UV4` high trust value; `VI4` feasible; `IC4` moderate; `UX4` understandable; `DR4` distinct enough; `PF5` cheap; `SG5` uses local resolved state only.
- **Contrast Guardian**: `UQ4` validation is differentiated; `UV3` helpful but secondary; `VI4` feasible with deterministic heuristics; `IC4` moderate; `UX5` low burden if advisory; `DR5` highly distinct; `PF5` cheap; `SG5` uses chosen values only.
- **Batch Studio**: `UQ3` advanced paired editor is less unique than split composition; `UV4` good for power users; `VI4` feasible; `IC3` larger UI surface; `UX3` heavier than desired; `DR3` overlaps split composer; `PF5` cheap at runtime; `SG5` no new signals needed.
- **Script Slots**: `UQ4` programmable control is genuinely distinct; `UV3` narrow audience; `VI2` weak under current constraints; `IC1` very high complexity; `UX2` too advanced for the product's simplicity target; `DR5` not redundant; `PF4` manageable only if constrained; `SG2` useful scripts need broader signals than are currently proven.
- **Source Identity Map**: `UQ5` very differentiated and product-specific; `UV4` strong for a source-centric app; `VI4` feasible from current route and playback context; `IC4` moderate; `UX4` understandable with source icons; `DR5` clearly distinct; `PF5` cheap; `SG4` depends on consistent active-source ownership across pages.

## 5. Phase 4: Convergence

### 5.1 Selected top contenders

Exactly five concepts are selected.

| Selected concept | Weighted total | Why it made the cut |
| --- | --- | --- |
| Connection Sentinel | 4.67 | Best balance of value, feasibility, signal availability, and differentiation. It turns existing operational state into ambient feedback without requiring heavy new UI. |
| Surface Split Composer | 4.60 | Best foundational extension of the light feature itself. It exploits the dual-surface opportunity that current quick controls only expose as two parallel cards. |
| Profile Library | 4.45 | Strongest reusable-state layer and the cleanest base for any later automation. Familiar, useful, and compatible with current config-backed control. |
| Quiet Launch | 4.41 | High-value, low-complexity automation that fits the product's safety and simplicity goals better than richer schedule or rule systems. |
| Source Identity Map | 4.32 | Most product-specific contextual automation after Connection Sentinel. It aligns lighting with the app's source-centric mental model instead of generic "media mode" logic. |

Selection logic:

- The set is intentionally broad rather than redundant: one editor, one reusable base layer, and three lightweight automations with different triggers.
- All five fit the observed transport model because they resolve to discrete state changes, not app-streamed animation.
- Only one selected concept, `Profile Library`, is directly derived from the optional inspiration signals.

### 5.2 Explicit rejection of every non-selected concept

| Rejected concept | Reason for rejection |
| --- | --- |
| Scene Cards | Good onboarding shell, but redundant once `Profile Library` supports pinned defaults and quick apply. |
| Event Beacon | Useful, but noisier and more conflict-prone than the selected status and context automations. Better treated later as an override sub-layer, not a first-wave headline feature. |
| Circadian Palette | Feasible, but too generic and less product-specific than `Quiet Launch` or `Source Identity Map`. |
| Playback Aura | Overlaps `Source Identity Map` and requires more nuanced playback semantics for only modest extra value. |
| Config Snapshot Glow | Elegant but niche; depends on active use of app config snapshots and is less broadly valuable than the selected five. |
| Theme Matcher | Too cosmetic and app-centric for a device-control feature extension. |
| Touch Preview Hold | Worth using as an interaction pattern inside the editor, but not strong enough as a standalone feature concept. |
| Lighting Stories | Creative, but sequence ownership is too lifecycle-sensitive for a shallow mobile app and current transport model. |
| Rule Grid | Powerful but too complex in both model and UX for this product stage. |
| Surface Roles Presets | Valuable as built-in presets inside `Surface Split Composer`, but not differentiated enough to justify a separate feature slot. |
| Context Lens | Important as a supporting UX surface for explainability, but it supports the selected features rather than standing as a flagship light feature. |
| Session Locker | Valuable conflict-control primitive, but it belongs inside the unified model rather than in the top-five feature set. |
| Contrast Guardian | Strong guardrail layer, but secondary to the more primary expressive and contextual extensions. |
| Batch Studio | More UI mass than needed once `Surface Split Composer` exists. |
| Script Slots | Lowest viability and highest UX risk under the current signal and transport constraints. |

## 6. Phase 5: UX Integration Design

### 6.1 Navigation and layout constraints

The current app structure imposes four non-negotiable UX constraints:

- Home is already dense and should remain a quick-control dashboard.
- Bottom navigation is fully occupied and should not gain a new tab.
- Hierarchy must stay shallow.
- The app must remain simpler than the device UI it fronts.

### 6.2 Integration strategy

The cleanest integration strategy is a single secondary surface rather than scattered structural expansion.

#### Recommended surface model

- Keep Home as the primary discovery and quick-control entry point for lighting.
- Add one secondary editor surface, `Lighting Studio`, launched from the Home lighting section header.
- On compact displays, `Lighting Studio` should open full-screen.
- On medium displays, it should open as a large centered dialog.
- On expanded displays, it can open as a wide side panel or large dialog without changing workflow order.
- Keep raw device-specific lighting fields such as LED type, LED length, and legacy RGB channels in Config instead of pulling them into the primary Light UX.

#### Home-level additions

Home should gain only lightweight summary elements:

- active profile chip
- automation-status chip
- single `Studio` entry action
- optional `Why this look?` affordance opening an explanatory overlay

Home should not gain additional permanent rows of lighting controls beyond what already exists.

#### Supporting UX pattern

`Context Lens` should be used as a supporting pattern across the selected features:

- it explains which layer currently owns the light state
- it exposes fallbacks and paused automations
- it improves trust without needing a new navigation branch

### 6.3 Selected feature integration details

#### Connection Sentinel

- Entry point: `Lighting Studio` -> `Automation` -> `Device status`.
- Interaction flow: user enables the feature, maps a small set of statuses to profiles or modifiers, then returns to Home with an automation chip showing the active state.
- UI placement: automation card inside `Lighting Studio`; summary chip on Home.
- State representation: status dot plus short label such as `Auto: Connected`, `Auto: Retry`, or `Auto: Demo`.
- Edge and failure behavior: if the app loses fresh status input, the feature should hold the last state briefly and then fall back to the active base profile; critical error or disconnect mappings may temporarily override other automations.
- Cognitive load: low to medium.
- Discoverability: medium; strong once opened from Home because status-based automation is self-explanatory.
- Impact on existing workflows: positive; it reduces the need to open diagnostics just to infer device state.

#### Surface Split Composer

- Entry point: Home lighting section -> `Studio` -> `Compose`.
- Interaction flow: user chooses a pair preset such as `Mirror`, `Contrast`, `Keyboard focus`, or `Case halo`, then refines each surface and optionally saves the result to a profile.
- UI placement: first major section in `Lighting Studio`, directly below the live paired preview.
- State representation: two linked surface tiles with swatches, current mode labels, and a visible link state such as `Linked`, `Mirrored`, or `Independent`.
- Edge and failure behavior: if keyboard lighting is unsupported, the composer collapses to case-only editing and hides two-surface presets; unsupported fields are omitted rather than shown disabled everywhere.
- Cognitive load: medium.
- Discoverability: high when exposed as the main creative section of `Lighting Studio`.
- Impact on existing workflows: high positive; it provides depth without adding complexity to Home.

#### Profile Library

- Entry point: active profile chip on Home or `Lighting Studio` -> `Profiles`.
- Interaction flow: user applies a saved profile, saves the current state as new, duplicates an existing profile, or pins favorites for quick reuse.
- UI placement: profile strip in the `Lighting Studio` header plus full profile list below.
- State representation: active profile chip, modified-state dot when current settings diverge, and optional compatibility badge when a profile only partially applies on the current device.
- Edge and failure behavior: when a profile contains fields unsupported on the current device, the app applies the compatible subset and clearly labels the profile as partially applied instead of silently mutating it.
- Cognitive load: low.
- Discoverability: high; profile chips are a familiar pattern.
- Impact on existing workflows: very high positive; profiles become the base layer for manual reuse and later automation.

#### Quiet Launch

- Entry point: `Lighting Studio` -> `Automation` -> `Startup`.
- Interaction flow: user enables startup behavior, selects a conservative boot-state profile or modifier, and chooses what state should resume afterward.
- UI placement: compact automation card below `Connection Sentinel`.
- State representation: small boot icon chip on Home and inside the automation summary.
- Edge and failure behavior: if the app connects after the intended startup window, the feature does not late-fire unexpectedly; it marks itself inactive for the current session and waits until the next applicable startup event.
- Cognitive load: low.
- Discoverability: medium.
- Impact on existing workflows: positive; it adds comfort and safety without occupying everyday space.

#### Source Identity Map

- Entry point: `Lighting Studio` -> `Automation` -> `By source`.
- Interaction flow: user assigns looks or modifiers to `Local`, `C64U`, `HVSC`, `Disks`, and `Idle`, then sees a subtle source-state chip when navigating Play or Disks.
- UI placement: automation card in `Lighting Studio`, plus contextual page-level banner or chip on Play and Disks when the feature is active.
- State representation: source icon plus concise label such as `Local look`, `HVSC look`, or `Disk look`.
- Edge and failure behavior: if no source is active, the app falls back to the base profile; for mixed playlists, the current now-playing item owns the source state; if the user manually locks lighting, source automation pauses until resumed.
- Cognitive load: medium.
- Discoverability: medium to high because the feature appears in the pages where source identity matters.
- Impact on existing workflows: high positive for Play and Disks users, while remaining invisible for others.

## 7. Phase 6: Unified Lighting Model

The selected features should not become five separate control paths. They need one deterministic model.

### 7.1 Canonical model objects

#### Capability contract

Each device exposes a capability contract per surface:

- `surface`: `case` or `keyboard`
- `supportedModes`
- `supportedPatterns`
- `supportsTint`
- `supportsSidSelect`
- `colorEncoding`: `named` or `rgb`
- `intensityRange`

Hardware configuration fields such as `LedStrip Type` and `LedStrip Length` are intentionally outside this feature model. They remain raw Config concerns.

#### Surface state

Each surface resolves to:

- `mode`
- `pattern`
- `colorSpec`
- `tint`
- `intensity`
- `sidSelect`

`colorSpec` must support both modern and legacy schemas:

- named color: `{ kind: "named", value: "Magenta" }`
- RGB color: `{ kind: "rgb", r: 128, g: 0, b: 150 }`

#### Profile

A `LightingProfile` is the reusable manual base state.

- It stores desired state for one or both surfaces.
- It may include built-in presets and user-saved profiles.
- It never stores hardware topology fields.

#### Rule

A `LightingRule` is a deterministic automation mapping.

- It has one trigger family.
- It resolves to either a full profile reference or a modifier.
- It belongs to a priority band.

Examples:

- `Connection Sentinel`
- `Quiet Launch`
- `Source Identity Map`

#### Override

A `LightingOverride` is temporary and time-bounded.

- It preempts the base profile for a short interval.
- It is appropriate for future event signaling.
- It expires automatically and returns control to the normal resolution chain.

#### Lock

A `LightingLock` freezes the current resolved state.

- It suppresses non-critical automation.
- It gives users a trust mechanism when they want manual control to stick.

#### Script

If script-driven control is ever introduced, it must be constrained to this same model.

- A script may apply a profile, raise an override, toggle a rule, or set a lock.
- A script may not stream frame data or bypass the priority resolver.
- A script is therefore a macro layer, not an alternate rendering engine.

### 7.2 Priority resolution

Recommended priority order, highest first:

1. Editor preview override while the user is actively composing or previewing.
2. Critical status override such as disconnect or hard failure.
3. Manual lock holding the current state.
4. Startup rule such as `Quiet Launch` while its startup window is active.
5. Context rules such as `Source Identity Map`.
6. Ambient status rules such as non-critical `Connection Sentinel` mappings.
7. Active manual base profile.
8. Raw device-read fallback when no higher-level feature is active.

This order preserves three important properties:

- explicit user control beats convenience automation
- critical feedback still supersedes manual convenience states
- base profiles remain the stable default instead of being replaced by automation logic

### 7.3 Conflict handling

Conflict handling must be deterministic and simple.

- Resolution happens per surface, not as one monolithic global blob.
- One winning owner per surface is chosen at each priority band.
- If multiple rules in the same band match, tie-break in this order:
  1. surface-specific rule over global rule
  2. more specific trigger over broader trigger
  3. most recently activated rule
  4. stable lexical rule identifier
- Unsupported fields are stripped during capability normalization instead of producing partial undefined behavior.
- If the resolved output does not change, the app emits no new write.

### 7.4 Deterministic behavior guarantees

- The same capability contract plus the same active inputs must always resolve to the same surface state.
- Intermediate slider previews may be dropped, but the final committed state must be preserved.
- App-driven animation loops are out of scope; the app changes states, and the device renders modes.
- Both surfaces should be conceptually resolved together even if transport still applies them through category-based writes.
- On reconnect, the app should only reapply a state if the resolved state differs from the last known applied state.

## 8. Final Recommendations

- Adopt a single secondary `Lighting Studio` instead of adding more permanent Home controls or another navigation destination.
- Make `Profile Library` the foundational state layer; the selected automation features should all resolve through it or through profile-compatible modifiers.
- Lead the first wave with `Surface Split Composer`, `Connection Sentinel`, `Quiet Launch`, and `Source Identity Map`, because they extend the product in clearly different ways while staying inside the current transport model.
- Use `Context Lens` as an explanatory support pattern even though it is not one of the top-five feature concepts.
- Keep hardware-specific strip properties and legacy raw RGB fields in raw Config. Do not force them into the main Light experience.
- Defer `Rule Grid`, `Lighting Stories`, and `Script Slots` until the app has a broader, better-proven signal inventory and a stronger case for deeper automation UX.
