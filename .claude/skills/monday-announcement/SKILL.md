---
name: monday-announcement
description: >-
  Produce a copy/paste-ready release announcement for a Monday.com board, aimed at
  human QA and senior business stakeholders. Groups features and stability
  improvements by product domain, in plain language. Use when the user asks for a
  "Monday announcement", "board announcement", "release announcement", or "stakeholder
  update" for a C64 Commander / C64U Remote release. By default it covers changes since
  the PREVIOUS release tag (0.9.3 → since 0.9.2) unless the user names another baseline.
---

# Monday.com release announcement

Generate a short, factual, copy/paste-ready announcement for a Monday.com board.
Audience: **human QA and senior business stakeholders** — they care about *features*
and *stability improvements*, and *which domain* each improvement is in. They do NOT
care about internal engineering detail.

## Output contract

Give the announcement **directly in the chat, inside one fenced code block**, so the
user can copy/paste it into a new Monday announcement in one action. Do not publish it
anywhere, do not create files, do not @-mention anyone in real systems — it is just
text for the user to paste.

## Choosing the baseline (default = previous tag)

1. Determine the **release** being announced. Default to the most recent stable tag
   (`git tag --list --sort=-v:refname | grep -vi rc | head`), or the tag/version the
   user names.
2. Determine the **baseline**: by default the **immediately previous stable release
   tag** (e.g. release `0.9.3` → baseline `0.9.2`; `0.9.2` → `0.9.1`). Only use a
   different baseline if the user explicitly asks for one (e.g. "since 0.9.0").
3. State the range you used in one line at the top of your working notes (not
   necessarily in the announcement itself).

## Gathering the material (aggregate, don't dump)

Read enough to describe changes accurately, then aggregate up to domains:

- `git log --pretty="%s" <baseline>..<release>` — commit subjects. Strip internal tags
  (`HARDxx-nnn`, `BUG-nnn`, `Dn`, PR numbers, `Kilo`, branch names, reviewer codenames).
- `docs/plans/hardening/*/` — the plan/progress/review docs explain, in prose, what each
  hardening round actually changed and in which subsystem. Use these to map fixes to
  user-facing domains.
- `gh release view <release> --json body` and the bodies of the intervening releases —
  for already-written highlights (e.g. the Remote Input feature intro).

## Domains to group under (use only those with real changes)

Typical C64 Commander domains — pick the ones that actually changed and name them in
user terms:

- **Remote Input** — using the phone as a wireless C64 keyboard / joystick.
- **Connection & device health** — discovery, self-healing when a device is wrongly
  shown offline, health indicator accuracy, recovery after a device reboot.
- **Disk handling** — mounting, drive-mode compatibility, and *saving changes back*
  (write-back) reliably, including across device switches and app restarts.
- **Playback** — playing programs/music, background playback, and pause/stop behaviour
  staying consistent across screens.
- **RAM snapshots / machine state** — capturing and restoring machine/REU state.
- **Music library (HVSC)** — browsing, metadata, song lengths, downloads, responsiveness.
- **Configuration & settings** — safe config writes, settings export/import.
- **Diagnostics & error reporting** — clearer errors, diagnostics reports.
- **Documentation** — user manuals.

## Style rules (hard requirements)

- **No internal jargon.** Never mention hardening round numbers, finding IDs
  (HARDxx-nnn), ticket/BUG IDs, PR numbers, commit SHAs, reviewer/codenames, or file
  names. Translate everything to what a user or tester would observe.
- **High-level and factual.** One short line per point. No marketing superlatives, no
  speculation, no roadmap promises.
- **Group by domain.** Under each domain, lead with new *features*, then *stability
  improvements*.
- Keep the whole thing scannable — a stakeholder should read it in under a minute.

## Monday.com formatting

Monday.com announcement/update editors do **not** render Markdown syntax (`**`, `#`,
`-`). Write clean plain text that pastes well:

- Use an **emoji + ALL-CAPS or Title-Case label** for section headers (e.g. `🎮 REMOTE
  INPUT`) instead of `#` headings.
- Use a real bullet character `•` (or `–`) for list items, not `-` or `*`.
- Put the download link on its own line as a bare URL (Monday auto-links it).
- Blank lines between sections. No tables.
- The user can apply bold/colour with the Monday toolbar after pasting.

## Required elements

- A one-line title with the app name + version.
- The **download link** for the relevant build. For the **C64U Remote** APK use the
  GitHub release asset:
  `https://github.com/chrisgleissner/c64commander/releases/download/<version>/c64u-remote-<version>-android.apk`
  (confirm the exact asset name with `gh release view <version> --json assets`). The
  `c64u-remote` variant is **Android-only** (APK only — no AAB, no iOS build). The
  `c64commander` variant additionally has an AAB and an iOS IPA.
- An **@-mention** if the user asks for one (this user has used `@ev`). Place it near the
  top or in a short intro line. If unsure who to mention, ask or leave a clear
  `@<person>` placeholder.
- The domain-grouped highlights.

## Checklist before returning

- [ ] Baseline is the previous tag (or the user's explicit choice), stated to yourself.
- [ ] Zero internal identifiers leaked into the text.
- [ ] Grouped by domain; features before stability per domain.
- [ ] Correct, verified download URL for the requested variant.
- [ ] Delivered as one copy/paste-ready fenced block in the chat.
