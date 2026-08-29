# Discoverability — Specification

Status: proposed. Companion documents: `plan.md` (how to build it), `prompt.md` (kickoff for the
implementing agent).

Revision 2. Revision 1 was reviewed against the codebase by an independent model and twenty defects
were found, six of them fatal — a rename the style compiler would have rejected, an offline state
that cannot be derived from the app's own signals, a search overlay whose keyboard model contradicts
the focus engine, and a "collapsed but mounted" claim that the component does not implement. Each is
resolved below, and §14 records what changed so the same ground is not re-argued.

---

## 1. Summary

The app is capable and hard to find your way around. Three problems are addressed together because
they share one mechanism:

1. **Three appearance styles carry names that do not describe them.** `Modem Grey` has no provenance
   anywhere in `docs/plans/appearance-styles/research.md` — it was invented — and it is easily
   misread as "Modern Grey". `Petrol Teal` uses a British and German word for dark blue-green that
   many readers will not know. `Full Sun` names daylight, but the style has a dark mode as well, so
   the name is wrong half the time.

2. **Nothing tells the user what the app can do.** Home opens on thirteen device-shaped blocks. There
   is no search, no index, and no first-run explanation.

3. **The features that need no C64 are the hardest to reach.** SID Radio plays thousands of tunes
   entirely on the phone with no network. Reaching it takes: Play tab, wait for a current item to
   exist, find the wrapping button row, open the launcher sheet, pick a mood. With no device
   reachable, Home is a wall of "Not available" and the app looks broken rather than useful.

The mechanism shared by (2) and (3) is a **registry of everywhere the app can go and everything it
can do**, plus a resolver that navigates to any entry in it. Search consumes the registry. The Home
quick actions consume it. The first-run tour consumes it.

---

## 2. Goals

1. Every appearance style's name describes what it is, in a word a reader already knows.
2. Anything the app can do is reachable from one place, by keypad and by touch equally, within the
   latency budget in §5.5.
3. What works without a C64 Ultimate is visible on the landing screen, whether or not one is connected.
4. A first-time user is shown what the app is for, can leave at any point, and can come back to it.
5. The four capabilities identified as buried are each one action from Home.

## 3. Non-goals

- **Reorganising Settings or Config.** Search makes their rows findable. Neither page is restructured,
  and neither page's own search box changes.
- **A seventh tab.** The tab bar already scrolls at 320 px with six tabs.
- **Fuzzy subsequence matching.** See §5.6.
- **A global transport refactor.** F1 and F3 route through a latched command bus to the Play page
  (§9.4). Hoisting `usePlaybackController` out of `PlayFilesPage` is separate work.
- **Renaming the four styles that already describe themselves.** Breadbin Beige, Neon Pop, Amber Glow
  and Vault Black are unchanged.
- **Changing any colour value.** §10 is a rename and nothing else.
- **Binding the Commodore key.** See §9.3 — it cannot be done without knowing what the key emits.

---

## 4. Locked decisions

| #   | Decision                                                                                                                                                                                                       | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Three styles are renamed: `modem-grey` → **Cool Grey**, `petrol-teal` → **Ocean Teal**, `full-sun` → **High Contrast**. The other four are untouched.                                                          | Each new name says what the style is in a word the reader knows. "High Contrast" is also the term Android and iOS use, so the people who need that style will recognise it.                                                                                                                                                                                                                                                                               |
| D2  | Ids are renamed with the display names. The rename is **declared in the YAML** as `renamed_from`, and the compiler generates both the rename map and the retirement record from it.                            | `scripts/compile-styles.mjs:239` (`checkNoSilentRetirement`) fails the build when a previously compiled id disappears without being declared. A hand-written rename map in TypeScript would satisfy the runtime and still fail the compiler.                                                                                                                                                                                                              |
| D3  | Search has one implementation and three doors: a field at the top of Home, the top entry of the Quick Menu, and the physical key `7`. **The app bar is not changed.**                                          | `AppBar.tsx:113` records that the title zone gets 172 CSS px on the smallest screen at the largest text size, and "Play files" needs 197 px — titles already wrap. A search icon costs a further 48 px and would put a third ghost icon button beside the two that already sit together, one of which opens the device switcher.                                                                                                                          |
| D4  | The search key is `7`. `*` and `#` are not touched.                                                                                                                                                            | `*` already means three things (Diagnostics globally, host-separator cycling in a text field, drive/view toggle in Game Mode) and `#` likewise. `7` means one thing (T9 letters in a text field) and nothing outside one. `7` also continues the existing "digits go somewhere" grouping.                                                                                                                                                                 |
| D5  | The index is tiered: a **static tier compiled at build time**, and lazy tiers appended asynchronously. Generation runs in `prebuild`; a drift check runs in `lint`.                                            | The pattern `feature-flags` and `menu-mapping` already use. `styles:check` alone is not enough: it runs only in `lint`, and `test:ci` never calls `lint`, so a stale generated file can pass the whole test suite.                                                                                                                                                                                                                                        |
| D6  | An entry whose precondition is unmet is **listed, disabled, with the reason** — never hidden.                                                                                                                  | Hiding "Live View" because no device is connected makes the app look like it cannot do it.                                                                                                                                                                                                                                                                                                                                                                |
| D7  | Home gains two blocks above the existing machine Quick Actions: the search field, then **Listen and play**. The machine Quick Actions grid is unchanged.                                                       | Keeps "Start SID Radio" from ever being a neighbour of "Power Off". **Revised in §17:** the section is gone and its four tiles sit inside Quick Actions, in bands that keep Radio away from Power Off.                                                                                                                                                                                                                                                    |
| D8  | Home's offline arrangement is derived from the **selected device's** connection state and its bootstrap status (§7.2). No new network polling is introduced.                                                   | There is always at least one saved device — a default is bootstrapped on first launch and deleting the last one immediately replaces it (`savedDevices/store.ts:919`) — so "no saved device" is not a state that exists. Background health checks probe only the selected device (`useSavedDeviceHealthChecks.ts:439`); polling every saved device to manufacture a global answer would add traffic against hardware this repo already treats as fragile. |
| D9  | The first-run tour **drives the real app**: it navigates to each page, spotlights the actual elements, and captions them. A step whose anchors cannot appear degrades to the same caption without a spotlight. | The user sees the app, not pictures of it, and the tour is the same length every time.                                                                                                                                                                                                                                                                                                                                                                    |
| D10 | The tour can be abandoned at any step, and restarted from **Docs** and from **Settings → About**. If it ran with no device, Home offers the remaining device steps once after the first successful connection. | A tour that can only be taken once helps only once.                                                                                                                                                                                                                                                                                                                                                                                                       |
| D11 | `7` is served by a **dedicated global key listener**, not by the keypad shortcut handler.                                                                                                                      | The keypad shortcut handler lives inside `FocusNavigationProvider`, which `App.tsx:278` mounts with `enabled={flags.keypad_input_enabled}`. Adding `openSearch` there would make the search key vanish for anyone who turns keypad input off.                                                                                                                                                                                                             |
| D12 | F1 and F3 are bound speculatively. **The Commodore key is not bound.** A **Key Explorer** under Diagnostics reports what any pressed key emits.                                                                | `keymap.ts:29` requires an exact `code`, `key` or `keyCode`, and `keyEvent.ts:156` matches exactly. An unknown emitted code cannot be expressed as a placeholder. F1 and F3 are real, standard codes and can be bound today; the Commodore key cannot, and guessing at a real code risks shadowing a key that already works.                                                                                                                              |
| D13 | Everything lands in **one pull request**, implemented in one pass.                                                                                                                                             | The Home quick actions, the tour's steps and search all consume the same registry.                                                                                                                                                                                                                                                                                                                                                                        |
| D14 | Every registry entry is proven reachable, by a walk whose coverage is defined per target kind (§5.13).                                                                                                         | This is what stops the index rotting.                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 5. App-wide search

