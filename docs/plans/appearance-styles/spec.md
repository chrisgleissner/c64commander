# Appearance Styles — Specification

Status: proposed. Companion documents: `research.md` (what was measured), `plan.md` (how to build
it), `prompt.md` (kickoff for the implementing agent).

---

## 1. Summary

The app currently offers one appearance with a Light / Dark / System switch. This adds a second,
orthogonal axis: a **style** — a curated palette plus a surface treatment — chosen from seven
options, none of which the user can author or edit.

A style changes what the app is painted with. It does not change where anything is. Layout,
spacing, type size and type face are untouched, and that is enforced by a test rather than by
convention.

Seven styles across two modes give **twelve palettes**. Two of the seven are dark-only.

---

## 2. Goals

1. Let the user pick between visibly different experiences without ever producing an app that is
   hard to read.
2. Draw on the two design languages the product sits between: the hardware console it controls, and
   the Callback 8020's industrial and on-screen design.
3. Keep the set curated. Every style is authored, reviewed and gated. There is no free-form colour
   picker and no user-defined style.
4. Make the set extensible **by editing text**, so a style can be added late without touching
   React — the same contract `variants/variants.yaml` and `src/assets/palettes/*.vpl` already use.
5. Give the team a way to see every widget under every style at a glance, so a palette change can
   be reviewed as a picture rather than as a diff of hex values.

## 3. Non-goals

- **User-authored styles.** Explicitly out of scope: it would require colour pickers, validation
  UI and a way to present an unreadable result back to the user. Styles are authored in the repo.
- **Per-style layout.** No style may change spacing, sizing, type or density. Those already have
  their own controls (Text size, Display profile) and duplicating them here would multiply the
  test matrix for no user benefit.
- **Texture overlays.** Scanlines, grain and brushed-metal were prototyped and cut. At
  320 x 427 CSS px a repeating 3 px pattern sits directly on 13 px text, and the legibility risk
  cannot be gated automatically. None of the seven needs one.
- **Per-style splash or launcher icon.** Both are compiled into the native app from
  `variants/assets` long before a style can be read from storage.
- **Recolouring domain data.** LED colours, VIC palette swatches and anything else that promises
  "this is what your hardware will look like" stays fixed. See §7.3.

---

## 4. Locked decisions

| #   | Decision                                                                                                                                                                                     | Rationale                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Style and mode stay orthogonal. Each style declares a light and a dark rendition; a style that is only honest one way declares one mode and the Theme row is disabled with an explanation.   | Keeps System following day and night, which existing users rely on.                                                                                                                                         |
| D2  | A style controls colour, corner radius, edge treatment, elevation and the focus-ring treatment's _rendering_. It controls no geometry.                                                       | The user's constraint. Also what keeps the test matrix flat (§10).                                                                                                                                          |
| D3  | Seven styles. Twelve palettes.                                                                                                                                                               | Narrowed from twenty candidates; see §6.                                                                                                                                                                    |
| D4  | "Match my device" is an eighth entry in the picker. It reads the Ultimate's `Color Scheme` **on connect and on manual refresh**, never on a poll.                                            | The device's network stack is fragile under load, and repainting mid-task is worse than being a few seconds stale.                                                                                          |
| D5  | One style for the whole app, in its own localStorage key. Not per saved device.                                                                                                              | Style is a statement about the app, not a property of an Ultimate. Also avoids repainting during a device switch, already the app's most delicate transition.                                               |
| D6  | Both build variants default to `modem-grey`.                                                                                                                                                 | It is today's palette, cleaned up, so nobody's app changes appearance on upgrade. A variant can override the default in `variants.yaml` once there is real 8020 hardware to judge against.                  |
| D7  | The picker is a list of rows in the existing Settings → Appearance card, each with a live swatch. Selecting applies immediately; the app is the preview.                                     | Matches Text size and Display profile, needs no new route, and is reachable by D-pad in the same number of presses as the settings beside it.                                                               |
| D8  | A developer-only `/dev/styles` route renders every widget; Playwright screenshots it per style and mode.                                                                                     | Because it mounts the real components, the gallery cannot drift from the app.                                                                                                                               |
| D9  | Styles are defined in `styles/appearance-styles.yaml`, compiled to `src/generated/appStyles.ts` and a generated CSS layer by `scripts/compile-styles.mjs`, with a `styles:check` drift gate. | The user's requirement, and the established pattern in this repo.                                                                                                                                           |
| D10 | Border weight is rendered as `box-shadow: inset` or `outline`, never as `border-width`.                                                                                                      | A `border-width` change grows intrinsically-sized boxes such as buttons and badges. Rendering the edge as an inset shadow makes the zero-geometry claim provable by exact equality instead of by tolerance. |

---

## 5. The style contract

### 5.1 What a style declares

Every style declares, per mode, exactly these values. Any style missing one fails compilation
rather than falling back silently to a `var()` default.

**Colour tokens** — HSL triples, dropped into the existing custom properties in `src/index.css`:

| Token                                                                          | Role                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `--background`                                                                 | The page ground behind everything                                 |
| `--card` / `--popover`                                                         | Raised surfaces: cards, dialogs, sheets, the app bar, the tab bar |
| `--muted`                                                                      | Recessed surface: secondary button fill, chips, progress track    |
| `--foreground`                                                                 | Body text on `--card` and `--background`                          |
| `--muted-foreground`                                                           | Secondary text, section labels, disabled state                    |
| `--primary` / `--primary-foreground`                                           | The main action                                                   |
| `--secondary` / `--secondary-foreground`                                       | The supporting action                                             |
| `--accent` / `--accent-foreground`                                             | Emphasis that is not an action                                    |
| `--border` / `--input`                                                         | Hairlines and control edges                                       |
| `--ring`                                                                       | **The focus ring. Never derived from `--border`.** See §5.3       |
| `--success` / `--warning` / `--destructive` and their `-foreground` pairs      | Semantic state                                                    |
| `--interstitial-scrim`                                                         | The wash behind modals and sheets                                 |
| `--media-scrim` / `--media-on-scrim` / `--media-letterbox` / `--media-reticle` | Overlay chrome sitting on live video                              |
| `--key-character` / `--key-function` surface, border and foreground            | Remote-input key groups                                           |
| `--category-1` … `--category-4`                                                | Disk-group chips                                                  |
| `--chart-1` … `--chart-5`                                                      | Diagnostic chart series                                           |
| `--diag-user` / `-system` / `-rest` / `-ftp` / `-warn` / `-error`              | Diagnostics log channels                                          |

