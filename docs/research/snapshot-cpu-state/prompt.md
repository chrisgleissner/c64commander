# Implementation Prompt — Reliable CPU-State Snapshot & Restore

> Companion to `research.md` in this folder. **Read `research.md` first** — it is the evidence base and
> the source of every firmware/REST claim referenced here. This prompt commits to **one** design (the
> best overall balance of reliability, edge-case completeness, codebase impact, and effort) and tells
> you exactly how to build it.

## Role

You are implementing a feature in **C64 Commander** (this repo). You are an expert in Capacitor/Android,
TypeScript/React, the Ultimate-64 / C64U / Ultimate-II REST API (firmware **1.1.0**), and 6502/6510
assembly. You will extend the existing **RAM-only** snapshot feature so it can also **capture and
restore the full 6510 CPU state** (PC, A, X, Y, SP, P) — reliably — using **only the existing C64U
firmware 1.1.0 REST API**.

## Absolute constraints

1. **Origin-independent — works at any time, however the program was started.** The snapshot must work
   for **whatever is currently running**, no matter how it got there: a BASIC program typed or `RUN`,
   a PRG/disk image autostarted, a demo, a game started from a user-mounted cartridge, content launched
   by C64 Commander, or something launched by an entirely different tool. **The design must not assume
   the app is the launcher** or that any agent/instrumentation was pre-installed. (This is the central
   reason RLI is chosen over IAL — see below.)
2. **No firmware changes.** Use only existing REST: `machine:pause`/`resume`, `machine:readmem`,
   `machine:writemem` (PUT and POST), `runners:run_crt` (POST binary upload), `configs` (read the
   configured cartridge), `info`/`version`. Uploading a custom `.crt` and programming the C64's own CIA
   via `writemem` are *uses* of the API, not firmware changes.
3. **Do not regress the existing RAM-only snapshot.** It remains the default for non-CPU snapshots and
   must keep passing its tests. The `.c64snap` format change must be **backward compatible** (v1 files
   still load).
4. **Respect device fragility.** Reuse the existing firmware-aware safety profile / bounded REST
   concurrency / liveness checks (`src/lib/machine/c64Liveness.ts`, `ramOperations.ts` retry/liveness).
   Never round-trip the live-I/O region beyond necessity; keep the **CIA-timer-register skip** on
   restore (`isCiaTimerRegister`, the cursor-blink hazard — see `research.md` and commit `fe212a59`).
5. **No silent lies.** A snapshot must never claim CPU state it did not actually capture. Gate the
   feature on capability detection and store an honest `cpu_state_captured` flag + `capture_method`.

## The chosen design (and why this one)

**Capture = RLI (Ride the Live Interrupt) + ISN fallback. Restore = CUR (uploaded Ultimax cartridge).
Every capture is verified before it is stored.**

Why this over the alternatives in `research.md`:

- **vs IAL (instrument-at-launch): rejected — it cannot meet the origin-independence requirement.** IAL
  only works for content the app itself launched (it pre-installs an agent at launch). The feature must
  snapshot *whatever is already running, however it was started*, so IAL is not a valid primary and adds
  little over RLI even for app-launched content (which RLI already covers, since it just rides the
  interrupts the running program already has). IAL would also change the launch/playback path. **Do not
  build IAL.**
- **RLI is chosen precisely because it is origin-independent:** it attaches to whatever is running by
  hooking the interrupt the program is already using; it needs no launch involvement, no pre-installed
  agent, and no assumption about how the program started. ISN (inject a CIA2-timer NMI) is the
  origin-independent fallback for the rare `SEI`-loop case.
- **vs PBT (passive bus stream):** also origin-independent and the *only* method that can additionally
  capture **cartridge-resident** programs (which RLI cannot), but it is gated on **reverse-engineering
  an undocumented UDP payload** + a **native UDP receiver** on Android — high effort/risk, not "just
  works" today. Keep it as the documented **optional Phase 4** that extends coverage to the cases RLI
  can't reach.
- **CUR is the only viable restore** and is well-precedented by the firmware's own `bootcrt.tas`. It is
  also origin-independent (a clean reset into the saved state).

**Scope reality (state it in the UI, do not fight it):** the feature is **origin-independent** — it
snapshots whatever is running regardless of how it started — and a full round-trip works for any
**RAM-resident program** (BASIC, disk/PRG, demo, app-launched, or started by any other tool). The one
class it cannot fully serve is a program running from **cartridge ROM** (e.g. a game the user started
from a mounted cartridge): its ROM is not in the snapshot so it cannot be **restored**, and it usually
cannot be **captured** by RLI either (the cartridge owns the interrupt vectors). **Detect this case and
degrade gracefully** (clear message; offer a RAM-only snapshot). Capturing that remaining class is what
the optional PBT phase is for.