### 5.1 Shape of an entry

```ts
export type SearchGroup = "action" | "page" | "setting" | "config" | "music" | "disk" | "docs";

export type SearchTarget =
  /** A tab or sub-route. */
  | { kind: "route"; path: string }
  /** A collapsible section: navigate, open it, scroll to it. */
  | { kind: "section"; path: string; scope: string; id: string }
  /** A control inside a section: navigate, open the section, scroll to and focus the control. */
  | { kind: "control"; path: string; scope: string; sectionId: string; testId: string }
  /** A live device config item: navigate to Config, open the category, scroll to the item (§5.9). */
  | { kind: "configItem"; category: string; itemName: string }
  /** Something the app does rather than somewhere it goes. Resolved via the handler map (§5.2). */
  | { kind: "action"; handlerId: string };

export interface SearchEntry {
  /** Stable and unique. Persisted in the recently-picked list, so it must not change between builds. */
  readonly id: string;
  /** Translation key plus English default, in the shape `t()` already takes (§5.11). */
  readonly titleKey: string;
  readonly titleDefault: string;
  readonly subtitleKey?: string;
  readonly subtitleDefault?: string;
  /** Words a user might type that are not in the title. English only; not translated in this release. */
  readonly keywords?: readonly string[];
  readonly group: SearchGroup;
  readonly target: SearchTarget;
  readonly iconId?: string;
  /** Named preconditions, evaluated at query time against the live app (§5.3). */
  readonly requires?: readonly SearchRequirement[];
}
```

### 5.2 Why handler ids, not functions

Tier 0 is generated into `src/generated/searchIndex.ts` from `search/search-index.yaml`. A generated
data module cannot hold a closure, so an `action` target names a **handler id** which the runtime
resolves against a map assembled in `src/lib/search/handlers.ts`.

Two tests hold the contract from both ends: every `handlerId` in the YAML resolves to a handler, and
every handler is referenced by at least one entry.

### 5.3 Requirements

Requirements are **declarative and evaluated at query time**, never baked into the generated file. The
build machine does not know this user's feature flags, build variant, connected hardware or firmware.

```ts
export type SearchRequirement =
  | { kind: "device" } // a connected C64 Ultimate
  | { kind: "capability"; capability: DeviceCapabilityKey } // e.g. supportsStreaming, supportsPowerCycle
  | { kind: "productFamily"; families: readonly string[] } // U64-only surfaces
  | { kind: "telnet" } // Telnet-backed actions
  | { kind: "flag"; flag: string }
  | { kind: "variant"; variant: string }
  | { kind: "hvsc" }
  | { kind: "session" }; // a restorable playback session exists
```

`capability`, `productFamily` and `telnet` exist because Home does not gate on connection alone. It
gates on `deviceCapabilities` (`HomePage.tsx:1285` for streaming, `HomePage.tsx:197` and `:319` for
the rest) and on Telnet support. Without them a connected Ultimate-II+ would be offered enabled
results for U64-only features, and the resolver would spin until its ceiling because the anchor is
never rendered.

A resolver turns each requirement into `{ met: boolean; reason: string }`. `reason` is what the
disabled row shows: "Needs a connected C64 Ultimate", "Not available on this model", "Needs HVSC
installed", "Turned off in Settings → Experimental Features". A row whose reason is a settings switch
offers a second row that navigates to that switch.

**Adding a requirement kind is a one-line change in two places** — the union and the resolver — and a
test asserts the resolver handles every member of the union exhaustively.

### 5.4 Tiers

| Tier | Contents                                                  | Size              | Built                                     | Blocking?                             |
| ---- | --------------------------------------------------------- | ----------------- | ----------------------------------------- | ------------------------------------- |
| 0    | Pages, sections, actions, settings rows, docs sections    | ~400–700          | `prebuild`, checked in `lint`             | Scored synchronously on the keystroke |
| 1    | Saved devices, playlists, liked tunes, recently played    | hundreds          | Registered at runtime as each store loads | Scored synchronously with tier 0      |
| 2    | HVSC tunes, the live device config tree, the disk library | tens of thousands | Delegated to the stores that own them     | Debounced, appended when it returns   |

### 5.5 The latency budget, and how it is actually proven

**The claim.** Scoring tiers 0 and 1 is synchronous work on the keystroke and the results commit in
the same React update. The user-visible interval — keystroke to painted list — targets **under 100 ms
at p95 on the Pixel 4**.

**How it is proven.** A wall-clock assertion inside Vitest is not proof: CI runners are shared, and a
16 ms threshold on a shared runner is a flake generator, not a gate. Instead:

- A **deterministic unit gate** asserts the _work_, not the time: scoring a synthetic 2,000-entry
  index performs at most one pass per entry per term and allocates no intermediate array per entry.
  This fails on an accidental O(n²) rewrite, which is the regression that actually matters, and it
  cannot flake.
- A **wall-clock unit measurement** on the same index reports its timing and fails only above a loose
  ceiling of 150 ms — a smoke alarm, not a stopwatch.
- A **HIL stage** on the Pixel 4 is the real budget. It types a four-character query into the live
  overlay, timestamps `performance.now()` inside the `keydown` handler, and timestamps again in a
  `requestAnimationFrame` callback scheduled from the effect that runs after the results commit.
  **120 samples**, p95 under 100 ms. Twenty samples cannot establish a p95 — it would be one of the
  two worst observations.

**Tier 2 has a budget too.** It is not free: the HVSC search scans roughly sixty thousand rows on the
JS thread, which is why `useHvscArchiveSearch` debounces at all. Tier 2 inherits that hook's existing
**180 ms debounce and 100-result cap** unchanged (§5.9). Its group header shows a spinner until it
returns, and it never blocks tiers 0 and 1.

### 5.6 Matching and ranking

Query and entry text are normalised identically: lowercased, diacritics stripped. The query splits on
whitespace into terms. **An entry matches when every term matches something in it** — "sid rad" finds
_SID Radio_, "dark col" finds the Appearance rows.

Per term, the best available score is taken:

| Score | Match                                     |
| ----- | ----------------------------------------- |
| 100   | The title is exactly the term             |
| 80    | A word in the title starts with the term  |
| 60    | The title contains the term anywhere      |
| 40    | A keyword matches or starts with the term |
| 20    | The subtitle contains the term            |

The entry's score is the sum across terms, plus a group weight (actions and pages above content, so
"radio" offers _Start SID Radio_ before a tune with "radio" in its title), plus a bonus for entries
this user has picked before. Ties break on title length, then alphabetically. Entries whose
requirements are unmet sort last within their group.

