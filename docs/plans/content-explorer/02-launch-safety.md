# 02 — Launch Safety (engineering deep-dive)

**Capability B** of the [Content Explorer](./overview.md) initiative.
**Feature flag:** `launch_safety_enabled`
**Status:** Implemented behind `launch_safety_enabled` (stable, on by default).

> **As-built (shipped).** `src/lib/playback/launchSafety.ts` ships `withCartridgeParked`
> (reads the live `C64 and Cartridge Settings / Cartridge` value, parks it to empty for
> the launch, restores it in a `finally`; a no-op when the flag is off, the read fails,
> or the value is empty/`None`, and a failed park or restore never fails the launch) plus
> `bootSettle` + `pressKeyWithRetry` for the optional boot-menu answer. The direct-memory
> play plans are wrapped and `crt` is exempt, as planned.
>
> **Deviation from §5 (Settings location).** The advanced control shipped in **Settings →
> Play and disk behaviour** as **Answer cartridge boot menu after reset** (key picker +
> boot-settle ms), not under a new "Device Safety → Compatibility" subsection. Cartridge
> parking has no dedicated on/off beyond the `launch_safety_enabled` feature toggle — it
> is fully automatic and invisible, exactly as intended.

> Two related correctness behaviours for launching software:
>
> 1. **Cartridge parking** — stop a configured freezer cartridge from hijacking a
>    direct-memory launch (the default, invisible behaviour).
> 2. **Boot-menu answer** — optionally press a key after a Mount & Load reset so a
>    cartridge boot menu doesn't swallow the typed `LOAD` (off by default; the
>    folded-in "reset-key" idea).

---

## 1. Why cartridge parking

A direct-memory launch (`run_prg`, first-PRG disk autostart, and Disk Explorer's
Run/Load) works by DMA'ing a program in and starting it. On a machine configured
with a **freezer cartridge** (Retro Replay / Action Replay style), the launch's
internal boot-cartridge swap-and-restore handshake can fail, and the firmware
falls back to a **hard reset into the cartridge's menu**. The user taps "run this
game" and lands on a cartridge screen. It looks exactly like an app bug.

The fix: before the launch, set the `Cartridge` config item to empty so the
machine isn't pointed at the cart during the swap; restore it afterwards.
**Config changes apply only at the next reset and never touch flash**, so:

- the launched program keeps running with the cartridge parked,
- the original value is restored immediately after,
- even a worst-case crash mid-launch is undone by a power-cycle (nothing
  persisted).

The category/item are already known to the app
(`src/lib/config/menuMapping/c64u-1.1.0.generated.ts`): category **`C64 and
Cartridge Settings`**, item **`Cartridge`**.

---

## 2. `src/lib/playback/launchSafety.ts` (NEW)

```ts
import type { C64API } from "@/lib/c64api";

const CART_CATEGORY = "C64 and Cartridge Settings";
const CART_ITEM = "Cartridge";
// values that mean "no cartridge" and need no parking:
const NONE_VALUES = new Set(["", "None", "none"]);

export async function withCartridgeParked<T>(api: C64API, run: () => Promise<T>): Promise<T> {
  if (!launchSafetyEnabled()) return run();

  // read the CURRENT value; prefer the config query cache to avoid an extra GET,
  // fall back to GET /v1/configs/{cat}/{item} if not cached.
  const current = await readCartridgeValue(api);
  const shouldPark = current != null && !NONE_VALUES.has(current);

  if (shouldPark) {
    await api.setConfigValue(CART_CATEGORY, CART_ITEM, "");
  }
  try {
    return await run();
  } finally {
    if (shouldPark) {
      // best-effort restore; never let a restore failure mask the run's result
      try {
        await api.setConfigValue(CART_CATEGORY, CART_ITEM, current!);
      } catch {
        /* logged */
      }
    }
  }
}
```

Notes:

- **Read the live value each time.** Don't cache it across launches; the user may
  change the cartridge in Configuration between launches.
- **`finally` restore, best-effort.** A failed restore must not turn a successful
  launch into an error. Log it to diagnostics.
- **No-op paths:** flag off → `run()` untouched; no cartridge configured →
  `run()` untouched, no config writes.

---

## 3. Wiring into `executePlayPlan`