## Where the code goes (keep impact contained)

New, self-contained module dir **`src/lib/snapshot/cpu/`**:

- `captureEngine.ts` — RLI + ISN orchestration over `c64api` (pause/readmem/writemem/resume).
- `restoreCart.ts` — CUR: build the Ultimax `.crt`, `POST run_crt`, run the DMA-RAM + handshake +
  finalize.
- `six502/` — the 6502 payloads as **byte arrays** (hand-assembled or via a tiny built-in assembler),
  each with a **golden-bytes unit test**: `captureHandler`, `restoreFinalize`, and the CRT wrapper.
- `safeRegion.ts` — pick the resident scratch/handler region (default **cassette buffer `$033C–$03FB`**,
  192 bytes, free on most non-tape programs; with a fallback scan + abort path).
- `cpuState.ts` — the `CpuState` type + (de)serialization for the format block.

Touch points (additive, minimal):

- `src/lib/c64api.ts` — add `runCrtUpload(bytes)` (`POST /v1/runners:run_crt`, octet-stream),
  `getInfo()`, `getApiVersion()`, `getCartridgeConfig()` (`GET /v1/configs/C64 and Cartridge
  Settings/Cartridge`). Reuse existing `readMemory`/`writeMemoryBlock`/`machinePause`/`machineResume`.
- `src/lib/snapshot/snapshotFormat.ts` + `snapshotTypes.ts` — **format v2** (below), keep v1 read path.
- `src/lib/snapshot/snapshotCreation.ts` + `snapshotStore.ts` — produce/store CPU snapshots.
- `src/pages/home/dialogs/SnapshotManagerDialog.tsx` + `RestoreSnapshotDialog.tsx` — a "CPU + RAM"
  snapshot option, capability gating, and the cartridge/edge-case warnings.
- Reuse `src/lib/machine/ramOperations.ts` unchanged where possible (pause/read/write, CIA-timer skip).

## Capture algorithm (RLI, with ISN fallback) — implement exactly

All steps use `writemem`/`readmem`/`pause`/`resume`. **Save originals of every byte you touch and
restore them**, and substitute originals into the stored snapshot so it reflects the program's true RAM.

1. **Probe.** `pause`. `readmem` `$00/$01` (banking), the active interrupt vectors, and the chosen
   safe region. Decide vectors from banking: KERNAL mapped ⇒ ride the IRQ via `$0314/$0315` (KERNAL
   `$FF48` has already pushed A/X/Y) and NMI via `$0318/$0319`; KERNAL banked out ⇒ use the RAM
   hardware vectors `$FFFE/$FFFF` (IRQ/BRK) and `$FFFA/$FFFB` (NMI).
2. **Pick & reserve a safe region** (`safeRegion.ts`): default cassette buffer `$033C`. Save its
   original bytes. If it looks in use and no fallback is safe, **abort with a clear message** (do not
   risk corruption).
3. **Install the capture handler** (the `captureHandler` 6502 payload) into the safe region via
   `writemem`. Initialize its `captured`/`release` flag bytes to 0.
4. **Hook the live interrupt** with a single atomic `writemem` of the 2-byte vector → handler entry
   (atomic because the DMA write pauses the CPU). Chain: the handler preserves the original vector so
   the program's own interrupt still works after capture.
5. `resume`. Within ≤ ~20 ms a natural interrupt (jiffy IRQ `$0314`, or a game's raster IRQ, or a hooked
   NMI) enters the handler.
6. **Handler behavior** (frozen-then-transparent model): save PC + P (from the interrupt stack frame),
   A/X/Y (from the KERNAL-pushed frame, or push them itself for the banked-out path), and `SP` (`TSX`)
   into a scratch area; set `captured`; then **spin** on `release`. The program is now frozen at a
   transparent interrupt boundary.
7. **ISN fallback:** if `captured` is not set within a timeout (program is in an `SEI` tight loop with
   no IRQ), program **CIA2 Timer A** for a short underflow with Timer-A interrupt enabled (`$DD0D=$81`)
   via `writemem` — the C64's own CIA2 asserts **/NMI** (non-maskable). Point the NMI vector at the
   handler and retry from step 5. If still nothing (NMI vectored to RTI by anti-freeze code), **fail
   cleanly** ("this program cannot be CPU-snapshotted").