**Why not fuzzy subsequence matching.** On a T9 keypad every character costs two to four presses, so
queries are three or four characters, not ten. Subsequence matching returns large amounts of noise at
that length, and the noise is what the user then has to read.

### 5.7 The overlay, and its keyboard model

One component, opened by all three doors. Tapping the Home field expands into it rather than searching
inline, so results get the whole screen instead of competing with the on-screen keyboard.

**The overlay owns its own keyboard handling. It does not reuse the focus ring.** This is not a
preference; the engine forbids it. `useFocusNavigation.tsx:458` deliberately ignores keys while an
editable element is focused, and inside a dialog Up and Down move real DOM focus through tabbables.
A results list left to the ring would therefore pull focus out of the search field on the first Down
press and stop the user typing.

So:

- The overlay is a `role="dialog"` covering the screen, and its result list carries
  `data-key-nav-skip` so the global discovery engine does not enumerate the rows at all.
- A keydown handler on the input owns Up, Down, Enter and Escape. Focus **stays in the field**; the
  active row is tracked with `aria-activedescendant`, and the list is scrolled to keep it visible.
- Back and Escape close. A tap activates a row directly.
- Every row is at least 44 px tall.
- At most five rows per content group, with a "More in <group>" row that expands it.
- **Empty query** shows the four promoted actions as chips, then recent searches.
- **No matches** names what was searched and offers the nearest group.

**Opening from the Quick Menu** closes that dialog first and opens the overlay on the next tick.
Stacking two Radix focus scopes and letting one unmount under the other is a known source of stray
focus and swallowed Back presses in this codebase.

### 5.8 Accessibility

The field is a `combobox` with `aria-expanded` and `aria-controls`; the list is a `listbox` of
`option`s; `aria-activedescendant` tracks the active row, which is consistent with the keyboard model
in §5.7 rather than in conflict with it. Group headers are presentational and `aria-hidden`; the group
name is folded into each option's accessible name instead. Disabled rows carry `aria-disabled` and
their reason in the accessible name.

### 5.9 Relationship to the searches that already exist

**The Config page's search box and the Play page's "Find a tune" sheet are unchanged.** Each filters
one page's own content and each is faster for that job.

What is added is **navigation into** those pages, not a second search inside them:

- **Config.** The page's search box today filters menu-page labels, group labels and category names —
  not individual items (`ConfigBrowserPage.tsx:975`). Global search therefore needs a new deep-link
  handler on the Config page, which the `configItem` target drives: navigate, select the category,
  wait for the live item list, scroll to the named item, highlight it. The item index itself is tier 2
  and is built from the config data the page already fetches; nothing new is requested from the device.
- **HVSC.** Tier 2 music results call `useHvscArchiveSearch` — the same hook "Find a tune" uses, with
  its existing 180 ms debounce and 100-result cap. There is one HVSC search implementation and this is
  a second caller of it.

### 5.10 What is persisted

| Key                     | Contents                                              | Cap |
| ----------------------- | ----------------------------------------------------- | --- |
| `c64u_search_recent:v1` | Queries the user actually ran to an activated result  | 10  |
| `c64u_search_picked:v1` | Entry ids picked, newest first, for the ranking bonus | 20  |

Both are pruned on write. A query is recorded only when a result was activated from it, so abandoned
typing is never stored.

### 5.11 Copy and translation

Entry titles and subtitles are stored as a translation key plus an English default, in the shape `t()`
already takes, so a translation can be added without regenerating the index. Keywords are English-only
in this release and are documented as such.

### 5.12 Navigating to a result

`navigateToSearchTarget(target)` is the single resolver. The Home quick actions and the tour use it too.

1. Consult `lib/navigation/navigationGuards.ts` before moving. A guarded page — an HVSC import in
   progress, for one — may refuse, and the overlay stays open so the user can see why.
2. If the target names a route and it is not the current one, navigate.
3. If it names a section, request it open. `collapsibleSectionStore` gains
   `requestSectionOpen(scope, id)`; today it has only `requestSectionsBulk`.
4. Wait for the anchor to exist, bounded: a `MutationObserver` with a 2 s ceiling.
5. Scroll it into view centred, set `data-search-landed` for a 1.2 s highlight, and place DOM focus on
   it so the next key press acts on the thing that was searched for.

A target that never appears raises a toast naming what could not be reached. It never fails silently.

**The highlight must not move anything.** It is drawn as `outline` and `box-shadow`, never as a
`border` or a size change.

### 5.13 What the reachability walk actually covers (D14)

Revision 1 claimed every entry's anchor is walked. That is not achievable — an `action` entry has no
anchor, and a `route` entry may have none either. Coverage is defined per kind:

| Target kind  | What the test proves                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `route`      | The path resolves to a route in the router and is not the 404                                           |
| `section`    | Navigating and requesting the section open puts a live element carrying that section's testid on screen |
| `control`    | As `section`, and the named `testId` exists and is focusable                                            |
| `configItem` | Against a recorded device-config fixture, the category resolves and the item name is present            |
| `action`     | The `handlerId` resolves to a handler in the map                                                        |

Entries whose requirements are unmet in the test environment are run against a fixture that satisfies
them where a fixture can (flags, HVSC, session, capabilities). Entries gated on a **build variant not
being built** are excluded, and the exclusion list is itself asserted to be empty for the variant
under test — so an entry cannot be quietly parked there.

### 5.14 Drift gates

- `npm run search:build` generates the index and runs in `prebuild`, alongside `feature-flags:compile`
  and `menu-mapping:compile`.
- `npm run search:check` fails on any difference between the generated and the committed file, and
  runs in `lint` alongside `styles:check`.

Generation in `prebuild` is what closes the hole: `test:ci` runs `build`, and `build`'s prebuild
regenerates the index, so a test run cannot pass against a stale one.

---

## 6. Home

### 6.1 Order

**Revised in §17**, after the branch was used on a handset: "Listen and play" is no longer a section
of its own, and System info moved to the foot of the page. The tables below describe revision 2 of
this section; §17 states what changed and why.

The current order, read from `HomePage.tsx`: System info (1254), Machine controls (1257), Live View
(1286), CPU & RAM (1295), Ports (1422), **Video (1519)**, Audio mixer (1644), User interface (1648),
Lighting (1665), Drives (1740), Printers (1769), Streams (1795), Config actions (1809). Thirteen
blocks. Revision 1 omitted Video and miscounted; this is the real list.

| Position | Connected                                                                                                                              | Offline (settled, §7.2)                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1        | Search field                                                                                                                           | Search field                                                                         |
| 2        | Listen and play (§17: the four tiles moved into Quick Actions)                                                                         | Listen and play (§17: rendered on their own, as the only usable actions)             |
| 3        | Machine Quick Actions                                                                                                                  | **Connect a C64** card                                                               |
| 4        | System info (§17: moved to the foot of the page)                                                                                       | System info, app version only (§17: at the foot)                                     |
| 5–16     | Live View, CPU & RAM, Ports, Video, Audio mixer, User interface, Lighting, Drives, Printers, Streams, Config actions — order unchanged | Rendered **closed**, under one line: "Connect a C64 Ultimate to reach its settings." |