**Shape and elevation tokens:**

| Token                      | Role                                                                                            | Constraint                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--radius`                 | Base corner radius; `sm`/`md`/`lg` derive from it                                               | Purely visual; no layout effect                              |
| `--radius-panel`           | Radius for large panels and sheets                                                              | New; today these are literal `rounded-xl`/`2xl`/`3xl`        |
| `--edge-width`             | Edge weight, rendered as inset shadow                                                           | 1 px or 2 px only. **Never** applied as `border-width` (D10) |
| `--shadow-1` / `-2` / `-3` | Elevation ramp, colour included                                                                 | Replaces Tailwind's hard-coded `rgb(0 0 0 / …)` defaults     |
| `--ring-style`             | `solid` \| `inverse` \| `glow`                                                                  | Chooses how the ring is drawn, not how big the control is    |
| `--app-bar-band`           | Optional gradient painted into the app bar's **existing** 1 px bottom border via `border-image` | Zero geometry cost. Only `vault-black` uses it               |

### 5.2 What a style may never do

Set or influence: any `margin`, `padding`, `gap`, `width`, `height`, `min-*`, `max-*`,
`font-size`, `font-family`, `font-weight`, `letter-spacing`, `line-height`, `border-width`,
`grid-template-*`, `flex-*`, or the display-profile variables.

One typographic exception is permitted because it cannot change advance width in either direction:
`font-variant-numeric: tabular-nums` on numeric readouts. It is applied app-wide, not per style.

Note for reviewers: `letter-spacing` and a monospace face were both considered as a "feel" axis and
rejected. Both change text width, so both can change wrapping, so both would break §10.

### 5.3 The focus ring is a first-class token

On the Callback 8020 the touchscreen is off by default and the focus ring **is** the pointer. In
the first draft of these palettes the ring was inherited from `--border`, which measured between
1.30:1 and 1.66:1 against its own surface in six of the seven styles — invisible at arm's length.

Therefore:

- `--ring` is declared separately in every palette and is never allowed to equal `--border`.
- It is gated at **≥ 3:1 against both the surface behind it and the fill of the control it wraps**
  (WCAG 2.1 SC 1.4.11 and 2.4.11).
- `--ring-style` selects the treatment, because one treatment does not suit every style: a 2 px
  line is right on `full-sun` and wrong on `amber-glow`, where a glow reads better on near-black,
  and `vault-black` inverts the control instead, which reads better than a line on a true-black
  ground.
- `src/index.css:530` currently hard-codes `border-radius: 0.375rem` inside
  `[data-key-selected="true"]`. That must become `var(--radius-sm)` or the ring will not match its
  control under a style that changes radius.

---

## 6. The seven styles

### 6.1 How twenty became seven

Twenty candidates were authored as full token sets, rendered as a real app screen at the Callback
8020 viewport (320 x 427 CSS px), and inspected side by side before the cut was made.

Selection criteria, in order: passes the contrast gates; is distinguishable from the other six at
a glance; covers a span from very neutral to fairly loud; has a defensible link to either the
hardware console or the 8020; works at 320 px with a keypad focus ring.

**Cut, and why:**

| Candidate            | Why it was cut                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProtoPaper           | Its light mode is the 8020 launcher exactly, which is a real virtue — but its dark mode is a generic neutral and the pair collides with both `modem-grey` and `full-sun`. `full-sun` keeps the discipline and adds a reason to exist.                                                                                                                                                                                       |
| SX Silver            | Handsome, but its dark rendition is indistinguishable from `modem-grey` dark. Hue distinction only in light mode is not enough to earn a row in the picker.                                                                                                                                                                                                                                                             |
| Nightshift           | A good idea (warm charcoal for night reading) beaten by `amber-glow`, which occupies the same warm-dark territory with far better provenance.                                                                                                                                                                                                                                                                           |
| Blue Sky             | The nicest light-only candidate of the twenty. Cut because its dark mode duplicates Deep Blue and its light mode duplicates `modem-grey`'s role at higher saturation.                                                                                                                                                                                                                                                   |
| Phosphor (green CRT) | Green-on-black is the most tired retro trope available, and it is fatiguing over a long file list. Also depended on the texture layer, which was cut.                                                                                                                                                                                                                                                                   |
| Amber CRT            | Folded into `amber-glow`, which has the same warmth with a real source: the 8020's rear VFD.                                                                                                                                                                                                                                                                                                                            |
| Deep Blue            | A saturated indigo and periwinkle pair. Its light rendition is washy periwinkle and its dark duplicates Blue Sky. `modem-grey`'s indigo primary already carries this hue.                                                                                                                                                                                                                                               |
| Workshop             | The only candidate that varied the _rendering idiom_ rather than hue — bevelled panels, period desktop chrome. Genuinely tempting, and it is legal under D2. Cut on three counts: the worst measured contrast of all twenty (2.26:1 primary on surface); 1 px bevel highlights smear at DPR 1.5; and no provenance in either device. Its idiom is preserved as a future `edge: bevel` value that any palette can adopt. |
| Spectrum             | Claimed the Commodore rainbow and then shipped a purple primary — the rainbow never appeared on screen. The idea survives as `--app-bar-band` (§5.1), which any future style can use properly.                                                                                                                                                                                                                          |
| Newsprint            | The best-looking light candidate after `breadbin-beige`. Cut because black-ink-on-paper collides with `full-sun`, and warm paper collides with `breadbin-beige`.                                                                                                                                                                                                                                                          |
| Cassette             | Warm tan and chocolate; sits between `breadbin-beige` and `amber-glow` without displacing either.                                                                                                                                                                                                                                                                                                                       |
| Arcade               | Not cut — **absorbed**. Its magenta-and-cyan-on-near-black became `neon-pop`'s dark rendition, which gave the set the games-cabinet reading it was missing without spending a row on it.                                                                                                                                                                                                                             |
| Playground           | Mint and coral. Fresh, but overlaps `petrol-teal` in hue and `neon-pop` in intent, and its coral primary measured 2.82:1.                                                                                                                                                                                                                                                                                            |
| Vault (first draft)  | Kept but **re-pitched**. As first drawn it was a darker `modem-grey`: near-black with a periwinkle primary. It now has a signature of its own: a two-tone band above the list, a hairline panel on true black, and a white selection row.                                                                                                                                                                               |

### 6.2 The set

Each was rendered at the true 8020 viewport across two screens — page chrome with cards, buttons,
focus state, badges, switch and progress; and an overlay screen with dialog, bottom sheet, scrim and
dimmed background — and every palette below passes every gate in §9. Full values are in Appendix A;
the hex in the tables and the HSL in the appendix are the same colours.

#### Modem Grey `modem-grey`

Neutral default. Today's palette, cleaned up.

| Token                      | Light                   | Dark                    |
| -------------------------- | ----------------------- | ----------------------- |
| `--background`             | `#F5F6F9`               | `#11131C`               |
| `--card`                   | `#FFFFFF`               | `#1A1D28`               |
| `--muted-surface`          | `#ECEEF3`               | `#232735`               |
| `--foreground`             | `#1A1F2B`               | `#E7EAF2`               |
| `--muted-foreground`       | `#5B6474`               | `#98A0B2`               |
| `--primary`                | `#4A5FA8`               | `#8394DB`               |
| `--primary-foreground`     | `#FFFFFF`               | `#0C0E16`               |
| `--accent`                 | `#3F5296`               | `#93A2E4`               |
| `--border`                 | `#C9CFDB`               | `#3D4557`               |
| `--ring`                   | `#2B3E7E`               | `#A9B7F0`               |
| `--success`                | `#1E7A4D`               | `#54C98A`               |
| `--warning`                | `#96620A`               | `#DDAF4C`               |
| `--destructive`            | `#BE2F26`               | `#EE7B70`               |
| `--destructive-foreground` | `#FFFFFF`               | `#1A0E0C`               |
| radius / edge / ring       | 12px · hairline · solid | 12px · hairline · solid |

