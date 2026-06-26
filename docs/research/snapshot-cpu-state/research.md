# Snapshot CPU State Research

> Scope: feasibility-only research. **No code was changed.** **No firmware changes are proposed.**
> Target: C64U firmware **1.1.0** REST API (`docs/c64/c64u-openapi.yaml`, `docs/c64/c64u-config.yaml`).
> Firmware source (`../1541ultimate`) was read **only to understand existing behavior**.
>
> **Revision 3** — supersedes Rev 1 ("not feasible") and extends Rev 2. A broad creative search
> (ten mechanisms, graded below in **Creative Mechanisms for Full CPU-State Capture & Restore**) shows
> capture is reachable by **several independent REST-only paths**, not just the one fragile injected-NMI
> trick of Rev 2. The strongest are **IAL** (instrument the program at launch so we own the interrupt
> vectors — deterministic), **RLI** (ride the interrupt the program is *already* running — no trigger
> needed), and **PBT** (a *passive* live CPU-bus stream the FPGA already emits — non-invasive, works
> even for cartridge-resident programs). Restore remains **CUR** (a per-snapshot uploaded Ultimax
> cartridge). Everything proposed uses **only existing REST** (`run_crt` upload, `writemem`, `readmem`,
> `pause`/`resume`, `configs`, `streams`, `machine/input`) — no firmware modification.
>
> **Revision 2** (retained below) established the capture/restore **asymmetry**: restore tolerates a
> reset (so an uploaded cartridge works), capture does not (a reset destroys the running registers).

## Summary

The C64 Commander "snapshot" today is **RAM-only**: it DMA-reads selected memory ranges (under a DMA
pause) and writes them back, capturing **no** CPU state and ignoring cartridges. The question is
whether full 6510 CPU-state capture and restore (PC/A/X/Y/SP/flags) can be added using **only** the
existing C64U firmware 1.1.0 REST API.

The key insight that reframes everything: **capture and restore are not symmetric.**

- **Restore tolerates a reset** (you are loading a *saved* state from scratch), so a clean
  reset-into-a-custom-cartridge is fine. The firmware's own PRG launcher already proves the pattern
  (`bootcrt.tas`: mount a transient cartridge, spin in a handshake while the firmware DMAs data, then
  transfer control). **Restoring full CPU state is feasible via existing REST.**
- **Capture cannot tolerate a reset** — a reset destroys the running program's registers. Capturing a
  *running* program requires a freezer-style **NMI** (the 6502 pushes PC+P to the stack and vectors to
  a handler, leaving the program intact). On this firmware the freeze button is a **DMA halt, not an
  NMI**, and mounting a cartridge always resets — so the "capture cartridge" idea **cannot** work. The
  only viable capture is **cartridge-free**: inject a CIA2-timer NMI + a small RAM handler via
  `writemem`, let it save the registers, then `readmem` them. **This works but is fragile.**

**Therefore the original proposal is half-right.** A custom cartridge is the right tool for **restore**
but the wrong tool for **capture**. Both directions only apply to **RAM-resident programs** — a program
running from cartridge ROM (a mounted game/utility/freezer cartridge) can be neither captured nor
restored this way, because our cartridge would replace it (capture) or its ROM is absent from the
snapshot (restore) — **except** that the passive **PBT** stream below can *capture* (not restore) even
cartridge-resident programs.

**Rev 3 update — capture has several independent paths, so it is more reliable than Rev 2 implied.**
The single fragile injected-NMI method is only the fallback. A layered design is reliable for
RAM-resident programs:

- **Deterministic for app-launched content (the common product case): IAL.** When C64 Commander
  launches a program, it co-installs a tiny agent that **takes ownership of the IRQ/NMI vectors before
  the program's first instruction** (confirmed feasible: after `load_prg` the KERNAL vectors and the
  ~60 Hz jiffy IRQ are intact, and `POST /v1/machine/input` can type `RUN`/`SYS`). Capture then has no
  race and no "is an interrupt firing?" uncertainty.