8. **Read the snapshot.** Once `captured`: optionally `pause` for a fully consistent read; `readmem`
   the scratch (→ PC/A/X/Y/SP/P) and all snapshot RAM ranges **including the full stack page
   `$0100–$01FF`**. Substitute the saved originals for the handler/scratch/vector/CIA bytes so the
   stored RAM is the program's, not ours.
9. **Verify (mandatory).** Re-read the scratch and confirm a stable, self-consistent register set
   (e.g. a checksum the handler also computed; SP within range; PC inside a RAM-mapped/executable
   region consistent with banking). If verification fails, **retry the whole capture up to N times**,
   then fail — **never store an unverified CPU snapshot** (fall back to offering a RAM-only snapshot).
10. **Resume transparently.** Set `release`. The handler restores the original interrupt vector and
    A/X/Y, then jumps to a tiny **free-stack trampoline** (mirroring `bootcrt.tas`'s `$0150` self-erasing
    exit) that restores the last of the clobbered bytes and `RTI`s back to the interrupted PC — the
    program continues unperturbed. Finally `writemem`-restore the CIA2 registers and the safe region to
    their originals. If transparent resume can't be confirmed, fall back to leaving the machine frozen
    and tell the user to **Restore** to continue.

## Restore algorithm (CUR) — implement exactly

Precondition: a v2 snapshot with CPU state + RAM ranges **including `$0100–$01FF` and `$01`**.

1. `getCartridgeConfig()` — remember the configured cartridge to re-apply later.
2. **Build a per-snapshot minimal Ultimax `.crt`** (`restoreCart.ts` + `six502/`): CRT header
   (`CBM80`, hardware **type 0, EXROM=1, GAME=0** ⇒ `CART_TYPE_UMAX`, runs at reset), one CHIP packet
   at `$8000`, reset vector → the `restoreFinalize` payload with the snapshot's PC/A/X/Y/SP/P/`$01`
   baked in as immediates.
3. `runCrtUpload(crtBytes)` (`POST /v1/runners:run_crt`) — resets the C64 and runs our cart.
4. The cart spins on a release flag while the app `writemem`s the **entire RAM image** (incl. the stack
   page). The app also writes the 3-byte **RTI frame** (P, PCL, PCH) into the **free stack** at/below
   the saved SP (free bytes — does not corrupt the program's live stack). Reuse the existing
   **CIA-timer-skip** on these writes.
5. App sets the release flag (`writemem` one byte). The finalize stub copies itself to the free stack,
   **disables the cartridge** (so `$8000+`/`$E000+` become restored RAM), sets `$01`, sets `SP`,
   restores A/X/Y, and `RTI`s to the saved PC.
6. **Re-apply the user's configured cartridge** via config/`run_crt` if one was set (note: a further
   reset; frame restore as a fresh session in the UI).

## Snapshot format v2 (backward compatible)

Bump `.c64snap` `version 1 → 2`. Reuse the existing `flags` (u16) + optional JSON metadata tail (v1
readers already tolerate its absence). Add:

- **CPU state block:** `pc` (u16 LE), `a`,`x`,`y`,`sp`,`p` (u8). Keep `p` as the raw flags byte plus a
  decoded boolean map in JSON.
- **Mandatory ranges for CPU snapshots:** the **full stack page `$0100–$01FF`** and `$01` (today's
  "Program" type excludes the stack — fix for CPU snapshots).
- **Capability metadata:** `firmware { product, firmware_version, fpga_version, core_version,
  api_version }` (from `info`/`version`), `cpu_state_captured: boolean`, `capture_method:
  "rli"|"isn"|"none"`, `restore_method: "cur"`.
- **Cartridge metadata:** `cartridge { configured_name, was_active, ram_resident_assumed }`.

Restore must check `cpu_state_captured` + firmware capability before offering a CPU resume; otherwise
fall back to RAM-only restore. v1 RAM-only snapshots continue to load and restore unchanged.

## Edge cases — handle every one explicitly (checklist)

- **Any origin:** program at the BASIC `READY` prompt / direct mode, a `RUN`ning BASIC program, a
  disk/PRG autostart, a demo, content the app launched, content launched by another tool, or a game the
  user started from a **mounted cartridge**. The capture path must make **no assumption** about how the
  program started or that any agent was pre-installed — it probes the *current* live state each time.
- KERNAL banked in vs out → correct IRQ/NMI vector (`$0314`/`$0318` vs `$FFFE`/`$FFFA`).
- `SEI` tight loop with no interrupt → ISN (CIA2 NMI); still nothing → clean failure.
- Anti-freeze (vector → RTI, vector rewritten continuously) → detect via verify/timeout; fail cleanly.
- A **cartridge is mounted** (read config): capture — proceed only if it isn't owning the vectors;
  restore — **refuse with a clear message** (RAM-resident only), then re-apply the configured cart.