System info moves below the actions. A version line is not the most important thing on the landing
screen, and it is what currently occupies that position.

### 6.2 What "rendered closed" means, precisely

Revision 1 said the offline sections stay mounted. They do not, and cannot: `CollapsibleSection`
renders its body only while open (`CollapsibleSection.tsx:448`), and a test requires exactly that
(`CollapsibleSection.test.tsx:390`). Revision 1 also claimed unmounting loses the user's chosen open
state, which is false — the state is persisted on toggle (`CollapsibleSection.tsx:232`).

So the offline behaviour is: **the section headers render, their bodies do not.** Two consequences the
implementation must honour:

- Any test or automation that addresses a section _header_ by testid keeps working. Any that addresses
  a _control inside_ one must first open the section — which the video walk already does
  (`playwright/video.spec.ts:116`) and which the merge gate must be made to do.
- Closing a section for presentation must **not write to the section store**. A user who had Drives
  open should find it open again when their C64 comes back. This needs a presentation-level override
  in `CollapsibleSection` that suppresses the body without touching persisted state, and a test that
  asserts the persisted value is unchanged after an offline period.

### 6.3 The four promoted actions

| Tile                                            | What it does                                                           | Reuses                                                                                                    | Disabled when                              |
| ----------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Radio**                                       | Navigates to `/play?radio=1`; Play opens the station launcher on mount | `SidRadioLauncherSheet`, `useSidRadio`                                                                    | SID Radio is switched off in Settings      |
| **Last tune** ("Resume" in revision 1; see §17) | Restores the last tune session and plays, naming the tune on the tile  | `PLAYBACK_SESSION_KEY` and the restore path in `usePlaybackPersistence` (`usePlaybackPersistence.ts:297`) | There is no restorable session             |
| **Recent**                                      | Opens a sheet of recently played tunes, disks and programs             | `recentlyPlayed.ts`, extended (§6.4)                                                                      | The list is empty                          |
| **Live View**                                   | Expands and scrolls to the Live View card                              | `LiveViewCard`, the §5.12 resolver                                                                        | No device, or `supportsStreaming` is false |

Revision 1 cited `lib/playback/playbackSessionPersistence.ts` as Resume's source. That module stores
the **device mixer and mute snapshot**, not a restorable tune. The tune session lives under
`PLAYBACK_SESSION_KEY` inside `usePlaybackPersistence`, and that is what Resume reads.

A disabled tile shows its reason, as D6 requires of a search row. A tile that vanishes teaches nothing.

Radio deliberately navigates rather than hoisting the station launcher into a provider. `useSidRadio`
produces items into the Play page's playback engine; a second owner of that transport is how two
stations end up running at once.

### 6.4 Recently played, extended

`RecentlyPlayedEntry` is HVSC-tune-shaped: `virtualPath` is the identity, and the fields are title,
author and song number. Disks and programs need a `category` and their own source descriptor. The
storage key moves to `c64u_recently_played:v2`; v1 entries are read once and migrated with
`category: "sid"`, covered by a test that feeds it a real v1 payload.

---

## 7. Behaviour around connection state

### 7.1 Why this needs its own section

Home's arrangement now depends on whether a device is reachable, and this app's connection state is
noisy: discovery runs at startup and on resume, handovers abort in-flight reads, and the hardware
drops out under load. A naive `isConnected ? A : B` reorders the landing page whenever the network
hiccups.

### 7.2 Definition

There is always at least one saved device. A default is bootstrapped on first launch, and deleting the
last one immediately replaces it with a fresh default (`savedDevices/store.ts:919`). "No saved device"
is not a reachable state, and Revision 1's definition was therefore unimplementable.

Home renders the offline arrangement when **either**:

- the selected device is still the **untouched bootstrap default** — never edited, never successfully
  connected. This is the true first-run and "I have not set this up" case; or
- the selected device's connection state has been unreachable **continuously for at least 8 seconds**,
  measured from the existing connection state machine.

Only the selected device is consulted, because only the selected device is routinely probed
(`useSavedDeviceHealthChecks.ts:439`). No new polling is introduced, and no extra traffic reaches
hardware this repo already treats as fragile.

It returns to the connected arrangement immediately on a successful connection. The asymmetry is
deliberate: becoming useful again should be instant, becoming less useful should require the app to be
sure.

### 7.3 What must not happen

- The arrangement must not change while a dialog, sheet or the search overlay is open. The change is
  deferred until the overlay closes.
- The arrangement must not change during the first-run tour. The tour pins it for its duration.
- Closing a section for the offline arrangement must not write to the section store (§6.2).

---

## 8. First-run tour

### 8.1 Where it sits in the launch sequence

Three things already run on a first launch, and the tour must follow all of them:

1. `StartupLaunchSequence` — the splash and fade.
2. `DeviceDiscoveryInterstitial` — automatic discovery, if it finds anything.
3. `DemoModeInterstitial` — the simulated-device offer, when the flag is on and nothing was found.

The tour starts only once every interstitial has been dismissed and the app has settled on Home.

While it runs, `SwipeNavigationLayer` is disabled — a swipe that changed the page under a spotlight
would leave the spotlight pointing at nothing.

### 8.2 Mechanism

```ts
interface TourStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /**
   * Where to go and what to spotlight. `testIds` is a list because a step may point at more than one
   * element — step 4 highlights both the Last tune and the Recent tile — and the spotlight is then the
   * union of their rects. Absent for a step that explains rather than points.
   */
  readonly anchor?: { path: string; scope?: string; sectionId?: string; testIds: readonly string[] };
  readonly requiresDevice?: boolean;
}
```

The driver navigates with the §5.12 resolver, measures the union rect, and draws the scrim as **four
rectangles** around it rather than an SVG mask — sharper at DPR 1.5, no compositing layer. The rect is
re-measured on scroll, resize and orientation change.

When no anchor appears within the resolver's ceiling, the step degrades to a centred card carrying the
same caption. That is what "explain rather than skip" means.

### 8.3 Steps

The steps come from the app's own inventory of itself — the search index's pages, actions, config
areas and settings, and the page-by-page description in `README.md` — rather than from what was built
most recently. Captions are written for a reader who has never used a C64: short sentences, no
abbreviations, and no word that only means something inside this app.

| #   | Step                                                                      | Anchors                             | Without a device                  |
| --- | ------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| 1   | What this app is                                                          | none, centred                       | same                              |
| 2   | Search — what it finds, and the three ways in                             | Home search field                   | same                              |
| 3   | Music with no C64                                                         | Home _Radio_ tile                   | same — fully demonstrable         |
| 4   | Pick up where you left off                                                | Home _Last tune_ and _Recent_ tiles | same                              |
| 5   | Build a playlist — this device, the machine's storage, the online library | the Play tab                        | same                              |
| 6   | Disks and games — mount, collect, swap, create                            | the Disks tab                       | same                              |
| 7   | Connecting your C64                                                       | the health badge                    | explains; offers to run discovery |
| 8   | Controlling the machine                                                   | Home Quick Actions                  | explains                          |
| 9   | Watch, listen and play                                                    | Home Live View card                 | explains                          |
| 10  | Every machine setting                                                     | the Config tab                      | explains                          |
| 11  | Getting around without the screen                                         | the Home tab                        | same                              |
| 12  | Help is built in, and restarts this tour                                  | Docs tour card                      | same                              |
| 13  | Making it yours — appearance, text size, display profile                  | Settings → Appearance               | same                              |