#### Breadbin Beige `breadbin-beige`

Warm daylight. The BASIC Beige body, blue key.

| Token                      | Light                  | Dark                   |
| -------------------------- | ---------------------- | ---------------------- |
| `--background`             | `#EFE7D6`              | `#1A1712`              |
| `--card`                   | `#F8F3E7`              | `#26221A`              |
| `--muted-surface`          | `#E4DAC4`              | `#332D22`              |
| `--foreground`             | `#2E2618`              | `#EFE4CE`              |
| `--muted-foreground`       | `#6B5E47`              | `#B0A184`              |
| `--primary`                | `#2F4FBF`              | `#8AA0F0`              |
| `--primary-foreground`     | `#FFFFFF`              | `#12100A`              |
| `--accent`                 | `#B5561E`              | `#E08A4C`              |
| `--border`                 | `#BCAB88`              | `#544936`              |
| `--ring`                   | `#1D3690`              | `#A8BAFF`              |
| `--success`                | `#2F6B3A`              | `#7BC98A`              |
| `--warning`                | `#8A5A00`              | `#E0B44C`              |
| `--destructive`            | `#A62D24`              | `#E58A80`              |
| `--destructive-foreground` | `#FFFFFF`              | `#1A0E0C`              |
| radius / edge / ring       | 6px · hairline · solid | 6px · hairline · solid |

#### Petrol Teal `petrol-teal`

The translucent teal shell. Coral key in both modes.

| Token                      | Light                   | Dark                    |
| -------------------------- | ----------------------- | ----------------------- |
| `--background`             | `#DCEDEC`               | `#08201F`               |
| `--card`                   | `#F2FAF9`               | `#0F2E2C`               |
| `--muted-surface`          | `#C9E2E0`               | `#163C39`               |
| `--foreground`             | `#0E2A29`               | `#DCF1EF`               |
| `--muted-foreground`       | `#48706E`               | `#88AFAC`               |
| `--primary`                | `#0E6E6B`               | `#3FBFB6`               |
| `--primary-foreground`     | `#FFFFFF`               | `#041615`               |
| `--accent`                 | `#C6461F`               | `#FF8A5C`               |
| `--border`                 | `#9CC3C0`               | `#2C625D`               |
| `--ring`                   | `#04504E`               | `#6FE6DC`               |
| `--success`                | `#1B6F3E`               | `#57CE8C`               |
| `--warning`                | `#8C5B00`               | `#E3B255`               |
| `--destructive`            | `#B32F26`               | `#F58274`               |
| `--destructive-foreground` | `#FFFFFF`               | `#170B08`               |
| radius / edge / ring       | 10px · hairline · solid | 10px · hairline · solid |

#### Neon Pop `neon-pop`

Translucent covers by day, arcade cabinet by night.

| Token                      | Light                | Dark                |
| -------------------------- | -------------------- | ------------------- |
| `--background`             | `#F4F6FA`            | `#08060F`           |
| `--card`                   | `#FFFFFF`            | `#130D22`           |
| `--muted-surface`          | `#E9EDF6`            | `#1D1433`           |
| `--foreground`             | `#141A2B`            | `#F2E9FF`           |
| `--muted-foreground`       | `#5A6480`            | `#A99BC6`           |
| `--primary`                | `#C10C68`            | `#FF2D95`           |
| `--primary-foreground`     | `#FFFFFF`            | `#0B0410`           |
| `--accent`                 | `#00788F`            | `#22E8E0`           |
| `--border`                 | `#C2CBDD`            | `#42305F`           |
| `--ring`                   | `#8F0049`            | `#FF7ABF`           |
| `--success`                | `#0E7A5F`            | `#4FE8A0`           |
| `--warning`                | `#8F5400`            | `#FFD84B`           |
| `--destructive`            | `#C0212B`            | `#FF6B6B`           |
| `--destructive-foreground` | `#FFFFFF`            | `#1A0808`           |
| radius / edge / ring       | 14px · gloss · solid | 14px · gloss · glow |

#### Amber Glow `amber-glow` — dark only

The rear VFD: warm near-white body, amber reserved for what a tube would light.

| Token                      | Dark                  |
| -------------------------- | --------------------- |
| `--background`             | `#0A0806`             |
| `--card`                   | `#141009`             |
| `--muted-surface`          | `#1E1810`             |
| `--foreground`             | `#F2E6D4`             |
| `--muted-foreground`       | `#A8987F`             |
| `--primary`                | `#FF9E2C`             |
| `--primary-foreground`     | `#140C03`             |
| `--accent`                 | `#FFD23F`             |
| `--border`                 | `#4A3618`             |
| `--ring`                   | `#FFB347`             |
| `--success`                | `#8FD46B`             |
| `--warning`                | `#FFD23F`             |
| `--destructive`            | `#FF6B5B`             |
| `--destructive-foreground` | `#190804`             |
| radius / edge / ring       | 4px · hairline · glow |

