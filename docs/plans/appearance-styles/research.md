# Appearance Styles — Research Findings

Background gathered before the specification was written, so a reader can check its premises
without repeating the work.

## Required reading

- `docs/architecture.md`
- `docs/ux-guidelines.md`
- `docs/ux-interactions.md`
- `docs/internals/display-profiles.md`

---

## 1. The Ultimate's own colour schemes

The Ultimate's User Interface menu offers a `Color Scheme` setting. Those schemes were reviewed as
background before the app's palettes were authored, and **none of their values were used.**

The reason is measurable. The schemes are drawn as 8x8 character cells on a CRT-era display; two of
them place body text at roughly **1.9:1** and **2.2:1** against their own panel. WCAG 2.1 AA asks
for 4.5:1, and this app draws 13-14 px text on a 3.25 inch LCD held at arm's length. Nothing in
that set could be carried over without failing the gates in `spec.md` section 9.

The app's twelve palettes are therefore authored independently and gated on contrast first. Where a
style refers to the machine at all, it does so at the level of an idea a user would recognise —
a dark ground, a two-tone band above a list, a white selection row — not a colour value.

---

## 2. The Callback 8020's design language

Sources: Commodore's own product page and apps article, plus GSMArena, Tom's Hardware, New Atlas,
It's FOSS and Decoded Magazine coverage. See the sources list at the end.

### Industrial design

- Soft, rounded, pebble-shaped polycarbonate flip. Five colourways: **ProtoPET White, SX Silver,
  BASIC Beige, Starlight Edition, Founders Edition** (the last with a 24k gold-plated `C=` key).
- Product photography shows the body in warm cream, translucent smoke-clear and a translucent
  petrol teal, with a royal-blue `C=` key on the cream body.
- `Snapback` replaceable covers come in translucent candy red, pink, yellow, green and blue —
  the Y2K translucent-plastic look of the era's consumer electronics. Commodore's own copy calls
  them "gloriously techno-optimistic colors".
- The external 1.77 inch screen is a **VFD-style display: red-orange seven-segment glow on near
  black**, flanked by Commodore rainbow bars, "inspired by classic Commodore calculators of the
  70s".
- Five **Dome LEDs** across the hinge give ambient notification in the Commodore rainbow.

### On-screen design

The one clear render of the internal display (Commodore's own technical-overview graphic) shows a
UI that is the opposite of decorative: near-white ground, black text, a **centred single-column
list** with no icons, a thin status bar at the top, and a bottom bar carrying one label per
physical soft key. The launcher's own list type measures about 30 device px, i.e. **20 CSS px** —
noticeably larger than this app's 14 px floor.

The implication for us is not "copy the launcher". It is that a quiet, text-first, high-contrast
style is the one that will feel native on this device, and the app should ship one.

### Brand voice and terminology

Worth matching in help text and style names, because it is the register the device's own
owners will already have read:

> "Welcome to the Internot" · "Less Scroll. More Soul." · "Social Notworking" ·
> "Flip off Always-On" · "mindful friction" · "Close the phone. Open your life." ·
> "the not dumb dumbphone" · "Smart-Flip"

Product nouns Commodore uses: `Snapback`™ covers, `Hardback` case, `Backpack` holster,
`Commostore` app store, `Dome LED`, `SidAmp`, `Commodore Retro Camcorder`.

### Audience

Not one audience, two. The written copy targets people over forty ("names that will mean nothing
to anyone under forty and everything to the rest of us"), but the marketing photography is
students on a campus and the product is pitched as "school-friendly" for parents buying for
children. The launch imagery itself is Y2K — blue sky, clouds, soap bubbles, chrome, katakana.

A style set that serves only the nostalgic reading of the brand would miss half of who is holding
the phone. This is the direct justification for the set spanning very neutral to fairly loud.

### Relevance to this app

Commodore's own product page lists the app this repository builds as a bundled feature:

> "Callback can control your Commodore 64 Ultimate using our included C64U Remote App. Just
> connect both devices to the same Wi-Fi network and you're good to game. Change the onboard LED
> colours, load programs, jump into settings, and even engage Turbo Boost."

So the appearance work is not cosmetic polish on a side project. It is the appearance of a first
-party-listed app on a device with a strong and specific design language.

---

## 3. The codebase as it stands

- All app colour already flows through CSS custom properties declared in `src/index.css`
  (`:root` for light, `.dark` for dark), mapped into Tailwind by `tailwind.config.ts`. There is one
  stylesheet, not per-component styles.
- `src/hooks/useTheme.ts` stores `light` / `dark` / `system` under the localStorage key
  `c64u_theme` and toggles a class on `<html>`. `src/components/ThemeProvider.tsx` exposes it.
- There is already a working precedent for a text-defined, compiled, user-selectable set of
  palettes: `src/assets/palettes/*.vpl` are compiled by `scripts/compile-palettes.mjs` into
  `src/generated/vicPalettes.ts`, with `palettes:build` and `palettes:check` npm scripts and a
  picker in the UI. The style system should be built the same way, for the same reasons.
- `variants/variants.yaml` compiled by `scripts/generate-variant.mjs` into `src/generated/variant.ts`
  is the second precedent, and the closer of the two: a YAML source of truth, a compiler, a
  `--check` mode wired into `npm run lint`, and generated output that is never hand-edited.

---

## Sources

- [Callback 8020: The Future of Flip-Phones — Commodore](https://commodore.net/callback/)
- [Don't Call it Dumb: The Apps of the Commodore Callback — Commodore](https://commodore.net/dont-call-it-dumb-the-apps-of-the-commodore-callback/)
- [Commodore announces Callback 8020 — GSMArena](https://www.gsmarena.com/commodore_announces_callback_8020_the_mobile_phone_between_dumb_and_smart-news-73304.php)
- [Commodore announces Linux-based flip phone — Tom's Hardware](https://www.tomshardware.com/phones/commodore-announces-linux-based-flip-phone-with-no-social-media-no-browser-the-callback-8020-will-be-available-in-five-retro-colorways-starting-at-usd499-runs-99-percent-of-android-apps)
- [Commodore Callback 8020: retro flip phone revival — New Atlas](https://newatlas.com/consumer-tech/commodore-callback-8020-flip-phone/)
- [Commodore's New Flip Phone Skips Android for Sailfish OS — It's FOSS](https://itsfoss.com/news/commodore-callback-8020-launch/)
- [Commodore's Callback 8020 and the Art of Switching Off — Decoded Magazine](https://www.decodedmagazine.com/commodores-callback-8020-and-the-art-of-switching-off/)