### 8.4 Controls and state

A caption bar at the bottom carries `Step n of <count>` and **Skip**, **Back**, **Next**. Keypad: Left
and Right are Back and Next, OK is Next, the Back key skips. Every control is at least 44 px. The bar
is padded by the bottom safe-area inset, or its buttons are drawn under the system navigation bar.

```ts
// c64u_tour_state:v1
{
  completedAt: number | null;
  skippedAt: number | null;
  lastStepId: string | null;
  deviceStepsPending: boolean;
}
```

`deviceStepsPending` is set when steps 5–7 ran without a device. On the first successful connection
after that, Home shows a single dismissible row offering those three steps. Dismissing clears the
flag; it is never offered twice.

Restart entries: a card at the top of **Docs**, and a row in **Settings → About**.

---

## 9. Keypad

### 9.1 The search key

`7` opens the search overlay. It is served by a **dedicated global listener**, not by the keypad
shortcut handler in `useFocusNavigation`, because that handler only exists while
`flags.keypad_input_enabled` is true (`App.tsx:278`) and the search key must not disappear when a user
turns keypad navigation off.

The listener applies the same exclusions the digit shortcuts do: inert inside a text field, inert while
an overlay owns the keys.

**Guard.** `7` is free only while there are six tabs. A unit test asserts `TAB_ROUTES.length < 7`, so
adding a seventh tab fails the build rather than silently stealing the search key.

### 9.2 Transport keys

| Key | Action                      | Status                                                                                                                                                                              |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Play / pause, from any page | Speculative. `code: "F1"` is a real, standard code, and a keypad handset has separate hardware soft keys, so shadowing the desktop profile's `F1 → softLeft` is safe on the device. |
| F3  | Next tune, from any page    | Speculative. Same reasoning; shadows `F3 → toggleInputMode`.                                                                                                                        |

Two semantic actions are added: `mediaPlayPause` and `mediaNext`. Both bindings go in the **keypad
profile only**, which prepends and therefore shadows the desktop base.

Revised after implementation: that placement does not spare a desktop keyboard today.
`FocusNavigationProvider` is mounted once with `profileId="keypad"` and there is no runtime
selector, so the keypad profile is the only one any code path resolves and F1 is `mediaPlayPause`
everywhere. `defaultKeyboard`'s `softLeft` and `toggleInputMode` are dormant until a selector
exists. The cost is one of several ways to go back on a desktop; Escape and the Back key are
unaffected.

**`keyCode: 0` must never be bound.** `useFocusNavigation.tsx:449` recognises the Android hardware Back
button as `key === "Escape" && code === "" && keyCode === 0`.

### 9.3 Why the Commodore key is not bound

`keymap.ts:29` requires an exact `code`, `key` or `keyCode`, and `keyEvent.ts:156` matches exactly.
There is no wildcard and no placeholder that would later become the right value. Binding a _guessed_
real code is worse than binding nothing: if the guess names a code the device already uses, the
speculative binding shadows a key that worked.

So the Commodore key ships unbound, and the Key Explorer exists to identify it. Once someone reads its
code off real hardware, binding it is a single row in `profiles/keypad.ts`. The intended action is
recorded here so that change needs no new decision: **the Commodore key opens search**, as a second
door beside `7`.

### 9.4 Key Explorer

A panel under Diagnostics. For each key pressed it shows the `key`, `code` and `keyCode` the WebView
delivered, the semantic action it resolved to, and whether it resolved to nothing. The last ten are
kept and can be copied as text for a bug report.

It **cannot reuse the existing key diagnostics**, as Revision 1 assumed. Those emit only when debug
logging is on (`keyInputDiagnostics.ts:195`), events on editable targets are deliberately never logged
(`useFocusNavigation.tsx:458`), and events inside an open Diagnostics overlay return before diagnostics
are emitted (`useFocusNavigation.tsx:487`) — which is exactly where this panel lives.

It therefore installs its own capture-phase listener, **active only while the panel is open**, and
records only key identity — never the character a key produced and never field contents.

### 9.5 Global transport

`usePlaybackController` is mounted only by `PlayFilesPage`, so there is no transport to command from
another page today.

F1 and F3 publish onto a command bus. It cannot be the existing `keypadCommands.ts` pattern unchanged:
that is a transient `window.dispatchEvent` with no queue (`keypadCommands.ts:21`), so publishing and
then navigating drops the command before Play mounts and subscribes.

The bus therefore **latches**: the command is written to a module-level pending slot and dispatched. A
consumer mounting later drains the slot. The slot carries a timestamp and is discarded after **5
seconds**, so a command cannot fire minutes later on an unrelated navigation.

When Play is already mounted it consumes the command in place. When it is not, the app navigates to
Play and the latch delivers on arrival. Acting on the shared local SID controller directly, without
navigating, was rejected: it would work for the on-device engine and not for the C64 route, so the same
key would behave differently depending on where the sound was coming from.

Both keys are inert inside a text field and inside an open overlay.

---

## 10. The appearance renames

| Old id        | Old name    | New id          | New name          | New description                                              |
| ------------- | ----------- | --------------- | ----------------- | ------------------------------------------------------------ |
| `modem-grey`  | Modem Grey  | `cool-grey`     | **Cool Grey**     | Neutral, blue-leaning grey. The app's default.               |
| `petrol-teal` | Petrol Teal | `ocean-teal`    | **Ocean Teal**    | Deep blue-green with a warm coral highlight.                 |
| `full-sun`    | Full Sun    | `high-contrast` | **High Contrast** | Maximum legibility. Heavy edges, strong text, no soft fills. |

No colour value changes.

### 10.1 The compiler must learn about renames

`checkNoSilentRetirement` (`compile-styles.mjs:239`) fails the build when a previously compiled id
disappears and is not declared under `retired`. A rename is not a retirement — the style is still
there — so the YAML gains a per-style `renamed_from` instead:

```yaml
styles:
  cool-grey:
    renamed_from: [modem-grey]
    name: "Cool Grey"
```

The compiler then: treats every `renamed_from` value as satisfying the retirement check, emits
`APP_STYLE_RENAMES: Record<string, string>` into the generated module, and fails if any
`renamed_from` value collides with a live id or appears twice.

The generated contract comment "Stable, persisted setting value. Never renamed once shipped"
(`compile-styles.mjs:373`) is now false and is rewritten to describe the rename path.

### 10.2 Where the migration runs

`resolveAppearance` is pure and performs no storage I/O by design (`resolveAppearance.ts:22`), and
`useAppStyle` reads the raw id (`useAppStyle.ts:19`) and _removes_ an unknown one after falling back
(`useAppStyle.ts:54`). Migrating anywhere later than the read therefore paints the default first and
then erases the user's real choice.

The migration runs **inside the storage read**: `readStoredStyleId` maps the stored value through
`APP_STYLE_RENAMES` and writes the new id back before anything else sees it.

`AppStylesGalleryPage` reads a `?style=` search parameter (`AppStylesGalleryPage.tsx:99`) and silently
falls back to the first style for an unknown value. It maps through `APP_STYLE_RENAMES` too, so an old
bookmarked or documented URL still lands on the style it names.