#### Vault Black `vault-black` — dark only

Hardware-console dark: split header band, hairline panel on true black, white selection.

| Token                      | Dark                                                    |
| -------------------------- | ------------------------------------------------------- |
| `--background`             | `#000000`                                               |
| `--card`                   | `#0B0B0E`                                               |
| `--muted-surface`          | `#17171D`                                               |
| `--foreground`             | `#C9C9D2`                                               |
| `--muted-foreground`       | `#8A8A99`                                               |
| `--primary`                | `#FFFFFF`                                               |
| `--primary-foreground`     | `#0B0B12`                                               |
| `--accent`                 | `#6C7EB7`                                               |
| `--border`                 | `#4A4A57`                                               |
| `--ring`                   | `#FFFFFF`                                               |
| `--success`                | `#5FBF7E`                                               |
| `--warning`                | `#D9A93F`                                               |
| `--destructive`            | `#D4655A`                                               |
| `--destructive-foreground` | `#190B09`                                               |
| radius / edge / ring       | 4px · hairline · inverse                                |
| app-bar band               | `linear-gradient(90deg,#4B4FA8 0 46%,#9A3A2E 46% 100%)` |

#### Full Sun `full-sun`

Maximum contrast, keypad first. Heavy edges, no fill games.

| Token                      | Light               | Dark                |
| -------------------------- | ------------------- | ------------------- |
| `--background`             | `#FFFFFF`           | `#000000`           |
| `--card`                   | `#FFFFFF`           | `#000000`           |
| `--muted-surface`          | `#EFEFEF`           | `#141414`           |
| `--foreground`             | `#000000`           | `#FFFFFF`           |
| `--muted-foreground`       | `#3A3A3A`           | `#C8C8C8`           |
| `--primary`                | `#000000`           | `#FFFFFF`           |
| `--primary-foreground`     | `#FFFFFF`           | `#000000`           |
| `--accent`                 | `#0033CC`           | `#FFE600`           |
| `--border`                 | `#000000`           | `#FFFFFF`           |
| `--ring`                   | `#0033CC`           | `#FFE600`           |
| `--success`                | `#005E20`           | `#5FE08A`           |
| `--warning`                | `#7A4E00`           | `#FFE600`           |
| `--destructive`            | `#A50000`           | `#FF6B6B`           |
| `--destructive-foreground` | `#FFFFFF`           | `#1A0808`           |
| radius / edge / ring       | 0px · heavy · solid | 0px · heavy · solid |

### 6.3 What each style is for

| Style              | Serves                                                                                                                                     | Provenance                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Modem Grey**     | The default. Everyone. Deliberately unremarkable.                                                                                          | Today's app, cleaned up.                                                            |
| **Breadbin Beige** | Daylight reading; the warm end; older users.                                                                                               | The 8020's BASIC Beige body with its royal-blue `C=` key.                           |
| **Petrol Teal**    | The cool end. The best-executed light/dark pair of the twenty.                                                                             | The translucent petrol shell colourway.                                             |
| **Neon Pop**    | Younger users, and the only style that reads as fun. Translucent covers by day, arcade cabinet by night.                                   | Y2K translucent plastics; the dark mode is a games cabinet. |
| **Amber Glow**     | Night use; the warm dark. Amber is spent only on the primary, the selection and numeric readouts — the things a tube would actually light. | The 8020's rear VFD screen, "inspired by classic Commodore calculators of the 70s". |
| **Vault Black**    | The machine itself. Split indigo/rust band under the app bar, hairline panel on true black, grey rows with a **white** selection.          | Console hardware, seen in the dark.                                                 |
| **Full Sun**         | Maximum contrast and the keypad-first case. Heavy edges, no fill games, a ring you cannot miss.                                            | The accessibility entry, and the reference the other six are measured against.      |

### 6.4 Naming

Names avoid Commodore's own marks and, where a register check found a live third-party mark,
avoid that too. "Breadbin" is the long-standing enthusiast nickname for the original C64 case
shape; it has no registration anywhere, and third-party retailers already sell cases under
"Breadbin Beige" and "Breadbin Grey".

Device scheme names (`Commodore Blue`, `Ultimate Black`, `C128 Style`) appear only in the help text
for "Match my device", where they are nominative use — naming the device's own setting so the user
can find it. They are not used as style names.

**Register position.** A search of EUIPO and USPTO (via TMview and TSDR) on 2026-08-27 found:

- `COMMODORE` is live in the US (Reg 6,565,032, Commodore Corporation BV, class 9). The EU word
  mark and the `C=` logo are both **under pending cancellation** on non-use grounds.
- The "47 original trademarks" Commodore announced in July 2025 have **never been published as a
  list**. Several of the obvious candidates are not theirs and not live: `VIC-20` and `CBM` are
  cancelled US registrations, `AMIGA` belongs to Amiga Corporation, and `C64` as an EU word mark
  belongs to Koenig & Bauer AG. No Commodore-owned record was found for `PET`, `SID`, `GEOS`,
  `1541` or `Datasette`.
- `C64 ULTIMATE` **is** live: US serial 99454621, Commodore Corporation BV, class 9, status ACTIVE,
  Notice of Allowance issued 2026-06-02. Independently confirmed at TSDR.
- `Snapback` is a real filing, not just a ™ on a web page: EUTM 019381101, Commodore Corporation BV,
  filed 2026-06-16, class 9 for smartphone cases and covers. No style is named after it.

Two names changed as a result:

- `Candy Shell` became **`Neon Pop`**. `CANDYSHELL` is a live third-party mark for phone cases, and
  "shell" additionally echoed Commodore's own case line.
- `Signal` became **`Full Sun`**. A bare common noun is the weakest possible choice here: EUIPO and
  USPTO together hold roughly a thousand `SIGNAL` records concentrated in classes 9 and 38, and the
  dominant association is a messaging app. `Full Sun` is a two-word phrase, so far less crowded, and
  it names the condition the style exists for: reading the screen in bright light. It also puts the
  style in the same naming register as `Amber Glow`, so the set's two light-quality names read as a
  pair.

**Still unchecked**, and to be cleared before release: national registers outside EUIPO and USPTO
(DE, GB, IT, JP and others were not swept), and the contents of the 47.