- **General, for already-running RAM programs: RLI.** Hook the interrupt vector the program is *already*
  using (jiffy IRQ `$0314`, a game's raster IRQ, or `$0318` NMI) with one atomic `writemem`; the next
  naturally-firing interrupt enters our chained handler. No new interrupt source ⇒ minimal conflict.
  Fallback **ISN** (inject a CIA2-timer NMI, which the C64's own CIA2 generates — independent of the
  monitor-only FPGA NMI register) covers SEI tight loops.
- **Universal, non-invasive (best coexistence): PBT.** The FPGA already emits a **continuous live 6510
  bus stream** (`streams:debug`, mode "6510 Only") over UDP while the C64 runs untouched. Reconstruct
  PC/A/X/Y/SP/P offline with a self-verifying 6502 bus-replay engine. Works for *any* program — SEI
  loops, vector-protected, even cartridge-resident — at the cost of reverse-engineering the UDP payload.

## Recommendation

**`Needs REST-only prototype before decision`**, but with **higher confidence than Rev 2** — capture is
reachable by three independent REST-only paths, so it is not a single point of fragility.

**Requirement (clarified):** the feature must work **at any time, for whatever is running, regardless of
how it was started** (BASIC, disk/PRG, demo, app-launched, or started by another tool / a user-mounted
cartridge). This makes the capture mechanism **origin-independent**, which reorders the priority below —
**IAL is out of the primary path** (it only works for content the app itself launched). Build in this
order:

1. **RLI + CUR (origin-independent — start here).** Ride the interrupt the running program already has;
   `ISN` (CIA2-timer NMI) as the SEI-loop fallback. Restore via a per-snapshot uploaded Ultimax `.crt`.
   Works for any running RAM-resident program no matter how it started, with no launch involvement.
2. **PBT + CUR (origin-independent; extends coverage).** Passive live-bus reconstruction for *any*
   program incl. cartridge-resident and anti-freeze cases RLI can't reach; gated on reverse-engineering
   the debug-stream UDP format. The path to true universality.
3. **IAL — not pursued for this feature.** Deterministic but **origin-dependent** (requires the app to
   instrument the launch), so it cannot satisfy the "whatever is running, however started" requirement,
   and RLI already covers app-launched content. Retained in the catalogue above for completeness only.

**Restore is the solved half** for all three: `POST /v1/runners:run_crt` with a per-snapshot Ultimax
`.crt` that spins while the app `writemem`s the full RAM image (incl. the stack page), then a finalize
stub sets SP/A/X/Y/P and `RTI`s to the saved PC (precedent: `bootcrt.tas`, minus registers).

All paths are **RAM-resident-only** for a full round-trip (PBT can additionally *capture* cartridge
programs, but they cannot be *restored* — no cartridge ROM in the snapshot). If prototyping shows even
IAL is not worth the complexity, the honest fallback remains **`Recommended only as RAM-only snapshot
improvement`** (naming, capability + cartridge metadata, warnings). No firmware change is required for
any path.

No firmware change is required for either path; if capture proves unreliable, the *clean* fix would be
firmware-side (a REST-exposed atomic freeze-and-read), documented as out of scope in
**Out-of-Scope Firmware Gaps**.

## Assumptions and Scope

- **Authoritative API surface** = `docs/c64/c64u-openapi.yaml` and `docs/c64/c64u-config.yaml`.
- Firmware is **evidence only**; nothing here adds or changes firmware endpoints/behavior.
- "Custom cartridge" = a `.crt` file **uploaded as data** to the *existing* `POST /v1/runners:run_crt`.
  "Inject NMI" = writing the C64's own CIA/vector RAM via the *existing* `writemem`. Neither is a
  firmware modification.
- "Full CPU state" = PC, A, X, Y, SP, P (flags).
- Targets: Ultimate 64 / C64U (FPGA soft-core 6510) and Ultimate-II / U2 (firmware cartridge + real
  6510). Differences are called out where material.
- **(inference)** marks deductions not directly proven from code/fixtures (notably the exact 6502
  resume engineering, which is established C64 technique rather than firmware-quoted).

## Supplied REST/API Fixtures

### Endpoints used by the proposed designs (all exist in `c64u-openapi.yaml`)

| Endpoint | Verb | Role in proposed design |
|---|---|---|
| `/v1/runners:run_crt` | **POST** | Upload + run a custom `.crt` as a **binary attachment** (no FTP needed). The restore mechanism. |
| `/v1/runners:run_crt` | PUT | Alternative: run a `.crt` already on the device filesystem (e.g. placed via FTP). |
| `/v1/machine:writemem` | PUT/POST | DMA-write RAM: restore RAM, inject capture NMI handler + CIA2 program + NMI vector. |
| `/v1/machine:readmem` | GET | DMA-read RAM: read captured registers from scratch, read snapshot RAM, poll handshake flags. |
| `/v1/machine:pause` / `:resume` | PUT | Bracket the capture setup; `resume` lets the injected NMI fire. |
| `/v1/configs/{cat}/{item}` | GET/PUT | Read the configured cartridge before restore; re-apply it afterward. |
| `/v1/info`, `/v1/version` | GET | Capability/version metadata for snapshots. |

### Endpoints/items that do NOT exist (so are unavailable)

- No CPU-register, freeze, snapshot, monitor, single-step, or "set PC and go" endpoint.
- No config item for live cartridge state, EXROM/GAME, or CPU registers.
- `debugreg` = a single 8-bit FPGA debug byte (`U64_DEBUG_REGISTER` @ `C64_IO_DEBUG`/$D7FF, **U64-only**,
  purpose undocumented) — **not** CPU registers.

### Relevant config items (`c64u-config.yaml`, `C64 and Cartridge Settings`)

`Cartridge` (file selector; example value `Final_Cartridge_3_1988-13.crt`), `Cartridge Preference`
(Auto/Internal/External/Manual), `Bus Operation Mode`, `Bus Sharing - ROMs/I/O1/I/O2/Interrupts`
(Internal/External/Both), `RAM Expansion Unit` (Disabled/Enabled/GeoRAM Mode), `DMA Load Mimics ID:`
(8–31 — the IEC id the PRG DMA-loader impersonates), `Command Interface` (Enabled/Disabled). No
EXROM/GAME or live-cart-state items.

## Current C64 Commander Snapshot/Restore Behavior

- **Create:** `SnapshotManagerDialog.tsx` → `useHomeActions.ts:handleSaveRam()` →
  `snapshotCreation.ts:createSnapshot()` → `ramOperations.ts:dumpRamRanges()` (`:295`).
- **Restore:** `RestoreSnapshotDialog.tsx` → `useHomeActions.ts:handleRestoreSnapshot()` →
  `ramOperations.ts:loadMemoryRanges()` (`:422`).
- **Captured:** selected RAM ranges under a DMA pause (`runPaused`, `:243`). Program type =
  `$0000-$00FF`,`$0200-$FFFF` (**excludes the stack `$0100-$01FF`**); Basic/Screen/Custom variants.
- **Not captured:** CPU registers; cartridge identity/state.
- **Format:** `.c64snap` v1 (`snapshotFormat.ts`): magic `C64SNAP\0`, version `1` (u16 LE), type,
  timestamp, range count, `flags` (u16, currently `0`), optional JSON metadata tail; descriptors
  `start:u16,length:u16`; raw blocks. Metadata (`snapshotTypes.ts`) has label/content/ranges/app
  version but **no CPU or cartridge fields**.
- **Storage:** localStorage `c64u_snapshots:v1`, base64, max 100.
- **Restore hazard already handled:** `loadMemoryRanges` writes only snapshot bytes and **skips CIA
  timer registers** (`isCiaTimerRegister`, `:35`) because the Ultimate's `readmem`/`writemem` hit
  **live I/O** — reading the CIA1 Timer A down-counter and writing it back as the latch sped up the
  cursor blink (commit `fe212a59`). This proves chip-register restore is subtle and inherited by any
  CPU/chip-state ambition.
- **Tests:** `tests/unit/lib/snapshot/*.test.ts`, `tests/unit/machine/screenSnapshotRoundtrip.test.ts`
  (asserts CIA timers are never written on restore), `playwright/ramSnapshot.spec.ts`.

## Current C64U Firmware 1.1.0 REST Capabilities

| Capability | REST? | Evidence |
|---|---|---|
| Read/Set 6510 registers (PC/A/X/Y/SP/P) | **No** | No route. `route_machine.cc` has only menu_button/reset/reboot/pause/resume/poweroff/writemem/readmem/menu_screen/debugreg/measure. `U64Machine::peek_cpu/poke_cpu` are *memory* accessors. |
| `pause` preserves but exposes CPU state | preserves, **not** exposes | `pause`→`MENU_C64_PAUSE`→`C64::stop(false)` (`c64.cc:463`): DMA bus stop; saves raster+VIC IRQ only. Registers stay *in the CPU* (resume works) but are never copied to readable memory. |
| `readmem`/`writemem` while paused | **Yes** | `C64_DMA_RAW_READ/WRITE` over `C64_MEMORY_BASE` = 64 KiB incl. live I/O. Registers aren't there. |
| `debugreg` = CPU state | **No** | Single 8-bit FPGA byte, U64-only. |
| Freeze that captures CPU registers | **No** | `C64::freeze()`→`stop(true)`→`C64_STOP=1` (`c64.cc:889`, `:463`): a **DMA halt, not an NMI**; never pushes PC/P, never vectors to cartridge code; backup struct (`c64.h:284`) holds VIC/CIA/3KB RAM/screen/color — **no CPU registers**. |
| NMI to the C64 via REST | **No** | An NMI-pulse register exists — `C64_MODE_NMI=0x10` (`c64.h:73`), used as `C64_MODE = C64_MODE_NMI` — but **only in the monitor** (`monitor_file_io.cc:161`), **not exposed by any REST route**. |
| Run helper code without reset | **No (firmware paths)** | `run_prg`/`run_crt` both reset (below). The only no-reset way to run code is the C64's own interrupts, which the app can arm via `writemem` (CIA) — not a firmware feature. |
| Preserve/restore cartridge **selection** | **Yes** | `GET`/`PUT /v1/configs/C64 and Cartridge Settings/Cartridge`. |
| Preserve/restore **live** cartridge state | **No** | Config holds a path only; mounting re-inits from the cart_def. |

## Action Cartridge Mk V / Freezer Cartridge Background

Why a hardware freezer can capture CPU state and why that maps to **restore here, but not capture**:

- **Control via NMI (not reset):** the freeze button pulls **/NMI**. The 6502 finishes the current
  instruction, pushes **PC then P** to the stack, and vectors via $FFFA into the cartridge's NMI ROM
  (the cart asserts EXROM/GAME so its ROM is visible regardless of `$01` banking).
- **Register capture:** the NMI ROM *is* the code that ran the instant the program was interrupted —
  PC/P are on the stack, and the handler stores A/X/Y/SP into the cartridge's hidden RAM. Full state
  recovered, program intact.
- **Restore:** reload RAM + the saved register block, rebuild the stack frame, restore A/X/Y/SP, and
  exit with **RTI** to the saved PC.

**Mapping to existing REST:** the *restore* half (rebuild stack, set registers, RTI) is reproducible
by a custom cartridge we upload — and the firmware's `bootcrt.tas` already does the structurally
identical "boot a cartridge, DMA data, transfer control" dance. The *capture* half needs an
**NMI that vectors into our code without a reset**. On this firmware that requires either a
freezer-cart already mounted before the program ran (we can't mount post-hoc without a reset) or a
REST-triggerable NMI (none exists). Hence capture must be done **cartridge-free**, by making the C64's
*own* CIA generate the NMI into a RAM handler we injected.

## PRG-Runner Mechanism and Reuse Potential (the restore precedent)

This is the strongest precedent for **restore**.

### Code path

`run_prg`/`load_prg` (`route_runners.cc:46`) → `FileTypePRG::start_prg` (`filetype_prg.cc:198`) →
`C64_DMA_LOAD` → `C64_Subsys::dma_load` (`c64_subsys.cc:598`):

1. `c64->stop(false)` — DMA-stop.
2. POKE boot-cart parameters into low RAM (`C64_BOOTCRT_*`).
3. `c64->start_cartridge(&boot_cart)` — temporarily mount the firmware's internal 8 KiB CBM-80 **boot
   cartridge** (`software/6502/bootcrt.tas`); this **resets** the machine (`start_cartridge`→`hard_stop`
   + `C64_MODE_RESET`, `c64.cc:1041/1057`).
4. Handshake on `$0002` (states `0x80` init → `0x40` ready-for-DMA → cart writes `0x01` ready → `0x00`
   done) while the firmware DMAs the PRG into RAM (`load_file_dma`).
5. `c64->resume()`; then `restoreCart()` (`c64_subsys.cc:175`) waits for the boot cart to self-disable
   and `set_cartridge(NULL)` re-applies the **configured** cartridge.

### What it proves (and its limits) for restore

- **Proves:** a transient uploaded/internal cartridge can boot at reset, **rendezvous via a handshake
  while data is DMA'd into RAM**, then transfer control to a chosen address — using only mechanisms
  reachable from REST. The boot cart even has a JUMP mode (`RUNCODE_DMALOAD_JUMP=0x05`, jump address at
  `$00AA`).
- **Limit:** the JUMP is a **bare `JMP ($00AA)`** (`bootcrt.tas`, `jumper_code`) with **no register
  restore** — and it runs from a tiny RAM stub at `$0150` so it survives disabling the cartridge. So a
  **custom** cartridge is required to set SP/A/X/Y/P and `RTI`. The boot cart cannot itself be coerced
  via REST into a full register restore; we supply our own cartridge instead.
- **(Note)** `bootcrt.tas` defines `RUNCODE_CAPTURE_BIT`/`RUNCODE_TAPE_CAPTURE` — these are **tape**
  capture, unrelated to CPU state. The firmware has no CPU-state capture facility.

## Active Cartridge Coexistence Requirements

| Requirement | Answer | Notes |
|---|---|---|
| Observe mounted cartridge | configured selection only | `GET .../Cartridge`; no "what is live" endpoint. |
| Save/restore cartridge **selection** | Yes | read then `PUT` the value. |
| Save/restore **live** cartridge state (RAM/banks/freeze/EXROM/GAME) | **No** | no REST handle. |
| `run_crt` replaces active cartridge + resets | Yes / Yes | `start_cartridge`: `set_cartridge(def)` + `C64_MODE_RESET` (`c64.cc:1096/1057`). |
| `run_crt` auto-restores prior cartridge | **No** | app must re-issue via config or `run_crt`. |
| Temporary cartridge without disturbing an active one | **No** | mount always resets/replaces. |
| Works while a freezer/EasyFlash/AR/FC is the running program | **No** | see "RAM-resident only" below. |

**Honest resolution of the coexistence requirement:** CPU-state snapshot/restore is for **RAM-resident
programs**. It does *not* apply when a software **cartridge is the running program** — that case cannot
be captured (our injected NMI can't redirect a cartridge that owns the vectors, and mounting our cart
resets it) nor restored (the snapshot has no cartridge ROM). For **capture**, the cartridge-free NMI
method **does not touch the cartridge slot at all** (transparent to a merely-present cartridge that
isn't controlling the NMI vector). For **restore**, run_crt necessarily resets and replaces the slot;
the app reads the configured cartridge first and re-applies it afterward (selection only), but the
restore *is* a fresh session — it cannot also keep a user cartridge's live state running.

## Existing REST-Only Temporary Cartridge Capture Feasibility

**Verdict: a reset-based capture cartridge is impossible.** Adversarial walk-through:

- `run_crt`/any mount **resets** (`start_cartridge`→`hard_stop`→`C64_MODE_RESET`). The running
  program's PC/A/X/Y/SP/P are gone **before** any capture cartridge could run. Capturing "the CPU
  state" right after a reset captures only the reset state — useless.
- The Ultimate **freeze is a DMA halt, not an NMI** (`C64::freeze`→`stop(true)`), so even with a cart
  configured, pressing freeze (`menu_button`→`C64_PUSH_BUTTON`) never vectors into cartridge code and
  never pushes registers. There is **no cartridge-type branch** in the button path.
- The firmware **can** pulse an NMI (`C64_MODE_NMI`), but **only the monitor uses it**; it is **not
  REST-exposed**, so we cannot NMI-into-a-cartridge via REST.
- `set_cartridge` alone does **not** arm a freezer without a reset.

So the user's "mount a capture cartridge, reset, capture" flow is blocked at the reset. The cartridge
is the wrong tool for capture.

### The capture method that DOES work (cartridge-free, injected CIA2 NMI)

Using only `pause`/`resume`/`readmem`/`writemem`, reproduce a freezer in RAM:

1. `pause`. **Save** (via `readmem`) the bytes we will overwrite: the NMI vector (`$0318/$0319` if
   KERNAL is banked in — read `$01` to decide — else `$FFFA/$FFFB`), a small handler region, CIA2
   registers, and a few free-stack bytes.
2. `writemem`: install a ~30–50-byte NMI handler (placed in the **free stack** region, below SP, which
   the program isn't using), point the NMI vector at it, and program **CIA2 Timer A** for a short
   underflow with Timer-A interrupt enabled (`$DD0D=$81`) — CIA2's interrupt line is wired to /NMI.
3. `resume`. The program runs a few cycles; the CIA2 NMI fires; the CPU pushes P/PCL/PCH; vectors via
   `$FFFA` → (KERNAL pushes A/X/Y →) our handler.
4. Handler: `TSX` to capture SP; copy the stacked P/PC (+A/X/Y) to a scratch area; ACK CIA2 ICR; set a
   "captured" flag; **spin** on a "release" flag (the program is now frozen at a transparent NMI point).
5. App polls the captured flag (`readmem`), then `readmem`s the scratch (→ PC/P/A/X/Y/SP) and all
   snapshot RAM. For the stored image, **substitute the saved originals** for the clobbered regions, so
   the snapshot reflects the program's true RAM. Record the **full stack page** and the captured SP.
6. Either leave the program frozen (resume = restore the snapshot), or, for transparency, restore the
   CIA2/vector/handler originals and set the release flag so the handler restores A/X/Y and `RTI`s back
   to the interrupted PC.

**Fragility / failure classes (why this needs a prototype):**

- Programs that point the NMI vector at an `RTI` (RESTORE-key defeat) — we override it, but a program
  that continuously rewrites/banks it can defeat capture.
- Programs that already use CIA2 NMI — conflict.
- Programs that bank out KERNAL and own `$FFFA` — we set `$FFFA` directly, but a banking change between
  setup and fire is a race.
- A user **Ultimax cartridge** that owns `$FFFA` — capture fails (cartridge-resident program).
- **Transparency repair** (continuing the program unaware) is finicky because the handler runs from RAM
  that is part of the snapshot; the simplest robust model is **"capture freezes the program; resume by
  restoring"**, sidestepping repair.
- The capture *point* is an arbitrary instruction boundary; because NMI is transparent, the captured
  state is still a *valid* CPU state — correctness holds even if the freeze point is not chosen.

## Existing REST-Only Temporary Cartridge Restore Feasibility

**Verdict: feasible via a custom uploaded Ultimax cartridge.** A reset is acceptable here.

Precondition: the snapshot contains RAM ranges **including the full stack page `$0100-$01FF`**, plus
CPU registers (PC, A, X, Y, SP, P) and `$01`.

1. (Optional) `GET .../Cartridge` to remember the configured cartridge for later re-application.
2. Generate a **minimal Ultimax `.crt`** for *this* snapshot (CRT header type 0, **EXROM=1, GAME=0**,
   one CHIP packet at `$8000`, `CBM80` signature + reset vector). Confirmed: such a cart **runs
   arbitrary 6502 at reset** (`c64_crt.cc:configure_cart`, `CART_TYPE_UMAX`). The snapshot's register
   values are baked in as immediates.
3. `POST /v1/runners:run_crt` with the `.crt` as a **binary upload** (no FTP) — this resets the C64 and
   runs our cart at `$8000`.
4. Cart: `SEI`, then spin on a release flag while the app `writemem`s the **entire RAM image** (incl.
   `$0100-$01FF`). Because the cart lives in **cartridge ROM**, no RAM is consumed by it — so *all* RAM
   is restorable verbatim. The app also writes the 3-byte **RTI frame** (P, PCL, PCH) into **free**
   stack bytes at/below the saved SP (these are not part of the program's live stack, so nothing is
   corrupted) — **(inference: standard freezer-restore stack arithmetic; SP points at the next free
   byte, bytes ≤ SP are free).**
5. App sets the release flag (`writemem` one byte). The cart copies a tiny **finalize stub into the
   free stack** and `JMP`s to it (mirroring `bootcrt`'s `$0150` stub, which exists precisely to survive
   disabling the cartridge). The stub: sets `X=SP-3; TXS`, loads A/X/Y immediates, restores `$01`
   banking, **disables the cartridge** (so `$8000+`/`$E000+` become the restored RAM), and `RTI`s —
   pulling P + PCL + PCH from the free-stack frame to resume at the saved PC with the saved registers.
6. App re-applies the user's configured cartridge via config/`run_crt` if desired (a further reset).

**What restore can and cannot reproduce:**

- **Can:** full RAM (incl. stack page), and PC/A/X/Y/SP/P — a true resume of a RAM-resident program at
  its exact instruction. Strictly better than today's RAM-only restore.
- **Cannot (inherent):** exact CIA timer phase / VIC raster / SID internal state (writemem hits live
  registers; the CIA-timer-latch hazard is the canonical example). Cycle-exact timing code may glitch
  on resume. It is an *improvement*, not a perfect machine snapshot.
- **Cannot:** restore a **cartridge-resident** program — the snapshot has no cartridge ROM, and our
  restore cart occupies the slot; re-mounting the user cart would reset away the restore.

## REST-Only Alternative Designs

| # | Approach | Capture? | Restore? | Cartridge-safe? | Risk | Recommendation |
|---|---|---|---|---|---|---|
| 1 | `pause`+`readmem`/`writemem` (today) | RAM only | RAM only | ignores cart | Low | Baseline; keep. |
| 2 | `debugreg` | No | No | n/a | — | Reject (8-bit FPGA byte). |
| 3 | **Injected CIA2 NMI** (cartridge-free) | **Yes (fragile)** | (paired with #4) | **transparent** to a non-controlling cart | Med–High | **Prototype** — the only capture path. |
| 4 | **Custom uploaded Ultimax `.crt`** via `POST run_crt` | No (reset) | **Yes** | resets+replaces slot | Med | **Prototype** — the restore path. |
| 5 | `run_prg`/`load_prg` helper PRG | No | weaker (cold BASIC/SYS, no clean SP/stack) | resets+boot-cart replaces slot | Med | Inferior to #4 for restore. |
| 6 | Menu/config cartridge save/restore | n/a | selection only | selection-safe | Low | Use for metadata only. |
| 7 | RAM-only + honest naming/metadata/flags | n/a | n/a | cart-aware warnings | Low | Fallback if #3 too fragile. |

`measure` (cartridge-bus VCD) is a one-shot ~256-cycle trace that **pauses** the machine — not a
practical CPU-state source. The continuous `streams:debug` bus trace **is** practical (see PBT below).
`debugreg` is an 8-bit FPGA byte. Firmware-native CPU endpoints are out of scope.

## Creative Mechanisms for Full CPU-State Capture & Restore (Ten Ideas, Graded)

This section answers the brief directly: enumerate vastly different ways to make **reliable** full
CPU-state capture **and** restore work over existing REST 1.1.0, grade them, then deep-dive the three
most likely. Capture is the hard half (restore is solved by an uploaded cartridge), so most mechanisms
differ in *how they get our code to run on the C64 non-destructively, or observe the CPU without
running anything at all*. A complete solution = one capture mechanism + one restore mechanism.

### The ten mechanisms

| # | Mechanism | Core trick | Covers | Pure REST primitives | Grade /10 |
|---|---|---|---|---|---|
| **RLI** | Ride the Live Interrupt | Hook the interrupt vector the program is **already** using; the next jiffy/raster IRQ (or NMI) enters our chained handler | Capture (RAM-resident, interrupt-driven) | `readmem`/`writemem`, `pause` | **8** |
| **ISN** | Injected NMI Source | Program **CIA2 Timer A → /NMI** (C64's own CIA, not the dead REST NMI reg) + RAM handler; non-maskable so works under `SEI` | Capture (RAM-resident, incl. IRQ-disabled) | `readmem`/`writemem` | **6** |
| **HWN** | Hardware NMI via RESTORE/input | Pulse RESTORE (→/NMI) through the input API into a pre-set vector | — | (none — **blocked**) | **1** |
| **PBT** | Passive Bus-Trace | Subscribe to the FPGA's **continuous live 6510 bus stream**; reconstruct registers offline with a self-verifying 6502 replay engine | Capture (**any** program incl. cartridge-resident; non-invasive) | `streams:debug`, `configs`, `pause`, `readmem` | **6** |
| **IAL** | Instrument At Launch | When the app launches content, co-install an agent that **owns the IRQ/NMI vectors before instruction 0** | Capture (app-launched RAM content — deterministic) | `run_prg`/`load_prg`, `writemem`, `machine/input` | **8** |
| **CFC** | Co-resident Freezer Cartridge | Mount a custom freezer cart at launch, freeze later | — | (no REST freeze trigger — **blocked**) | **2** |
| **CCI** | Cooperative Command-Interface agent | Resident agent talks to the Ultimate `$D7xx` command channel | Capture (cooperative only) | `configs`, agent | **4** |
| **NSF** | Native Save / Freezer-to-file | Use the Ultimate's own save/freeze, retrieve the file | — | (no CPU-state file; no file-download — **blocked**) | **1** |
| **CUR** | Custom Upload-cartridge Restore | Per-snapshot Ultimax `.crt`: spin, app DMAs RAM, finalize stub `set SP/A/X/Y/P; RTI` | **Restore** (RAM-resident) | `POST run_crt`, `writemem`, `readmem` | **9** |
| **IRR** | Injected-Resume Restore (no reset) | Symmetric to RLI/ISN: inject a stub via an interrupt that sets registers and `RTI`s — restore *in place* | Restore (RAM-resident, no reset glitch) | `readmem`/`writemem`, `pause` | **7** |

**Why the three blocked ones fail (all verified in firmware):**

- **HWN (1):** `route_input.cc` exposes only the keyboard matrix (a–z, 0–9, RETURN, RUN/STOP, f1–f10,
  modifiers). **RESTORE (F12→`matrix[9]`) and FREEZE (F11→`matrix[10]`) are not exposed**, and the FPGA
  `C64_MODE_NMI` pulse is monitor-only. No REST path asserts an NMI.
- **CFC (2):** mounting is fine at launch, but there is **no REST way to trigger the cart's freeze/NMI**
  later (HWN dead; the Ultimate freeze is a DMA halt that never vectors into cartridge code).
- **NSF (1):** native saves (`MENU_U64_SAVERAM`/`SAVEREU`/`SAVE_CARTRIDGE`) write **RAM/REU/cart ROM
  only — no CPU registers**, are **UI-only** (not REST), and the files API has **no download** endpoint.

**The three most likely complete strategies — `IAL+CUR`, `RLI+CUR` (ISN fallback), `PBT+CUR` — are
deep-dived next.** They are vastly different (launch-time instrumentation vs. runtime interrupt-ride
vs. passive observation) and together cover essentially every RAM-resident case, with PBT additionally
capturing cartridge-resident programs.

### Deep Dive 1 — IAL + CUR (deterministic but **origin-dependent — not used for this feature**)  · grade 8.5 (in scope)

> **Caveat (added after the origin-independence requirement):** IAL only works for content **the app
> itself launched**. The feature must snapshot *whatever is already running, however it was started*, so
> IAL is **not** a valid primary and is **not** built (see the implementation `prompt.md`). It is
> retained here as analysis: it is the *most deterministic* method *if* you control the launch, and the
> ideas (own the vectors, capture-now flag) carry over to RLI.

**Idea:** the app is the launcher for *some* content, so instrument it. Capture stops being "hope an
interrupt fires / hope the vector is hookable" and becomes "we installed our instrumentation before the
program ran."

**Capture setup (verified feasible):**
- `load_prg` (`RUNCODE_DMALOAD`=0x01) leaves the program in RAM at the BASIC **READY** prompt with the
  **KERNAL vectors `$0314/$0318` initialized and the ~60 Hz jiffy IRQ running** (`bootcrt.tas` calls
  `$E453/$E3BF/$E422`; clones vectors `$FD30→$0314`). So an injected `$0314` handler fires ~60×/sec.
- Two REST-only ways to install the agent + start the program:
  1. **Wrap-and-run:** ship the content as `[BASIC SYS stub] + [~64-byte agent] + [real program]` and
     `run_prg` (`RUNCODE_DMALOAD_RUN`=0x03, which auto-types RUN). RUN → `SYS` → agent runs **first**,
     saves the original vectors, installs our IRQ **and** NMI handlers, reserves a known scratch/agent
     region the app picks (it knows the content — e.g. `$C000` page), then `JMP`s to the real program.
  2. **Load-then-poke:** `load_prg`, then `writemem` the agent + vectors, then start via
     `POST /v1/machine/input` typing `RUN`↵ (BASIC) or a `SYS`↵ line (ML). Keyboard injection is
     confirmed available.
  *(Note: the cleanest path, `RUNCODE_DMALOAD_JUMP`=0x05 — boot cart `JMP ($00AA)` into our loader — is
  **not** REST-exposed; only 0x01/0x03 are. Hence the wrap/keyboard approaches above.)*
- As a backstop the agent also arms a CIA2 NMI, so capture works even if the program later `SEI`s and
  spins.

**Capture trigger (deterministic, no race):** on snapshot request the app sets a "capture-now" byte
(`writemem`); at the next interrupt our resident handler sees it, saves PC/P/A/X/Y/SP (PC+P already on
the stack from the interrupt; `TSX` for SP; A/X/Y from the KERNAL-pushed frame) into the reserved
scratch, and **spins** — freezing the program at a consistent point. App `readmem`s registers + RAM,
substituting the agent/scratch region's original bytes (saved at install) so the snapshot is clean.

**Restore: CUR.** (Or IRR for an in-place, no-reset resume that re-uses the same agent.)

**Reliability:** highest of all methods *within its scope* — we own the vectors from instruction 0, so
there is no vector-protection race and no "is an interrupt firing?" uncertainty. **Limits:** only
app-launched content (not arbitrary already-running state); the app must pick a scratch region the
content does not clobber (feasible since it controls the image); cartridge-resident content excluded.

### Deep Dive 2 — RLI + CUR, with ISN fallback (general, for arbitrary running RAM programs)  · grade 8

**Idea:** for a program already running that the app did *not* launch, don't create an interrupt —
**ride the one already firing.** Almost every C64 program keeps an interrupt live: BASIC/KERNAL
programs keep the 60 Hz jiffy IRQ (`$0314`); games run a raster IRQ every frame (`$0314`, or `$FFFE` in
RAM with KERNAL banked out); few disable all interrupts.

**Capture:**
1. `readmem` `$01` (banking) + the active interrupt vectors (`$0314/$0315`, `$0318/$0319`; if KERNAL
   banked out, the RAM `$FFFA/$FFFE`) + a free-stack region.
2. `writemem` a small handler into **free stack** (below SP — bytes the program isn't using) and
   **atomically** repoint the in-use vector (a single `writemem` is atomic from the CPU's view because
   the DMA write pauses the CPU). Chain to the original handler so the program's own interrupt still
   works.
3. The next natural interrupt (≤~20 ms away) enters our handler → save PC/P/A/X/Y/SP to scratch, set a
   captured flag, spin (freeze). App polls, `readmem`s registers + RAM, repairs clobbered regions.
4. Release → handler restores the original vector and `RTI`s (transparent), or stays frozen for restore.

**ISN fallback (SEI tight loop, no interrupt firing):** `writemem`-program **CIA2 Timer A** for a short
underflow with the Timer-A NMI enabled (`$DD0D=$81`); the C64's own CIA2 asserts **/NMI** (non-maskable;
works under `SEI`) — independent of the dead REST NMI register. Point `$0318`/`$FFFA` at our handler and
proceed as above.

**Restore: CUR / IRR.**

**Reliability:** high for the (large) interrupt-driven class; "ride existing" is far less conflict-prone
than "inject new". **Failure classes** (drive the fragility matrix): programs that continuously
rewrite/protect their vectors; programs already using CIA2 NMI (ISN conflict); KERNAL-banked-out timing
races; **cartridge-resident programs** (Ultimax owns the vectors — use PBT instead).

### Deep Dive 3 — PBT + CUR (universal, non-invasive; the "don't give up" path)  · grade 6–7

**Idea:** never touch the running machine — **watch the CPU bus** and reconstruct the registers. The
FPGA already exposes exactly this: a **continuous live 6510 bus stream**.

**Capture:**
1. `PUT /v1/configs/Data Streams/Stream Debug to` = the app's `IP:port`; `PUT
   /v1/configs/Data Streams/Debug Stream Mode` = **"6510 Only"** (other modes add VIC/1541).
2. `PUT /v1/streams/debug:start`. The FPGA emits the live 6510 bus (Addr/Data/R-W) over **UDP**
   continuously **while the C64 runs untouched** — fully passive (unlike `measure`, which pauses).
3. The app records a rolling window. A **6502 bus-replay engine** consumes it: **PC** is directly the
   opcode-fetch address; **A/X/Y** fall out of observed loads/transfers; **SP** from any stack op
   (push/pull/JSR/RTS/IRQ); **P** is fully revealed by any `PHP` or interrupt (which pushes P to a
   bus-visible stack write). The engine is **self-verifying** — its predicted next bus cycle must match
   the observed one; a mismatch flags a dropped packet and triggers re-lock.
4. When all registers are locked, `pause`. The bus stops advancing, so the reconstructed state at the
   last completed instruction **aligns** with a `readmem` of RAM taken while paused. `resume` (or hold
   for restore).

**Restore: CUR** (PBT is capture-only).

**Why it's uniquely valuable:** it is the **only** capture method with **zero perturbation** and
**universal coexistence** — it works for `SEI` loops, vector-protected programs, and even
**cartridge-resident** programs (every other method fails there), all without disturbing a mounted
cartridge. This is the closest thing to the "reliable, entire CPU state, no compromise" ideal.

**Costs / risks (why it's a stretch, not the default):**
- **Undocumented UDP payload format** — the single biggest unknown; must be reverse-engineered from
  `data_streamer.cc`/FPGA or by live capture (cycle granularity, fetch-vs-operand markers, timestamps).
- The app device must **receive UDP** (Android: open a socket / set unicast to the phone, or join the
  default multicast `239.0.1.66:11002`).
- **Packet loss → desync** (mitigated by the self-verifying replay + re-lock; wait for re-lock before
  pausing).
- **Continuous UDP load** on the fragile C64U network stack — watch the known TCP-wedge risk; prefer
  short capture windows.
- Register **lock latency** is unbounded in the worst case (must wait for a `PHP`/interrupt to pin `P`)
  — but the stream is unbounded, so you simply wait.

### Reliability strategy (combining them)

Because the feature must be **origin-independent**, the production design centers on **RLI (+ISN)** for
any already-running RAM program, with **PBT** as the universal, non-invasive extension (the only capture
for cartridge-resident / anti-freeze programs), and **CUR** for restore in all cases. **IAL is not used**
(origin-dependent). Every capture is **verified** (the RLI handler can checksum; PBT's replay
self-verifies), so a false capture is detectable rather than silently stored — the core reliability
guarantee. See `prompt.md` for the committed implementation plan.

## Snapshot File Format Implications

Bump `.c64snap` `version 1 → 2` (use the existing `flags` u16 + JSON tail; v1 readers tolerate an
absent tail). For CPU-state snapshots add to the JSON metadata / a new fixed sub-block:

- **CPU state:** `pc` (u16), `a`,`x`,`y`,`sp`,`p` (u8 each). Store `pc` little-endian to match the
  format's existing u16 convention; `p` as the raw flags byte (`N V - B D I Z C`) plus a decoded map
  for readability.
- **Mandatory full stack page:** CPU-state snapshots **must** include `$0100-$01FF` and `$01` (today's
  "Program" type excludes the stack — that must change for CPU snapshots).
- **Capability metadata:** `firmware {product, firmware_version, fpga_version, core_version,
  api_version}` (from `/v1/info` + `/v1/version`), `cpu_state_captured: bool`, and a
  `capture_method`/`restore_method` tag.
- **Cartridge metadata:** `cartridge {configured_name, was_active, ram_resident_assumed: true}`. Refuse
  (or loudly warn) CPU restore if a different/cartridge-resident context is detected.
- **Versioning/back-compat:** v1 RAM-only snapshots keep working; v2 adds optional CPU/stack/capability
  blocks; restore checks `cpu_state_captured` and the firmware capability before offering a CPU resume.

## C64 Commander Changes Required

App-only; no firmware work.

- **REST client (`src/lib/c64api.ts`):** add `runCrtUpload(bytes)` (`POST /v1/runners:run_crt`,
  octet-stream), `getInfo()`/`getApiVersion()`, `getCartridgeConfig()`/`setCartridgeConfig()`. Reuse
  existing `readMemory`/`writeMemoryBlock`/`machinePause`/`machineResume`.
- **CRT builder (new, `src/lib/snapshot/restoreCart.ts`):** generate a per-snapshot minimal Ultimax
  `.crt` (CUR) with baked PC/A/X/Y/SP/P + the spin/finalize 6502 stub. Pure function, fully
  unit-testable.
- **Capture engines (new), one per strategy, behind a common interface:**
  - **IAL** — a 6502 agent + vector-installer (assembled to bytes, baked into the launch image or
    `writemem`'d after `load_prg`), plus the launch glue (`run_prg` wrap or `load_prg` + `machine/input`
    SYS/RUN) and the capture-now/freeze handshake.
  - **RLI/ISN** — the vector-hook + chained handler over `pause`/`writemem`/`readmem`, with the CIA2-NMI
    fallback, save/restore of clobbered regions, and a "frozen vs transparent" flag.
  - **PBT** — a UDP receiver + **6502 bus-replay reconstruction engine** (the bulk of the work; fully
    unit-testable against recorded traces) and the `streams:debug` config/start/stop orchestration.
  - All engines emit the same `{pc,a,x,y,sp,p, ram[]}` result and a self-verification/confidence flag.
- **Snapshot format (`snapshotFormat.ts`, `snapshotTypes.ts`):** v2 with CPU/stack/capability/cartridge
  blocks; keep v1 read support.
- **Capability + cartridge gating:** detect firmware/version; read configured cartridge before
  capture/restore; **block or warn** when a cartridge is the running context; never show a CPU-resume
  affordance unless `cpu_state_captured`.
- **UI:** distinguish "RAM snapshot" vs "CPU+RAM snapshot"; restore dialog surfaces method, firmware,
  cartridge, and the RAM-resident-only limitation.
- **Tests/fixtures:** drive from the supplied OpenAPI/config fixtures (below).

## Out-of-Scope Firmware Gaps

*Descriptive only — not implementation work.* A clean, robust solution (especially for **capture**)
would want firmware to add and REST-expose:

- **Atomic freeze-and-read CPU state** (the single biggest gap; would make capture reliable instead of
  fragile) and **atomic write-CPU-state-and-resume**.
- A **REST-triggerable NMI** that vectors into a chosen handler/cartridge without reset (the
  `C64_MODE_NMI` register already exists internally; it is simply not REST-exposed).
- **REST-visible 6510 register file** on U64 (the soft-core could expose it) / NMI-capture on U2.
- **Save/restore of live cartridge state** (cart RAM, banks, EXROM/GAME, freeze) to support
  cartridge-resident programs and true coexistence.
- A **firmware-native snapshot/freeze format** over REST (today's internal freeze omits CPU registers).

## Testing Strategy

Designed so a false "CPU state works" pass is hard, and so the RAM-resident limitation is enforced.

- **Unit (app):** `.crt` builder produces a valid Ultimax CRT (header type 0, EXROM=1/GAME=0, CBM80
  sig) with correct baked registers; v2 format round-trip incl. CPU/stack blocks; capability detection
  from mocked `/v1/info`+`/v1/version`; **negative test** that no CPU-resume UI appears when
  `cpu_state_captured=false`.
- **Integration (mocked firmware from fixtures):** capture issues only `pause`/`writemem`/`readmem`/
  `resume`; restore issues `POST run_crt` + `writemem` + handshake `readmem`; restore never writes CIA
  timer registers; both warn when the mocked `Cartridge` config is non-empty.
- **HIL (real C64U 1.1.0; u64=192.168.1.13, c64u=192.168.1.167):**
  - **Capture proof:** a test PRG sets a *distinctive* CPU state (known A/X/Y/SP, a known PC in a tight
    loop, a chosen flag pattern) and a RAM canary; capture; verify the read-back registers exactly
    match the known values and the RAM canary matches.
  - **Restore proof:** from a captured/handcrafted snapshot, run the restore `.crt`; verify execution
    resumes at the saved PC with the saved A/X/Y/SP/P (the resumed program writes its observed
    registers to a canary the app then `readmem`s) and full RAM (incl. stack page) matches.
  - **Round-trip:** capture → perturb → restore → identical CPU+RAM (and cursor-blink/jiffy rate
    unchanged — the proven hazard).
  - **Fragility matrix (capture):** programs with NMI-vector-as-RTI, programs using CIA2 NMI, programs
    with KERNAL banked out (own `$FFFA`), IRQs enabled vs disabled, RAM-under-ROM. Record which classes
    pass — a **false pass must be hard**, so assert exact register equality, not "didn't crash".
  - **Cartridge coexistence (prove BOTH):** (1) the snapshot captured what it claims; (2) for capture,
    a merely-present non-controlling cartridge is **untouched** afterward (`GET .../Cartridge`
    unchanged, cart still works); **negative:** capture is **refused/warned** when a cartridge is the
    running context.
  - **Restore cart hygiene:** after restore, the temporary cart is gone and the configured cartridge is
    re-applied (selection); confirm no orphaned cart.
  - **Per-mechanism HIL:**
    - **IAL:** launch an agent-wrapped PRG; verify the agent owns `$0314/$0318`, a capture-now flag
      freezes deterministically within one frame, and the read-back registers match a known value the
      agent stored. Repeat across BASIC and ML autostart layouts.
    - **RLI/ISN:** test against (a) a BASIC program (jiffy IRQ), (b) a raster-IRQ game, (c) a `SEI` tight
      loop (must fall back to ISN/CIA2-NMI). Assert exact register capture and transparent resume.
    - **PBT:** record the `streams:debug` "6510 Only" UDP feed; first **reverse-engineer the payload**
      (a known instruction-loop PRG gives a ground-truth bus to decode against); then prove the replay
      engine reconstructs PC/A/X/Y/SP/P that match the IAL/RLI capture of the *same* program at the same
      pause point; prove it also captures a **cartridge-resident** program that RLI cannot.
  - **Degradation/log capture:** watch for the C64U TCP wedge after heavy DMA **and under continuous UDP
    streaming** (PBT); wait out 60–120 s stalls.
- **Negative:** assert there is no REST path returning CPU registers (so the app never silently relies
  on one), and that v1 RAM-only snapshots still restore.

## Risks and Mitigations

| Risk | Severity | Likelihood | Mitigation | Blocks? |
|---|---|---|---|---|
| Capture fragility (single method) | Med | Med | **Three independent capture paths** (IAL/RLI/PBT) + per-class gating; IAL is deterministic for app-launched content | No (mitigated by redundancy) |
| IAL: content clobbers our agent/scratch region | Med | Low–Med | App picks a region the known content avoids; agent re-hooks vectors; checksum-verify capture | No |
| PBT: undocumented UDP payload format | High | High (until RE'd) | Reverse-engineer from `data_streamer.cc` + ground-truth loop PRG; self-verifying replay; treat PBT as stretch goal | Blocks PBT only |
| PBT: UDP packet loss / continuous-stream device load | Med | Med | Self-verify + re-lock; short capture windows; monitor TCP-wedge | No |
| Cartridge-resident program (restore) | High | Certain for that class | PBT can capture; restore still needs cart ROM → detect + refuse/warn; document RAM-resident-only | Blocks restore of that class only |
| Restore resumes on imperfect chip state (CIA/VIC/SID) | Med | Med | Document; keep CIA-timer skip; accept "resume", not "cycle-perfect" | No |
| Injected NMI corrupts the live program (transparency) | High | Med | Prefer "freeze on capture, resume by restore" model | No (design choice) |
| `run_crt` resets/replaces the user cartridge on restore | Med | Certain | Read+re-apply configured cart; frame restore as a new session | No |
| Firmware/listener crash or TCP wedge from heavy DMA | High | Low–Med | Bounded concurrency, liveness checks, wait-out | No |
| Live-I/O round-trip corruption (CIA timers) | Med | Med | Keep timer-register skip | No |
| Misleading "CPU restored" claim when unsupported | High | Med | `cpu_state_captured` flag + capability gating; no affordance otherwise | No |
| Custom `.crt` malformed → boot failure | Med | Low | Strict CRT builder unit tests; HIL boot check | No |
| Snapshot format incompat | Low | Low | v2 + v1 read support | No |
| Cross-target (`debugreg` U64-only; bus arbitration) | Med | Med | Never depend on `debugreg`; capability detect | No |
| Maintenance burden (6502 stubs + format) | Med | Med | Keep stubs tiny + table-tested; isolate in one module | No |

## Open Questions

- **PBT debug-stream UDP payload format** — undocumented in the fixtures; the gating unknown for the PBT
  path. Needs reverse-engineering from `data_streamer.cc`/FPGA or a ground-truth loop-PRG capture
  (cycle granularity, opcode-fetch vs operand markers, packet timestamps/sequence). Also confirm which
  FPGA builds carry the debug stream and how to receive it on the app device.
- **Capture reliability across real software** — only a HIL fragility matrix can answer it; reduced (not
  eliminated) by having three independent capture paths.
- **IAL safe-region selection** — confirm the app can reliably reserve an agent/scratch region per
  content type without the program clobbering it; define the re-hook strategy if it does.
- **Timing of `PUT .../Cartridge`** (immediate vs on reset) — affects re-applying the user cartridge
  after restore; needs a probe. *(inference: applies on next cartridge start/reset.)*
- **Exact free-stack budget for the finalize stub** when SP is unusually low — verify on HIL; abnormal
  but worth a guard.
- **U2 vs U64 NMI/CIA emulation parity** for the injected-NMI capture — verify both; mechanism is
  expected identical (CIA2→/NMI is standard).

## Final Recommendation

- **`Needs REST-only prototype before decision`** — but with **higher confidence than Rev 2**, because
  capture has **three independent REST-only paths**, not one fragile trick. Prototype in this order:
  1. **IAL + CUR** — deterministic capture for app-launched content (own the vectors before instruction
     0) + uploaded-cartridge restore. Highest reliability, lowest cost, covers the dominant use case.
  2. **RLI + CUR (ISN fallback)** — capture arbitrary already-running RAM programs by riding their live
     interrupt (CIA2-NMI fallback for `SEI` loops).
  3. **PBT + CUR** — the universal, non-invasive capture (passive 6510 bus stream + 6502 replay), the
     only one that also handles cartridge-resident programs; gated on reverse-engineering the
     debug-stream UDP format.
- **Restore is the solved half** for all three (`POST run_crt` upload + `writemem` RAM + finalize
  `set SP/A/X/Y/P; RTI`; precedent `bootcrt.tas`).
- **Three blocked ideas were ruled out with evidence:** HWN (no REST RESTORE/NMI), CFC (no REST freeze
  trigger), NSF (native saves omit CPU regs, UI-only, no file download).
- **A full round-trip is RAM-resident-only.** PBT can additionally *capture* cartridge-resident programs,
  but they cannot be *restored* (no cartridge ROM in the snapshot) — out of reach without firmware
  changes (out of scope).
- **Credit where due:** the original "capture/restore cartridge" instinct is exactly right for
  **restore**; for **capture** the better tools are launch instrumentation, interrupt-riding, and
  passive bus observation.
- **No firmware changes** are required for any path; the clean long-term fix for fully reliable,
  universal capture (atomic freeze-and-read CPU state) is firmware-side and explicitly out of scope.

## Appendix: Code References

### C64 Commander (this repo)
- `src/lib/machine/ramOperations.ts` — `dumpRamRanges` (295), `loadMemoryRanges` (422),
  `writeSnapshotRange` (372), `runPaused` (243), `isCiaTimerRegister` (35). *(read first-hand)*
- `src/lib/snapshot/{snapshotFormat,snapshotCreation,snapshotStore,snapshotTypes}.ts` — `.c64snap` v1
  codec, range resolvers, localStorage, metadata type (no CPU/cart fields).
- `src/lib/c64api.ts` — `readMemory`, `writeMemoryBlock`, `machinePause/Resume/Reset/Reboot` (~2026-2180).
- `src/pages/home/hooks/useHomeActions.ts` (171-211); `SnapshotManagerDialog.tsx`,
  `RestoreSnapshotDialog.tsx`.
- Tests: `tests/unit/machine/screenSnapshotRoundtrip.test.ts`; `tests/unit/lib/snapshot/*.test.ts`;
  `playwright/ramSnapshot.spec.ts`.

### C64U firmware 1.1.0 (`../1541ultimate`, evidence only)
- `software/api/route_machine.cc` — pause/resume/readmem/writemem/debugreg/measure. *(read first-hand)*
  `pause`→`MENU_C64_PAUSE` (47); `readmem`→`C64_DMA_RAW_READ` (189); `writemem`→`C64_DMA_RAW_WRITE`
  (120/158); `debugreg`→`U64_DEBUG_REGISTER` (223-240, `#if U64`).
- `software/api/route_runners.cc` — `run_prg`/`load_prg`→`FileTypePRG::start_prg` (46-74); **`run_crt`
  PUT (file) + POST (binary upload)** → `C64_CRT::load_crt` + `C64_START_CART` (79-102). *(read first-hand)*
- `software/io/c64/c64_subsys.cc` — `dma_load` (598-678; boot cart 627-628; handshake 638-668;
  `restoreCart` 676); `restoreCart` (175-196, `set_cartridge(NULL)`); `C64_START_CART`→`start_cartridge`
  (287-293); `C64_DMA_RAW_READ/WRITE` (572-596). *(read first-hand)*
- `software/io/c64/c64.cc` — `C64::stop` (463); `C64::freeze`→`stop(true)` (889; DMA halt, not NMI);
  `start_cartridge` (1035-1102; `hard_stop` 1041, `C64_MODE_RESET` 1057, `set_cartridge` 1096, unreset
  1098); `CFG_C64_DMA_ID` (448). `C64_MODE_NMI`=0x10 (`c64.h:73`).
- `software/io/c64/c64.h` — backup struct (284-288: VIC/CIA/RAM/screen/color, **no CPU regs**);
  `cart_def` (261-271); RUNCODE_* defines (95-109).
- `software/io/c64/c64_crt.cc` — `check_header` (166-209), `read_chip_packet` (211-317),
  `configure_cart`→`CART_TYPE_UMAX` for type-0/EXROM=1/GAME=0 (460-467): **custom Ultimax `.crt` runs
  arbitrary 6502 at reset**.
- `software/6502/bootcrt.tas` — boot cart: handshake on `$0002` (489-514), JUMP = bare `JMP ($00AA)`
  via a RAM stub at `$0150` (jumper_code, ~150-187), RUNCODE_* bits (27-42). **The restore precedent.**
- `software/monitor/monitor_file_io.cc` — `C64_MODE_NMI` pulse (161-167), **monitor-only, not REST**.
- `software/system/u64.h` — `U64_DEBUG_REGISTER` (101), `C64_IO_DEBUG=U2P_IO_BASE+0x81800` (52).
- `software/u64/u64_machine.h` — `peek_cpu/poke_cpu/read_cpu_block` are *memory* accessors.
- **(Rev 3) Input (HWN/IAL):** `software/api/route_input.cc` — `GET/POST /v1/machine/input` (395-399),
  `key_code_for_name` (143-218): keyboard matrix + RUN/STOP + f1–f10 + modifiers, **no RESTORE/FREEZE/
  joystick**; `keyboard_usb.cc` — F12→RESTORE `matrix[9]` (254-272), F11→FREEZE `matrix[10]` (USB only).
- **(Rev 3) Streams (PBT):** `software/api/route_streams.cc` — stream registry `video/audio/debug` →
  IDs 0/1/2 (9-14); `software/io/network/data_streamer.cc` — debug-stream modes incl. **"6510 Only"**
  (25-26), UDP transport/destination. `route_machine.cc:measure` (315-346) **pauses** the machine
  (`c64.cc:1658-1737`, `CAPAB_BUS_MEASURE` gate at 319) — not passive.
- **(Rev 3) Launch (IAL):** `software/filetypes/filetype_prg.cc:198-203` — `start_prg` run_code 0x01
  (load) vs 0x03 (run); `bootcrt.tas` — READY-prompt exit + KERNAL vector clone `$FD30→$0314`
  (~525-656); only 0x01/0x03 reachable via REST (0x05 JUMP is not).
- **(Rev 3) Native save (NSF, dead):** `c64_subsys.cc` — `MENU_U64_SAVERAM` (343-370, RAM only),
  `MENU_C64_SAVEREU` (295-341), `MENU_C64_SAVE_CARTRIDGE` (372-387) — all **UI-only, no CPU regs**;
  `software/api/route_files.cc` — info/create only, **no download endpoint**.

### Supplied fixtures
- `docs/c64/c64u-openapi.yaml` — endpoints; schemas `MemoryDebugResponse` (single `value`, "$D7FF"),
  `RunnerActionResponse`, `MachineActionResponse`, `InfoResponse`, `VersionResponse`; `run_crt` PUT/POST.
- `docs/c64/c64u-config.yaml` (= `devices/c64u/1.1.0/c64u-config.yaml`) — `C64 and Cartridge Settings`:
  `Cartridge`, `Cartridge Preference`, `Bus Operation Mode`, `Bus Sharing - *`, `RAM Expansion Unit`,
  `DMA Load Mimics ID:` (8-31), `Command Interface`.