`default_style` and `device_scheme_map` in the YAML are updated to the new ids.

### 10.3 Proving no colour changed

"Byte-identical to the previous build" cannot be asserted after regeneration — the old output no longer
exists in the checkout. Instead, a fixture `tests/fixtures/appStyleTokens.pre-rename.json` is committed
in the same change, holding every compiled token value from before the rename **keyed by the new id**.
A test asserts the compiled tokens equal the fixture exactly. The fixture is generated once, from the
pre-rename build, and the commit that adds it is the commit that renames.

---

## 11. What has to change outside `src/`

**Generated and source data**

- `styles/appearance-styles.yaml` — three keys, `renamed_from`, names, descriptions, `default_style`,
  `device_scheme_map`.
- `scripts/compile-styles.mjs` — `renamed_from` support, `APP_STYLE_RENAMES` emission, the corrected
  contract comment.
- `search/search-index.yaml`, `src/generated/searchIndex.ts`, and the `search:build` / `search:check`
  scripts wired into `prebuild` and `lint`.

**Automation the Home change breaks, which must be migrated in the same commit**

- `tools/hil/merge_gate.mjs:170` — reads `live-view-card` on Home and fails if it is absent. The Live
  View card is now inside a section that may be closed; the gate must open it first.
- `playwright/video.spec.ts:116` — walks the existing Home sequence and opens sections before using
  their controls. The sequence changes.
- `playwright/screenshot-catalog.json` and `playwright/homeScreenshotLayout.ts` — pin Home slice names
  and their order.
- `tests/unit/readmeScreenshotCoverage.test.ts:29` — asserts the README references the catalogue's
  slices.

**Documentation**

- `README.md` — the Appearance Styles table, the feature bullets, new sections for search and the tour.
- `docs/internals/appearance-styles.md`, `docs/keyboard-input.md` (the shortcut list),
  `docs/cta-inventory.md`.
- `scripts/build-manuals.mjs` — the manual prose lives inside this script, including the keypad
  shortcut table. Editing the generated `docs/manual/**/*.md` directly is pointless; it is overwritten
  on the next build.
- `docs/img/app/styles/showcase-*.png` — renamed, and retaken along with every screenshot the Home and
  search changes affect. See the drift procedure in `plan.md`.

---

## 12. Test plan

| Area                       | How it is proven                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renames — no colour change | Compiled tokens equal `tests/fixtures/appStyleTokens.pre-rename.json` exactly.                                                                                                                                                                                  |
| Renames — compiler         | `renamed_from` satisfies the retirement check; a collision with a live id fails; a duplicate `renamed_from` fails.                                                                                                                                              |
| Renames — migration        | Each old persisted id becomes its new id at the storage read and is written back; an unknown id still falls back to the default; an old `?style=` gallery URL resolves.                                                                                         |
| Ranking                    | Table-driven: a fixed index, a list of queries, the expected top three. Includes "rad" → _Start SID Radio_ above any tune containing "radio".                                                                                                                   |
| Scoring cost               | The deterministic work gate of §5.5 over a synthetic 2,000-entry index.                                                                                                                                                                                         |
| Latency                    | HIL stage, 120 samples, p95 under 100 ms, measured `keydown` to post-commit `requestAnimationFrame`.                                                                                                                                                            |
| Reachability               | The per-kind walk of §5.13, with an empty variant-exclusion list for the variant under test.                                                                                                                                                                    |
| Handler map                | Every `handlerId` resolves; every handler is referenced.                                                                                                                                                                                                        |
| Requirements               | The resolver handles every member of the union exhaustively; with each requirement unmet, its entries are listed, disabled, and carry the stated reason.                                                                                                        |
| Drift                      | `styles:check` and `search:check` clean; a hand-edited generated file fails `search:check`.                                                                                                                                                                     |
| Overlay keyboard           | Down does not move DOM focus out of the field; `aria-activedescendant` advances; the result list carries `data-key-nav-skip`.                                                                                                                                   |
| Home offline               | At the settled offline state Home renders the search field, the four promoted actions on their own (§17), and the Connect card, and the device section headers render with their bodies closed.                                                                 |
| Section store              | An offline period does not change any persisted section open-state.                                                                                                                                                                                             |
| Connection flap            | 8 seconds unreachable does not reorder Home; 9 seconds does; reconnection restores it immediately; nothing reorders while an overlay is open or the tour is running.                                                                                            |
| Recently played            | A real v1 payload migrates to v2 with `category: "sid"`.                                                                                                                                                                                                        |
| Tour                       | Every step reaches its anchors or degrades to a caption; a two-anchor step spotlights the union; Skip at any step writes `skippedAt`; the device steps are offered exactly once after a first connection; the tour waits for all three interstitials.           |
| Keypad                     | `7` opens the overlay with `keypad_input_enabled` **false**; it is inert inside a text field; `TAB_ROUTES.length < 7`; nothing binds `keyCode: 0`; the keypad profile's F1/F3 shadow the base while the desktop profile keeps `softLeft` and `toggleInputMode`. |
| Command latch              | A command published with Play unmounted is delivered when Play mounts; a command older than 5 s is discarded.                                                                                                                                                   |
| Key Explorer               | It records keys while open with debug logging **off**, and records no character or field content.                                                                                                                                                               |
| Layout                     | 320 × 427 at the largest text size: nothing on Home or in the overlay truncates to nothing, and every row meets the 44 px floor.                                                                                                                                |
| Merge gate                 | `tools/hil/merge_gate.mjs` passes, baselined against the base commit first.                                                                                                                                                                                     |

---

## 13. Risks

| Risk                                                                 | Mitigation                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The static index rots as testids are renamed                         | §5.13's walk fails in CI on the first rename.                                                                    |
| A stale generated index passes CI                                    | Generation in `prebuild`, which `test:ci` reaches through `build`; check in `lint`.                              |
| Home reordering fights a flapping connection                         | §7.2's settled definition, with an explicit flap test.                                                           |
| The offline arrangement destroys the user's section preferences      | The presentation override of §6.2, with a test on the persisted value.                                           |
| Two owners of the SID Radio transport                                | Home navigates to Play rather than hoisting `useSidRadio`.                                                       |
| A speculative binding shadows a working key                          | Only F1 and F3 are bound, both real codes, both in the keypad profile only. The Commodore key is not guessed at. |
| The tour collides with the startup interstitials                     | §8.1 sequences it strictly after all three.                                                                      |
| A full screenshot rerun buries the real changes in environment drift | The procedure in `plan.md`: rerun, diff, keep the intended files, revert the rest.                               |
| Commit or PR text naming a build variant                             | Plan documents may name hardware; commits and the PR body must not.                                              |

---

## 14. What changed in revision 2

Recorded so the same ground is not re-argued. Each item was found by an independent review of
revision 1 against the code, and each was confirmed against the cited file before the fix was written.