Wrap the **direct-memory** cases in `src/lib/playback/playbackRouter.ts`; leave
`crt` alone.

| Plan kind                            | Wrap?  | Why                                                                       |
| ------------------------------------ | ------ | ------------------------------------------------------------------------- |
| `prg`                                | yes    | direct-memory run                                                         |
| `sid`                                | yes    | sidplay is a direct-memory launch                                         |
| `mod`                                | yes    | modplay is a direct-memory launch                                         |
| `disk` (first-PRG autostart)         | yes    | direct-memory                                                             |
| `disk-file` (Disk Explorer Run/Load) | yes    | direct-memory                                                             |
| `crt`                                | **no** | a CRT launch _is_ a cartridge swap by definition; parking would defeat it |
| `disk` (Mount & Load)                | no     | drive-backed; nothing DMA'd; see §4 instead                               |

```ts
case "prg": {
  await withCartridgeParked(api, async () => {
    if (plan.source === "device") await api.runPrg(plan.path);
    else await api.runPrgUpload(blob, { filename: plan.path });
  });
  break;
}
```

---

## 4. Optional boot-menu answer (the folded-in "reset-key")

**Narrow benefit, off by default.** This only helps one situation: a machine with
a cartridge that shows a **boot menu on reset**. Mount & Load resets, waits for
BASIC, then types `LOAD`. If a cartridge menu is up when those characters arrive,
the menu eats them (you end up in a monitor or the wrong menu item). Pressing the
cartridge's menu key first (e.g. the key that installs a fastloader / continues to
BASIC) clears the menu so the `LOAD` lands.

If the user runs no such cartridge, this does nothing useful — hence off by
default and surfaced only as an advanced option next to Launch Safety.

### Settings (Device Safety → Compatibility)

- `bootMenuAnswerEnabled: boolean` (default `false`)
- `bootMenuKey: "F1".."F8" | "RETURN" | "SPACE"` (default `"F7"`)
- `bootSettleMs: number` (default `2800`) — total wait for BASIC after reset

### `bootSettle` (used by Mount & Load in `diskLaunch.ts`)

```ts
// PETSCII codes for the answerable keys:
const KEY_PETSCII = { F1: 133, F2: 137, F3: 134, F4: 138, F5: 135, F6: 139, F7: 136, F8: 140, RETURN: 13, SPACE: 32 };

export async function bootSettle(api: C64API, opts) {
  const total = opts.bootSettleMs ?? 2800;
  if (opts.bootMenuAnswerEnabled) {
    await delay(Math.min(1000, total)); // let the menu come up
    await pressKeyWithRetry(api, KEY_PETSCII[opts.bootMenuKey]); // reboot can briefly drop the input path
    await delay(Math.max(0, total - 1000) + 600); // remainder + menu-handoff margin
  } else {
    await delay(total); // stock BASIC ~2.5 s
  }
}
```

- Inject the key via the existing keyboard-buffer path
  (`kernalFallbackInjector`); no new transport.
- `pressKeyWithRetry` accounts for the input path being briefly unavailable right
  after a reset — retry for a short window before giving up.
- Applies **only** to Mount & Load (drive-backed). Direct-memory launches don't
  reset and don't need it.

---

## 5. UI

- **Device Safety → Compatibility** (new subsection):
  - "Park cartridge during direct launches (recommended)" → `launch_safety_enabled`
    behaviour, on by default when the flag ships stable.
  - "Answer cartridge boot menu after reset (advanced)" → toggle + key picker +
    delay, off by default, with a one-line explanation of when it helps.
- No per-launch UI. The whole point is that correct launching is invisible.

---

## 6. Test plan

- **Unit** — `withCartridgeParked`: parks + restores around a resolving run;
  restores after a throwing run; **no** config writes when the value is
  empty/`None` or the flag is off; a failing restore doesn't mask the run result.
- **Unit** — `bootSettle`: with the answer off, waits `total`; with it on, presses
  the mapped key once and respects the timing; retries when the first press fails.
- **Playwright (`playback.spec.ts`)** — against a mock device reporting a
  configured `Cartridge`, a `prg` launch issues park → run → restore in order; a
  `crt` launch issues **no** park/restore.
- **Mock (`src/lib/mock`)** — a device fixture whose `Cartridge` item has a
  non-empty value, asserting the exact config PUT sequence.