An automated attempt to sweep DE (DPMA), GB (UKIPO), IT (UIBM) and JP (JPO) on 2026-08-27 could not
complete: DPMA's public search is a JS single-page app that returns no results without executing
client-side JavaScript, UKIPO's search returns HTTP 403 to non-browser requests, TMview's API
endpoint reset the connection, and WIPO's Global Brand Database is gated behind a client-side
CAPTCHA. A general web search for each of the 7 exact names alongside "trademark" surfaced no live
identical mark in any jurisdiction, but that has no legal weight — it only means nothing is
prominent enough to be indexed under the exact phrase. This item needs a human with direct or paid
register access (or a browser-driving tool that can clear the CAPTCHA/JS gates), not automation, and
remains open before release.

The exposure is contained by design: a name is one YAML field. Style **ids** are the persisted
setting value and are stable identifiers — they must not be renamed once shipped, so a naming
change costs a string, not a migration.

---

## 7. Runtime model

### 7.1 Resolution

```
stored style id  +  stored theme (light | dark | system)  +  OS colour scheme
        |                        |                                |
        +------------------------+--------------------------------+
                                 v
                     resolveAppearance(): { styleId, mode }
                                 v
     <html data-app-style="vault-black" class="dark">   ->  generated CSS layer wins
```

Rules:

1. If the style declares both modes, `mode` resolves exactly as `useTheme` resolves today.
2. If the style declares one mode, `mode` is clamped to it regardless of the theme setting. The
   Theme row in Settings is disabled and states why.
3. If the stored style id is unknown — downgrade, or a style removed from the YAML — fall back to
   the compiled `default_style` and clear the stored value.
4. The style is applied as a `data-app-style` attribute on `<html>`, alongside the existing
   `light` / `dark` class. The generated CSS layer is `html[data-app-style="x"]` and
   `html[data-app-style="x"].dark`, so it beats the base `:root` / `.dark` blocks by specificity
   without `!important`.

### 7.2 Persistence

A new localStorage key beside `c64u_theme`, following the precedent of `c64u_display_profile_override`
and the text-scale key. `useTheme` is not widened; a sibling hook owns the style axis, which leaves
all eighteen existing theme tests untouched.

`Match my device` is stored as a distinct sentinel value, not as the style it currently resolves to,
so that the choice survives a device change.

### 7.3 Surfaces in scope

**Must follow the style:**

- Every page, card, dialog, sheet, popover, toast, tab bar and app bar.
- Live View immersive controls and the Game Mode overlay, through the `--media-*` tokens.
- The Android status and navigation bar icon polarity. `syncNativeSystemBarAppearance`
  (`src/lib/native/safeArea.ts:122`) currently takes `resolvedTheme === "light"`. It must instead
  derive polarity from the **luminance of the resolved `--background`**, or a dark-ish style under
  the light theme gets dark icons on a dark bar.
- The web `<meta name="theme-color">`, rewritten at runtime when the style changes. The build-time
  value in `index.html` stays as the brand colour for the pre-hydration flash.

**Must not follow the style (domain data):**

- `src/lib/config/ledColors.ts` and `src/lib/lighting/constants.ts` — values transmitted to the
  Ultimate's LED strip. Recolouring a swatch that promises "this is what your LED will look like"
  makes it lie.
- The device-preview colours in `LightingStudioDialog` — the breadbin's beige, the keyboard's
  black, the LED fill. These are physical materials.
- VIC palette swatches (`PaletteSwatchStrip`, `AvSyncPanel`) and the heat-map ramp.

**Stays brand, not style:** the native splash, the launcher icon, the manifest colours, and the
pre-hydration `body` background in `index.html`. Also `StartupLaunchSequence.tsx:36`, which paints
the launch backdrop from `variant.theme.backgroundColor`: it runs before storage is read, so it
cannot resolve a style, and is decided here to stay brand-locked rather than gain a loading-state
special case.

### 7.4 Match my device

| Device `Color Scheme`                                         | App style                                    |
| ------------------------------------------------------------- | -------------------------------------------- |
| `Ultimate Black`                                              | `vault-black`                                |
| `Commodore Blue`, `Commodore 1`, `Commodore 2`, `Commodore 3` | `modem-grey`                                 |
| `C128 Style`                                                  | `petrol-teal`                                |
| unknown / unreachable                                         | the compiled default, and the picker says so |

The three `Commodore N` aliases map together because the firmware renders them identically — see
`research.md` §1. The mapping table lives in the YAML, not in code, so a future firmware that makes
them distinct is a data change.

---

## 8. Source format and compiler

`styles/appearance-styles.yaml` → `scripts/compile-styles.mjs` → two generated artefacts:

1. `src/generated/appStyles.ts` — the style list for the picker and the resolution logic.
2. `src/generated/appStyles.css` — one `html[data-app-style="…"]` block per palette, imported by
   `src/index.css`.

The compiler follows the contract already established by `scripts/compile-palettes.mjs` and
`scripts/generate-variant.mjs`, exactly:

- Render deterministically to a string; Prettier-format with the repo config **before** comparing,
  so generated output can never fight `format:check:ts`.
- `--check` does a whole-file string compare, prints
  `generated file is out of date: <repo-relative path>\n  run: <exact command>` and exits 1. It
  never writes.
- Success prints one line: `styles check: 12 palette(s) up to date`.
- Build mode short-circuits an unchanged write so mtimes stay stable.

**Compile-time invariants** (cheaper than any test):

1. Every style declares every token in §5.1. A missing token is a hard error, not a `var()` fallback. Conversely, a token the stylesheet declares but nothing consumes must be **deleted, not
   declared by every palette** — otherwise dead tokens propagate into all twelve. Sweep for orphans
   before authoring the YAML.
2. `modes` is `[light, dark]` or a single mode; a declared mode must have a colour block and vice versa.
3. Every palette passes every contrast gate in §9.
4. `--ring` is not equal to `--border` in any palette.
5. `default_style` exists.
6. Style ids are kebab-case and stable; the compiler fails if an id present in the previous
   generated output has disappeared without an entry in a `retired:` list.

A complete draft of the file, with every value, is in Appendix A.

---

## 9. Accessibility gates

Enforced twice: at compile time by `compile-styles.mjs`, and in a vitest-node test over the
generated table so a hand-edit of the generated file cannot slip through. All twelve palettes
currently pass all of these.

