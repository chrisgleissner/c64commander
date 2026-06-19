# Callback 8020 support — handover & progression

This folder drives the Commodore Callback 8020 / Sailfish OS support to
**feature-complete and bug-free** through a sequence of small, self-contained
sessions. Each session is started from a numbered **handover prompt**, does a
bounded slice of work, updates the backlog, and writes the **next** handover
prompt — so progress compounds without any single session having to do
everything.

Two ways to run the progression: **automated** (preferred) via the `ralph-robin`
orchestrator looping [`../ralph/callback8020.ralph.prompt.md`](../ralph/callback8020.ralph.prompt.md),
which picks the next backlog slice, verifies it, and writes the next handover each
increment; or **manual**, pasting the latest numbered handover prompt yourself.
Both share this folder's [`backlog.md`](backlog.md) as the definition of done.

## Automated driving (ralph-robin)

```bash
ralph-robin -f docs/plans/callback8020/ralph/callback8020.ralph.prompt.md \
            -C /home/chris/dev/c64/c64commander -P claude,codex,opencode -D 24h
```

The Ralph prompt encodes the **target architecture** and the loop contract (one
verified backlog slice per increment, clean-exit semantics, guardrails). It reads
`backlog.md` + the latest `NNNN-handover.md` + `../ralph/STATE.md`, does the slice,
and writes `NNNN+1-handover.md`.

## How to use this (manual)

1. Open the highest-numbered `NNNN-handover.md` and paste it as the prompt for a
   fresh session (Claude Code, in this repo).
2. That session: reads the linked docs, does the scoped work, verifies it, ticks
   items in [`backlog.md`](backlog.md), and **writes `NNNN+1-handover.md`** before
   finishing.
3. Repeat. The backlog is the single source of truth for "what done looks like";
   the handover prompts are the running thread of state between sessions.

## Conventions for each handover prompt

A good `NNNN-handover.md` contains, in order:

- **Context** — one paragraph + the must-read docs (below).
- **Verified state** — what is proven green right now (with how it was verified).
- **This session's scope** — 1–3 backlog items, small enough to finish + verify.
- **Guardrails** — do not regress; keep the main README free of any Callback/
  Sailfish/C64U-Remote references (those docs live only under
  `docs/plans/callback8020/`); never overstate validation (use "designed for /
  validated against constraints" unless run on real Sailfish/Callback hardware);
  no skipped tests or lowered gates.
- **Definition of done for the session** — gates to run (below) + "update
  `backlog.md` and write the next handover prompt".

## Must-read docs (the canonical references)

- [`../touch-free-and-sailfish-support.md`](../touch-free-and-sailfish-support.md) — how no-touch + Sailfish are supported (+ conservative risks).
- [`../sailfish-callback-8020-android-compatibility.md`](../sailfish-callback-8020-android-compatibility.md) — deep compatibility review, feature inventory, risk table.
- [`../sailfish-callback-8020-emulation.md`](../sailfish-callback-8020-emulation.md) — Waydroid + AOSP emulator + Pixel 4 test layering.
- [`../keymap.md`](../keymap.md) — semantic actions, T9 tables, input profiles.
- Root `PLANS.md` / `WORKLOG.md` — authoritative plan + running log for the whole effort.

## Key commands / gates (run what's relevant to the slice)

```bash
npm run lint                          # format + eslint + stale-name guard + variant/flag checks
npm run test                          # full unit suite
npm run test:coverage                 # unit coverage (91% line/branch gate downstream)
npm run variant:check                 # variant outputs up to date
node scripts/build-android-apks.mjs --target ci --verify-metadata   # both APKs + metadata + no-GMS
npm run apk:no-gms -- artifacts/android-apks/c64u-remote-*.apk
npx playwright test playwright/callbackSmallScreen.spec.ts --project=android-phone
# Sailfish-like substitutes:
scripts/waydroid-smoke.sh preflight   # then: sudo scripts/waydroid-smoke.sh setup ; scripts/waydroid-smoke.sh run
scripts/sailfish-callback-emulator.sh config
# On-device (if a device is attached): scripts/android-keypad-smoke.sh <serial> <apk> <pkg>
```

## The variant under test

`C64U Remote` — `uk.gleissner.c64uremote`, Android-only, focused, no Google
services, keypad-first. The full `C64 Commander` variant must stay unchanged
except for shared, beneficial fixes.