| #   | Defect in revision 1                                                                                      | Resolution                                                                    |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Requirements could not express device capability, product family or Telnet gating                         | §5.3 adds all three, plus an exhaustiveness test                              |
| 2   | The offline definition relied on "no saved device", a state that cannot occur                             | §7.2 redefines it on the selected device's state and bootstrap status         |
| 3   | The overlay's keyboard model contradicted the focus engine                                                | §5.7 gives the overlay its own handler and skips the ring                     |
| 4   | "Collapsed but mounted" is not what `CollapsibleSection` does                                             | §6.2 states what actually happens, and adds the no-write requirement          |
| 5   | The rename would have failed `checkNoSilentRetirement`                                                    | §10.1 adds `renamed_from` to the YAML and the compiler                        |
| 6   | The migration had no defined location and would have erased the selection                                 | §10.2 puts it inside the storage read, and covers the gallery URL             |
| 7   | The generated index could go stale because `test:ci` never runs `lint`                                    | §5.14 generates in `prebuild`                                                 |
| 8   | The reachability walk was impossible as stated                                                            | §5.13 defines coverage per target kind                                        |
| 9   | A 16 ms Vitest wall-clock gate would flake and proved the wrong thing                                     | §5.5 replaces it with a work gate plus a 120-sample HIL measurement           |
| 10  | Tier 2's 120 ms debounce contradicted reusing the existing hook                                           | §5.5 and §5.9 adopt the hook's 180 ms and 100-result cap                      |
| 11  | "Config search unchanged" contradicted landing on an individual item                                      | §5.9 separates the page's search box from a new deep-link handler             |
| 12  | The Home order omitted Video and miscounted the range                                                     | §6.1 lists the real thirteen blocks with line numbers                         |
| 13  | Automation broken by the Home change was not listed                                                       | §11 names the merge gate, the video walk, the catalogue and the coverage test |
| 14  | The command bus would drop a command across navigation                                                    | §9.5 latches it with a 5 s expiry                                             |
| 15  | "`7` ships unconditionally" was false under `keypad_input_enabled`                                        | §9.1 gives it a dedicated listener outside the provider                       |
| 16  | The Commodore key cannot be bound to an unknown code                                                      | §9.3 leaves it unbound and records the intended action                        |
| 17  | The Key Explorer could not reuse the existing diagnostics                                                 | §9.4 gives it its own capture listener and privacy rule                       |
| 18  | Resume cited the mixer-snapshot module, not the tune session                                              | §6.3 cites `PLAYBACK_SESSION_KEY` in `usePlaybackPersistence`                 |
| 19  | The "byte-identical" test had no baseline to compare against                                              | §10.3 commits a pre-rename token fixture                                      |
| 20  | Broken cross-references, a one-anchor tour step needing two, and a type that did not match the i18n claim | Fixed in §7.2, §8.2 and §5.1                                                  |

## 15. Changes made during implementation

Measured on the handset rather than reasoned about, and recorded here because they change what earlier
sections assume.

| What                                                                                                     | Why                                                                                                                                                                                                                          | Where                                     |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Text sizes capped at **1.15**; "Larger" and "Largest" retired and migrated to the largest remaining size | At 1.3 the Config section titles lost half their text behind a two-line clamp and a tab left the bar; at 1.5 ten section titles and the page title itself were cut. §5 and §6 assume the app renders at the sizes it offers. | `src/lib/textScale.ts`                    |
| The header no longer draws the **status word** below 430px                                               | D3 argues the app bar has no room to spare, and it was spending nine wide letters repeating what the glyph's colour and the problem count already say. The page title now fits on one line at the Large size.                | `src/index.css`, `UnifiedHealthBadge.tsx` |
| The tour is **thirteen steps**, from the app's own inventory                                             | §8.3's eight steps were weighted towards the most recent work and covered neither the playlist, disks, configuration nor the built-in guides.                                                                                | §8.3                                      |
| The focus engine ignores mutations confined to a **skipped subtree**                                     | The overlay rewrites its result list on every keystroke, and each one rescanned the page behind it. §5.5's 100 ms budget was unreachable without this: p95 went from 109.3 ms to 47.9 ms.                                    | `src/lib/input/focusDiscovery.ts`         |

## 16. Adversarial review

An independent review of the branch against `main` found ten defects. Each was checked against the
code before anything was changed, and all ten reproduced. Recorded because several are the kind that
a passing test suite does not catch: the code did what it said, and what it said was wrong.

| #   | Defect                                                                    | Why the tests did not catch it                                                             |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `requestConfigItemFocus` dispatched before Config had subscribed          | Every test activated a config result from `/config`, where no navigation happens           |
| 2   | `requestSectionOpen` from Home's "Set up a device", same shape            | As above                                                                                   |
| 3   | `registerSearchEntries` had no production caller, so tier 1 was empty     | The registry's own tests registered entries themselves                                     |
| 4   | The tour would open for every existing user after an upgrade              | The key is absent on a first launch and on an upgrade alike, and only the first was tested |
| 5   | The overlay's arrow keys reached result rows only                         | Keypad coverage asserted the rows, which were reachable                                    |
| 6   | HVSC readiness was passed as a literal `true`                             | The requirement resolver was tested directly, with both values                             |
| 7   | Recent recorded archive tunes only, though the store has three categories | The writer's test played an archive tune                                                   |
| 8   | The Key Explorer's copy did nothing where the Clipboard API is absent     | jsdom provides the API                                                                     |
| 9   | The offline clock was not reset on device handover                        | No test switched between two unreachable machines                                          |
| 10  | A latched transport command ran before the playlist was restored          | The hook was tested alone, without the page's hook ordering                                |

Every fix carries a test that fails when the fix is reverted.

The review was run again after those fixes and found six more. The same pattern holds: the code did
what it said, and what it said was not what the app needed.

| #   | Defect                                                                                        | Why the tests did not catch it                                         |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | The overlay read its keys off `event.key`, so a keypad D-pad (`code: "DpadDown"`) did nothing | Every test fired `key` alone, which no real keyboard sends             |
| 2   | The Recent sheet dropped disks and programs, though the tile counts them                      | Nothing was ever written to Recent but archive tunes until this branch |
| 3   | A recent row stored the play-source KIND as its source id, so it could not be reopened        | No test reopened a row from a configured local source                  |
| 4   | Config search offered the previous device's cached items after a handover                     | No test switched device with a populated query cache                   |
| 5   | Tier 2 left the previous query's rows selectable through the next debounce                    | The hook was asserted after settling, never during                     |
| 6   | The follow-up device tour ran on past the device steps, repeating the rest                    | The driver was tested from step 1, where the range is the whole tour   |

Two lessons worth keeping. A test that constructs its own input tends to construct the input the code
already handles — the `event.key` case is exactly that. And a store that gains a capability needs a
writer and a reader in the same change, or the capability exists only in the type.

A third review, run as two Claude subagents — one against this specification, one hunting defects in
the code — found fourteen more. The three that mattered most were regressions the earlier rounds had
introduced.

