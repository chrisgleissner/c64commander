# RAM Snapshot Constraints

This note records the current engineering contract for C64 RAM snapshots over
the C64 Ultimate / Ultimate 64 network APIs.

## What We Can Reliably Do

- Pause the machine through REST, read selected C64 address ranges, write those
  same ranges back, and resume.
- Save program snapshots as `$0000-$00FF` plus `$0200-$FFFF`, deliberately
  excluding the stack page.
- Restore I/O state that is stable and useful, including VIC registers, colour
  RAM, SID state that the firmware exposes through the visible address aperture,
  and CIA2 `$DD00/$DD01` for the VIC bank.
- Skip CIA timer registers `$xx04-$xx07` and mirrors on restore. The firmware
  reads live timer down-counters there, while writes program the timer latches;
  writing captured down-counter values back into CIA1 Timer A changes the jiffy
  IRQ rate and visibly speeds up the cursor blink on repeated restores.

## What We Cannot Promise Through The Public REST API

- We cannot restore a true freezer state for an arbitrary running game.
- The public machine REST routes expose pause, resume, reset, raw memory read,
  raw memory write, menu screen, and U64 `$D7FF` debug-register access. They do
  not expose the 6510 program counter, stack pointer, A/X/Y registers, status
  flags, or a "resume at captured PC" operation.
- U64 `debugreg` is a byte latch at `$D7FF`. It is useful for diagnostics, not
  CPU context capture.
- A short debug-stream capture can show recent bus activity and may help infer
  where code was executing, but it does not directly provide A, X, Y, SR, or SP.
  Any inferred PC would be probabilistic unless the firmware exposes stronger
  cycle metadata and an app-native UDP capture path.

## Why The Stack Page Is Not Preserved

The stack page is only safe to restore if the stack pointer and return context
are restored with it. With the public REST API, the CPU resumes from its current
paused PC and current SP, not from the captured PC/SP. Overwriting `$0100-$01FF`
can therefore corrupt the live call/interrupt stack the machine will return to
after resume. Excluding the stack page is the safer default and gives the best
chance of a useful restore under the available API.

## Action Replay / Freezer Cartridge Comparison

Action Replay and similar freezer cartridges solve a different problem with
different privileges. They can enter through cartridge hardware, NMI/Ultimax
mapping, and cartridge-controlled execution. Action Replay's monitor explicitly
exposes the frozen-time PC, A, X, Y, stack pointer, status register, and a GO
operation using the displayed registers. That is why those cartridges can make
stronger resume claims than this app can through REST-only memory access.

The 1541ultimate source has internal monitor/freezer support that is much closer
to the freezer model. `MonitorDebug::DebugContext` contains PC, A, X, Y, SR, and
SP, and the BRK debug session uses a cassette-buffer stub area around
`$0363-$03FB` to capture and resume context. That machinery is not exposed by
the current public REST machine routes, so the app cannot depend on it.

## Rejected Product Shortcut: Reload Then Overlay

Remembering the loaded program and reloading it before applying a RAM snapshot is
not a reliable substitute for CPU context restore. It may help a narrow class of
programs if the app can re-enter the same stable loop before overlaying memory,
but it still resumes with the CPU state that exists at overlay time. For games
with loaders, IRQ/raster timing, self-modifying code, drive-side code, or
non-idempotent initialization, this is not defensible without a separate design
and HIL test matrix.

The current product wording and tests should therefore treat RAM snapshots as
"memory/I/O restore" snapshots, not full emulator-style save states.