| Pair                                            | Minimum | Basis                                                 |
| ----------------------------------------------- | ------- | ----------------------------------------------------- |
| `foreground` / `card`                           | 4.5:1   | WCAG 2.1 AA body text                                 |
| `foreground` / `background`                     | 4.5:1   | AA body text                                          |
| `foreground` / `muted-surface`                  | 4.5:1   | `muted-surface` also compiles to `--secondary`         |
| `muted-foreground` / `card`                     | 4.5:1   | Secondary text is still read, not decoration          |
| `muted-foreground` / `muted-surface`            | 4.5:1   | Chips and badges put that text on the recessed surface |
| `primary-foreground` / `primary`                | 4.5:1   | Label on the main action                              |
| `destructive-foreground` / `destructive`        | 4.5:1   | Caught white-on-light-red at 2.5:1 in the first draft |
| `accent-foreground` / `accent`                   | 4.5:1   | Caught near-white on a bright accent at 1.2:1 in review |
| `primary` / `card`                              | 3:1     | AA non-text contrast for the action's own fill        |
| `success` / `warning` / `destructive` vs `card` | 4.5:1   | These carry text, not just colour                     |
| **`ring` / `card`**                             | **3:1** | SC 1.4.11. The ring is the pointer on a keypad device |
| **`ring` / `muted-surface`**                    | **3:1** | The ring must also stand off the control it wraps     |
| `border` / `card`                               | 1.5:1   | A hairline may be quiet, but not absent               |

State is never carried by colour alone; the existing icon and text pairings stay.

---

## 10. The layout-invariance guarantee

**Claim: switching style changes zero geometry.**

This is the load-bearing assumption that keeps every existing layout, ergonomics, overflow,
clipping, mid-word-break and target-size test valid on the default style alone. If it is not
provable, the whole test surface has to be re-run twelve times.

It is proved by one Playwright spec, built on the `page.evaluate` body of
`playwright/layoutMetadata.ts:50-73`, which already records the two confounders that would
otherwise produce a false pass: the viewport, and
`document.documentElement.dataset.displayProfile`.

```
goto(route) -> settle -> baseline = bounds of every [data-testid]
for each of the other 11 palettes:
    set data-app-style / class directly, no reload
    -> snapshot -> assert deepEqual(snapshot, baseline)
```

Requirements:

- **Exact equality.** `getBoundingClientRect` returns fractional values; a tolerance would hide
  exactly the sub-pixel radius and edge drift the test exists to exclude. Radius, shadow and
  colour are all genuinely zero-layout, so exact equality is achievable — provided D10 holds.
- Hidden subtrees are filtered using the existing `isHiddenSurface` predicate
  (`playwright/smallScreenLayoutAudit.ts:119-127`), so the swipe runway's parked adjacent pages do
  not add nondeterministic rows.
- Run on two routes at two profiles — `compact` 320x426 and `medium` 393x727. Because it never
  reloads, all twelve palettes cost about a second each.

---

## 11. The style gallery

A developer-only route at `/dev/styles`, gated by the existing developer-only feature-flag
mechanism, rendering the **real** components — not copies — grouped into sections:

`app-bar` · `cards` · `buttons` (all variants, all sizes, disabled) · `focus-and-selection`
(focus ring, keypad selection, tap flash, scope outline) · `inputs` (text, select, checkbox,
radio, switch, slider, OTP) · `feedback` (badge, progress, toast, alert, helper text, empty state,
error state) · `overlays` (dialog, alert dialog, bottom sheet, popover, tooltip, interstitial
scrim) · `navigation` (tabs, tab bar, breadcrumb, pagination) · `data` (table, list rows, virtual
list row, chart, diagnostics timeline)

It takes `?style=` and `?mode=` so a screenshot run can address one palette directly. One
Playwright spec walks 7 styles x 2 modes x N sections and writes
`docs/img/app/styles/<style-id>-<mode>-<section>.png`.

Two mechanical requirements that will otherwise fail CI:

1. `scripts/validate-playwright-evidence.mjs` demands exactly one `video.webm` per evidence folder
   unless it recognises the folder as screenshot evidence, which it detects from the test-id prefix
   `screenshots--` or `meta.videoExpected === false`. A new spec must set one of them.
2. Section slugs must be registered through `playwright/screenshotCatalog.ts` so ordering is stable.

---

## 12. Risks

| Risk                                                                                                                                                                         | Mitigation                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The zero-geometry claim fails, and a tolerance is added to make the test pass — destroying its value.                                                                        | D10 removes the only real cause. If the test goes red, the correct response is to find the token that changed a box, not to loosen the assertion. |
| The screenshot corpus multiplies. 273 tracked PNGs x 12 would be 3,276 files and about 580 MB, and the existing pixel-dedupe would never fire because every pixel changes.   | The corpus stays on the default style. Style coverage is the fixed gallery set in §11.                                                            |
| A style ships with an invisible focus ring, and no test notices, because every keypad spec asserts on `data-key-selected` and never on appearance.                           | §9's ring gates, enforced at compile time.                                                                                                        |
| `npm run lint` — which is where `palettes:check` and `variant:check` live — is not run by any GitHub workflow. A `styles:check` added only to `lint` would never fail in CI. | Add a drift job modelled on the existing `Notices                                                                                                 | Generation + drift`job in`android.yaml`. |
| Toasts ignore the style. `src/components/ui/sonner.tsx` reads `useTheme` from `next-themes`, whose provider is never mounted, so its theme is permanently `"system"`.        | Pre-existing bug; fixing it is a prerequisite, not a nicety.                                                                                      |
| A style makes the Android system bar unreadable.                                                                                                                             | §7.3: derive icon polarity from resolved background luminance.                                                                                    |
| 217 chrome sites do not follow the tokens today.                                                                                                                             | Sequenced in `plan.md`; four mechanical refactors clear 172 of them.                                                                              |

---

## Appendix A — draft `styles/appearance-styles.yaml`

Every value below passes every gate in §9. Copy this to `styles/appearance-styles.yaml` to start
phase 3. HSL triples are used because they drop straight into the existing custom properties in
`src/index.css`; the hex comment on each line is the same colour.