| #   | Defect                                                                                                    | Consequence                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `hasPriorAppState` asked its question after the saved-devices store had written its own key during render | The first-run tour could never open on a first launch — round 2's fix for upgrading users had switched it off for everyone |
| 2   | `compareScored` applied "unmet sorts last" only within a group while comparing scores across groups       | Not a strict weak ordering; on the real index a one-letter query put four disabled rows above five enabled ones            |
| 3   | The section-open latch was re-delivered rather than claimed                                               | Navigating away and back within five seconds reopened a card the user had closed, and persisted it                         |
| 4   | The tour read `event.key`, so a D-pad could not drive it                                                  | Undrivable on the hardware with no pointer                                                                                 |
| 5   | A tap on a force-closed section header wrote the flipped value                                            | A card left open came back closed once the machine answered                                                                |
| 6   | The tour's opening step measured no viewport                                                              | The one step that points at nothing dimmed nothing                                                                         |
| 7   | A non-archive tune in Recent was rebuilt as an archive request                                            | It did not play                                                                                                            |
| 8   | Four entries were gated by flags they did not declare                                                     | Offered enabled, then "Could not reach"                                                                                    |
| 9   | An expanded group stayed expanded for every later query                                                   | The five-row cap stopped applying for the session                                                                          |
| 10  | The music spinner was drawn inside a heading that existed only once results arrived                       | Never on screen during the wait it describes                                                                               |
| 11  | `redactKey` counted UTF-16 units                                                                          | An emoji reached the clipboard verbatim                                                                                    |
| 12  | Only Home claimed the Remote Input request                                                                | The search result did nothing when activated from Play                                                                     |
| 13  | The tier-2 config cap was checked on the inner loop only                                                  | Roughly one extra row per cached category                                                                                  |
| 14  | Five tests could not fail, shown by mutation                                                              | Fixed alongside                                                                                                            |

The pattern across all three rounds: a rule that depends on the PAIR rather than the element is not
an ordering; a question asked after startup is not the same question asked before it; and a test that
constructs its own input tends to construct the input the code already handles.

## 17. Home, after use

The layout in §6.1 was revised once the branch could be used on a handset.

"Listen and play" is gone as a section. Its tiles were drawn at two columns against Quick Actions'
four, so each was twice the width of the controls below it; its banner read "Needs no C64 attached"
while one of its four tiles requires a connected machine and streaming support; and this app is a
remote control first and a standalone player second, so a banner across the top of Home for the
second was the wrong emphasis. The four promoted actions are tiles in Quick Actions, which now reads in four
bands: watch (Live View, Game, Input), listen (Radio, Last tune, Recent), operate (Menu, Pause, the
RAM snapshots), and the ones that interrupt the machine last. Live View belongs with Game and Input
because all three are ways to use the C64 from here. In the offline arrangement, where that section is
drawn closed, they are rendered on their own instead — they are the actions that need no device, and
shutting them away exactly when they are the only usable ones would be the wrong way round.

Resume is labelled "Last tune". Two constraints meet: the machine's Pause control renames itself to
Resume while the C64 is paused, so one grid cannot hold two buttons of that name meaning different
things; and "Resume" does not fit a tile at four columns on a 320px screen, where the layout audit
measured it needing 64px in a 59px box.

System info moves to the foot of the page. It is reference rather than an action.

## 18. What 0.10.0-rc2 got wrong, and the fourth review

A fourth review, run against the shipped 0.10.0-rc2 build rather than against the diff, found one
regression the earlier rounds had introduced and five inconsistencies between the code and the
prose describing it.

### The header badge drew a cut circle

The badge renders one of `●▲◆○◌` as a text character and scales it — 1.42x for Healthy — to reach
the size the design asked for. Inter, which the font stack names first, ships none of the five
characters, so what is actually drawn is whichever fallback font the device supplies, and the scale
factors were measured against one machine's. On the font CI and the Android WebView fall back to,
`●` fills its em box; 1.42x of that is 25.6px inside an 18px row, and every ancestor between the
glyph and the button clips its overflow.

Revision 2 made it visible on every phone. It hid the trailing status word below 430px, which left
the row exactly the glyph's own 1em box, so the circle was then cut on the left and right as well as
the top. The result was a flat-topped green shape rather than a circle.

The badge now draws each state as an inline SVG with a `0 0 24 24` viewBox. `HEALTH_GLYPHS` is
unchanged and still supplies the character to `getBadgeLabel` and the Diagnostics header, which are
lines of text; only the badge's own rendering changed. An SVG is the same size on every device and
cannot leave the box it is given, so the per-state scale and translate tables are gone.

`appBarHeader.spec.ts` measures the drawn shape against every clipping ancestor above it and fails
if any of them takes more than half a pixel off any side.

### Two tile labels shipped cut

The layout audits measure the compact profile at 320px, where a Quick Action tile is 124px wide.
The tightest track in the app is on the MEDIUM profile at 393px, which draws four 69.6px columns and
left the label 58.6px. Nothing measured that. "Resume" needs 61.4px there and "Manage" on the Config
card needs 61.7px, and both shipped cut.

A tile label is one word with `break-normal`, so a word too wide for its box is cut rather than
wrapped. The tile's horizontal padding went from 4px a side to 2px, which is enough for both, and
`actionTileLabels.spec.ts` now sweeps profile x width x Text size over every action tile on Home.
Reverting the padding fails it on exactly those two labels.

### Quick Actions was a wall

Thirteen tiles over four rows, four of them red, and two labels that wrapped — and a grid row is as
tall as its tallest tile, so one wrapped label cost every tile beside it 21.6px. The medium 393px
row measured 112.3px against an 86px floor.

Every label is now one word: Live, Last, Backup, Restore. Reboot, Reboot (Clr Mem), Power Cycle and
Power Off are rows of a Power sheet behind one red tile, each keeping the confirmation it had. Reset
keeps a tile of its own — it is among the most-reached controls in the app and burying it would cost
more than the row it saves. Eleven tiles, three rows, and the tile floor drops from 86px to 64px.

### Backup and Restore

"Save RAM" and "Load RAM" were two words each, and "Load RAM" was inaccurate: it opens the snapshot
library rather than loading anything. "Snapshot", the word the dialogs and the library already use
for the thing being written, does not fit a tile at any sane column count — it needs 72.3px against
58.6px, and at three columns on a 360px phone at Large text it still needs 83.1px against 69.1px.

Backup is the verb Datel's own Action Replay manual used for this operation on this machine: it made
backups by taking a snapshot of memory. It pairs with Restore without explanation, both fit with real
headroom, and neither word appears on a Config tile, which is where the user's other Save and Load
live. "Snapshot" stays the noun in the dialogs, the library and the manual.

### Four documents disagreed with the code

- The manual said the offline arrangement drew three tiles "because none of them needs a machine".
  It draws four: Live View is among the promoted actions and is drawn greyed with its reason, which
  is the rule the search overlay follows. The manual was wrong, not the code.
- `docs/cta-inventory.md` is mandatory-maintenance and still described the pre-revision-2 grid: no
  promoted tiles, and Game Mode first.
- The `ram_snapshots_enabled` flag description named the old tiles.
- `docs/ux-guidelines.md`, `docs/ux-interactions.md` and `docs/features-by-page.md` all named tiles
  by labels that had changed.

### Two smaller ones

- Three search subtitles and one tour step used British spellings ("colours", "colour scheme"),
  against the American-English rule in `AGENTS.md`. The British forms stay as search KEYWORDS, which
  are matched but never displayed, so a reader who types "colour" still finds the row.
- `SearchOverlay` wrote out the group order that `GROUP_WEIGHTS` in `score.ts` already encodes. It is
  derived from those weights now, so the two cannot drift.