- Safe region in use → fallback region, else abort (no corruption).
- Abnormal/low SP (deep stack) → guard the free-stack trampoline + RTI-frame writes.
- CIA timer registers skipped on every restore write (existing hazard).
- Device wedge / not-live → reuse `ensureLiveness`/retry; bounded concurrency; on wedge, wait-out
  (60–120 s), never hammer.
- Firmware/target: gate on `info` (U64 has `core_version`); verify CIA2-NMI parity on **both U64 and
  U2** (standard, but prove on HIL).
- Verification gate: an unverifiable capture is **never stored**.

## Reliability requirements ("just works")

- Capture is **verified** before storage; unverified ⇒ retried, then rejected (offer RAM-only instead).
- All clobbered live RAM/registers are **restored to original** after capture; transparent resume keeps
  the program running, or the machine is left cleanly frozen with a Restore prompt.
- Restore reproduces PC + A/X/Y/SP/P + full RAM (incl. stack). Document the one inherent limit:
  CIA/VIC/SID *internal* phase is not cycle-perfect (writemem hits live registers) — fine for resume,
  may glitch cycle-exact raster code.
- No feature affordance appears unless capability + `cpu_state_captured` say it's real.

## Testing (a false pass must be hard)

- **Unit:** golden-bytes tests for every 6502 payload; CRT builder produces a valid Ultimax CRT;
  format v2 round-trip incl. CPU/stack blocks + v1 read; `safeRegion` selection; banking→vector
  selection; capability gating; **negative** (no CPU UI when `cpu_state_captured=false`).
- **Integration (mock firmware from the fixtures in `docs/c64/`):** capture issues only
  `pause/writemem/readmem/resume` + the vector hook; restore issues `run_crt` upload + `writemem` +
  handshake; CIA-timer registers never written on restore; cartridge present ⇒ warn/refuse path.
- **HIL (real devices; u64 = 192.168.1.13, c64u = 192.168.1.167 — see `research.md`):**
  - Capture proof: a test PRG sets distinctive A/X/Y/SP, a known PC loop, a chosen flag pattern, and a
    RAM canary; assert **exact** register + RAM equality (not "didn't crash").
  - Restore proof: resume writes its observed registers to a canary; assert exact match + full RAM.
  - Transparent-resume proof: the program keeps running unperturbed after a snapshot.
  - Fragility matrix: BASIC (jiffy IRQ), raster-IRQ game, `SEI` loop (→ ISN), KERNAL-banked-out,
    cartridge mounted (→ warn/refuse). Record pass/fail per class.
  - Round-trip: capture → perturb → restore → identical CPU+RAM; **cursor-blink/jiffy rate unchanged**.
  - Wedge watch + log capture throughout.

## Build order (each phase independently shippable & green)

- **Phase 0:** format v2 + capability detection. No behavior change; RAM-only stays default.
- **Phase 1:** **CUR restore** + its unit/integration/HIL tests (lower risk, immediate value: resume an
  app-launched PRG at an exact PC).
- **Phase 2:** **RLI capture** + ISN fallback + verification + transparent resume + tests/HIL.
- **Phase 3:** UI integration (CPU+RAM option, capability gating, cartridge/edge warnings) + docs.
- **Phase 4 (optional):** PBT — extend *capture* coverage to the cartridge-resident / anti-freeze
  programs RLI can't reach (requires reverse-engineering the `streams:debug` UDP payload + a native UDP
  receiver). Origin-independent like RLI; this is the path to true universality.

## Out of scope

Firmware changes; **IAL (instrument-at-launch) — explicitly rejected** because it is origin-dependent and
cannot meet the "works for whatever is running, however started" requirement; PBT (optional later
phase); restoring cartridge-ROM-resident programs.

## Done when

- CPU+RAM snapshot and restore work **reliably on HIL** for the supported program classes **regardless
  of how the program was started** (prove with content started ≥3 different ways — e.g. BASIC `RUN`, a
  disk/PRG autostart, and a non-app launch), with every capture verified; unsupported classes
  (cartridge-resident) are detected and degrade gracefully (clear message, RAM-only fallback).
- The existing RAM-only snapshot is unaffected; v1 files still load.
- Unit + integration tests cover the matrix above; HIL evidence is captured.
- No firmware changes; only the REST calls listed in **Absolute constraints** are used.
- All review checks in `research.md` (capture feasibility, restore feasibility, cartridge coexistence,
  honesty flags, code references) are satisfied by the implementation.