```yaml
# Appearance styles. Compiled by scripts/compile-styles.mjs into src/generated/appStyles.ts.
# Colours are HSL triples so they drop straight into the CSS custom properties in src/index.css.
# DRAFT — every value below passes the contrast gates in spec.md section 9.

schema_version: 1

default_style: modem-grey

styles:
  modem-grey:
    name: "Modem Grey"
    description: "Neutral default. Today's palette, cleaned up."
    modes: [light, dark]
    light:
      radius: "12px"
      edge: hairline
      ring_style: solid
      colors:
        background: "225 25% 96.9%"   # #F5F6F9
        card: "0 0% 100%"   # #FFFFFF
        muted-surface: "222.9 22.6% 93.9%"   # #ECEEF3
        foreground: "222.4 24.6% 13.5%"   # #1A1F2B
        muted-foreground: "218.4 12.1% 40.6%"   # #5B6474
        primary: "226.6 38.8% 47.5%"   # #4A5FA8
        primary-foreground: "0 0% 100%"   # #FFFFFF
        accent: "226.9 40.8% 41.8%"   # #3F5296
        border: "220 20% 82.4%"   # #C9CFDB
        ring: "226.3 49.1% 33.1%"   # #2B3E7E
        success: "150.7 60.5% 29.8%"   # #1E7A4D
        warning: "37.7 87.5% 31.4%"   # #96620A
        destructive: "3.6 66.7% 44.7%"   # #BE2F26
        destructive-foreground: "0 0% 100%"   # #FFFFFF
    dark:
      radius: "12px"
      edge: hairline
      ring_style: solid
      colors:
        background: "229.1 24.4% 8.8%"   # #11131C
        card: "227.1 21.2% 12.9%"   # #1A1D28
        muted-surface: "226.7 20.5% 17.3%"   # #232735
        foreground: "223.6 29.7% 92.7%"   # #E7EAF2
        muted-foreground: "221.5 14.4% 64.7%"   # #98A0B2
        primary: "228.4 55% 68.6%"   # #8394DB
        primary-foreground: "228 29.4% 6.7%"   # #0C0E16
        accent: "228.9 60% 73.5%"   # #93A2E4
        border: "221.5 17.6% 29%"   # #3D4557
        ring: "228.2 70.3% 80.2%"   # #A9B7F0
        success: "147.7 52% 55.9%"   # #54C98A
        warning: "41 68.1% 58.2%"   # #DDAF4C
        destructive: "5.2 78.8% 68.6%"   # #EE7B70
        destructive-foreground: "8.6 36.8% 7.5%"   # #1A0E0C
  breadbin-beige:
    name: "Breadbin Beige"
    description: "Warm daylight. The BASIC Beige body, blue key."
    modes: [light, dark]
    light:
      radius: "6px"
      edge: hairline
      ring_style: solid
      colors:
        background: "40.8 43.9% 88.8%"   # #EFE7D6
        card: "42.4 54.8% 93.9%"   # #F8F3E7
        muted-surface: "41.2 37.2% 83.1%"   # #E4DAC4
        foreground: "38.2 31.4% 13.7%"   # #2E2618
        muted-foreground: "38.3 20.2% 34.9%"   # #6B5E47
        primary: "226.7 60.5% 46.7%"   # #2F4FBF
        primary-foreground: "0 0% 100%"   # #FFFFFF
        accent: "22.3 71.6% 41.4%"   # #B5561E
        border: "40.4 28% 63.5%"   # #BCAB88
        ring: "227 66.5% 33.9%"   # #1D3690
        success: "131 39% 30.2%"   # #2F6B3A
        warning: "39.1 100% 27.1%"   # #8A5A00
        destructive: "4.2 64.4% 39.6%"   # #A62D24
        destructive-foreground: "0 0% 100%"   # #FFFFFF
    dark:
      radius: "6px"
      edge: hairline
      ring_style: solid
      colors:
        background: "37.5 18.2% 8.6%"   # #1A1712
        card: "40 18.8% 12.5%"   # #26221A
        muted-surface: "38.8 20% 16.7%"   # #332D22
        foreground: "40 50.8% 87.3%"   # #EFE4CE
        muted-foreground: "39.5 21.8% 60.4%"   # #B0A184
        primary: "227.1 77.3% 74.1%"   # #8AA0F0
        primary-foreground: "45 28.6% 5.5%"   # #12100A
        accent: "25.1 70.5% 58.8%"   # #E08A4C
        border: "38 21.7% 27.1%"   # #544936
        ring: "227.6 100% 82.9%"   # #A8BAFF
        success: "131.5 41.9% 63.5%"   # #7BC98A
        warning: "42.2 70.5% 58.8%"   # #E0B44C
        destructive: "5.9 66% 70%"   # #E58A80
        destructive-foreground: "8.6 36.8% 7.5%"   # #1A0E0C
  petrol-teal:
    name: "Petrol Teal"
    description: "The translucent teal shell. Coral key in both modes."
    modes: [light, dark]
    light:
      radius: "10px"
      edge: hairline
      ring_style: solid
      colors:
        background: "176.5 32.1% 89.6%"   # #DCEDEC
        card: "172.5 44.4% 96.5%"   # #F2FAF9
        muted-surface: "175.2 30.1% 83.7%"   # #C9E2E0
        foreground: "177.9 50% 11%"   # #0E2A29
        muted-foreground: "177 21.7% 36.1%"   # #48706E
        primary: "178.1 77.4% 24.3%"   # #0E6E6B
        primary-foreground: "0 0% 100%"   # #FFFFFF
        accent: "14 72.9% 44.9%"   # #C6461F
        border: "175.4 24.5% 68.8%"   # #9CC3C0
        ring: "178.4 90.5% 16.5%"   # #04504E
        success: "145 60.9% 27.1%"   # #1B6F3E
        warning: "39 100% 27.5%"   # #8C5B00
        destructive: "3.8 65% 42.5%"   # #B32F26
        destructive-foreground: "0 0% 100%"   # #FFFFFF
    dark:
      radius: "10px"
      edge: hairline
      ring_style: solid
      colors:
        background: "177.5 60% 7.8%"   # #08201F
        card: "176.1 50.8% 12%"   # #0F2E2C
        muted-surface: "175.3 46.3% 16.1%"   # #163C39
        foreground: "174.3 42.9% 90.4%"   # #DCF1EF
        muted-foreground: "175.4 19.6% 61%"   # #88AFAC
        primary: "175.8 50.4% 49.8%"   # #3FBFB6
        primary-foreground: "176.7 69.2% 5.1%"   # #041615
        accent: "16.9 100% 68%"   # #FF8A5C
        border: "174.4 38% 27.8%"   # #2C625D
        ring: "175 70.4% 66.9%"   # #6FE6DC
        success: "146.7 54.8% 57.5%"   # #57CE8C
        warning: "39.3 71.7% 61.2%"   # #E3B255
        destructive: "6.5 86.6% 70.8%"   # #F58274
        destructive-foreground: "12 48.4% 6.1%"   # #170B08
  neon-pop:
    name: "Neon Pop"
    description: "Translucent covers by day, arcade cabinet by night."
    modes: [light, dark]
    light:
      radius: "14px"
      edge: gloss
      ring_style: solid
      colors:
        background: "220 37.5% 96.9%"   # #F4F6FA
        card: "0 0% 100%"   # #FFFFFF
        muted-surface: "221.5 41.9% 93.9%"   # #E9EDF6
        foreground: "224.3 36.5% 12.4%"   # #141A2B
        muted-foreground: "224.2 17.4% 42.7%"   # #5A6480
        primary: "329.5 88.3% 40.2%"   # #C10C68
        primary-foreground: "0 0% 100%"   # #FFFFFF
        accent: "189.7 100% 28%"   # #00788F
        border: "220 28.4% 81.4%"   # #C2CBDD
        ring: "329.4 100% 28%"   # #8F0049
        success: "165 79.4% 26.7%"   # #0E7A5F
        warning: "35.2 100% 28%"   # #8F5400
        destructive: "356.2 70.7% 44.1%"   # #C0212B
        destructive-foreground: "0 0% 100%"   # #FFFFFF
    dark:
      radius: "14px"
      edge: gloss
      ring_style: glow
      colors:
        background: "253.3 42.9% 4.1%"   # #08060F
        card: "257.1 44.7% 9.2%"   # #130D22
        muted-surface: "257.4 43.7% 13.9%"   # #1D1433
        foreground: "264.5 100% 95.7%"   # #F2E9FF
        muted-foreground: "259.5 27.4% 69.2%"   # #A99BC6
        primary: "330.3 100% 58.8%"   # #FF2D95
        primary-foreground: "275 60% 3.9%"   # #0B0410
        accent: "177.6 81.1% 52.2%"   # #22E8E0
        border: "263 32.9% 28%"   # #42305F
        ring: "328.9 100% 73.9%"   # #FF7ABF
        success: "151.8 76.9% 61%"   # #4FE8A0
        warning: "47 100% 64.7%"   # #FFD84B
        destructive: "0 100% 71%"   # #FF6B6B
        destructive-foreground: "0 52.9% 6.7%"   # #1A0808
  amber-glow:
    name: "Amber Glow"
    description: "The rear VFD: warm near-white body, amber reserved for what a tube would light."
    modes: [dark]
    dark:
      radius: "4px"
      edge: hairline
      ring_style: glow
      colors:
        background: "30 25% 3.1%"   # #0A0806
        card: "38.2 37.9% 5.7%"   # #141009
        muted-surface: "34.3 30.4% 9%"   # #1E1810
        foreground: "36 53.6% 89%"   # #F2E6D4
        muted-foreground: "36.6 19.1% 57.8%"   # #A8987F
        primary: "32.4 100% 58.6%"   # #FF9E2C
        primary-foreground: "31.8 73.9% 4.5%"   # #140C03
        accent: "45.9 100% 62.4%"   # #FFD23F
        border: "36 51% 19.2%"   # #4A3618
        ring: "35.2 100% 63.9%"   # #FFB347
        success: "99.4 55% 62.5%"   # #8FD46B
        warning: "45.9 100% 62.4%"   # #FFD23F
        destructive: "5.9 100% 67.8%"   # #FF6B5B
        destructive-foreground: "11.4 72.4% 5.7%"   # #190804
  vault-black:
    name: "Vault Black"
    description: "Hardware-console dark: split header band, hairline panel on true black, white selection."
    modes: [dark]
    dark:
      radius: "4px"
      edge: hairline
      ring_style: inverse
      app_bar_band: "linear-gradient(90deg,#4B4FA8 0 46%,#9A3A2E 46% 100%)"
      colors:
        background: "0 0% 0%"   # #000000
        card: "240 12% 4.9%"   # #0B0B0E
        muted-surface: "240 11.5% 10.2%"   # #17171D
        foreground: "240 9.1% 80.6%"   # #C9C9D2
        muted-foreground: "240 6.8% 57.1%"   # #8A8A99
        primary: "0 0% 100%"   # #FFFFFF
        primary-foreground: "240 24.1% 5.7%"   # #0B0B12
        accent: "225.6 34.2% 57.1%"   # #6C7EB7
        border: "240 8.1% 31.6%"   # #4A4A57
        ring: "0 0% 100%"   # #FFFFFF
        success: "139.4 42.9% 56.1%"   # #5FBF7E
        warning: "41.3 67% 54.9%"   # #D9A93F
        destructive: "5.4 58.7% 59.2%"   # #D4655A
        destructive-foreground: "7.5 47.1% 6.7%"   # #190B09
  full-sun:
    name: "Full Sun"
    description: "Maximum contrast, keypad first. Heavy edges, no fill games."
    modes: [light, dark]
    light:
      radius: "0px"
      edge: heavy
      ring_style: solid
      colors:
        background: "0 0% 100%"   # #FFFFFF
        card: "0 0% 100%"   # #FFFFFF
        muted-surface: "0 0% 93.7%"   # #EFEFEF
        foreground: "0 0% 0%"   # #000000
        muted-foreground: "0 0% 22.7%"   # #3A3A3A
        primary: "0 0% 0%"   # #000000
        primary-foreground: "0 0% 100%"   # #FFFFFF
        accent: "225 100% 40%"   # #0033CC
        border: "0 0% 0%"   # #000000
        ring: "225 100% 40%"   # #0033CC
        success: "140.4 100% 18.4%"   # #005E20
        warning: "38.4 100% 23.9%"   # #7A4E00
        destructive: "0 100% 32.4%"   # #A50000
        destructive-foreground: "0 0% 100%"   # #FFFFFF
    dark:
      radius: "0px"
      edge: heavy
      ring_style: solid
      colors:
        background: "0 0% 0%"   # #000000
        card: "0 0% 0%"   # #000000
        muted-surface: "0 0% 7.8%"   # #141414
        foreground: "0 0% 100%"   # #FFFFFF
        muted-foreground: "0 0% 78.4%"   # #C8C8C8
        primary: "0 0% 100%"   # #FFFFFF
        primary-foreground: "0 0% 0%"   # #000000
        accent: "54.1 100% 50%"   # #FFE600
        border: "0 0% 100%"   # #FFFFFF
        ring: "54.1 100% 50%"   # #FFE600
        success: "140 67.5% 62.5%"   # #5FE08A
        warning: "54.1 100% 50%"   # #FFE600
        destructive: "0 100% 71%"   # #FF6B6B
        destructive-foreground: "0 52.9% 6.7%"   # #1A0808
```
