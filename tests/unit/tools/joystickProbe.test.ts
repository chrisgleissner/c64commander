/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * `tools/c64/joystick-probe.prg`, executed.
 *
 * The probe is the instrument every joystick claim on real hardware is measured
 * with, so a defect in it reads as a defect in the app. Until now nothing checked
 * it at all: the only thing that ran it was the HIL harness, which needs a C64 on
 * the network and is therefore never part of a CI run.
 *
 * This runs the COMMITTED binary — the same bytes `runners:run_prg` uploads — in a
 * 6502 interpreter, drives `$DC00` as a joystick would, and reads the result back
 * out of the probe's own telemetry and out of screen RAM. It is not a substitute
 * for `tools/hil/joystick_hold_hil.mjs`, which proves the app can actually deliver
 * a held direction to a real machine; it proves the machine end does the right
 * thing with one when it arrives.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { C64TestBus, joystickMask, loadPrg, Mos6502, runFrames, type JoystickState } from "../../helpers/mos6502";

const REPO = path.resolve(__dirname, "..", "..", "..");
const PRG_PATH = path.join(REPO, "tools", "c64", "joystick-probe.prg");
const ASM_PATH = path.join(REPO, "tools", "c64", "joystick-probe.asm");

/** Telemetry offsets from $C000. Keep in step with joystick-probe.asm's header. */
const TELEMETRY_BASE = 0xc000;
const T = {
  col: 0,
  row: 1,
  colour: 2,
  fires: 3,
  moves: 4,
  up: 5,
  down: 6,
  left: 7,
  right: 8,
  lastMask: 9,
  heldMask: 10,
  magic1: 11,
  magic2: 12,
  frames: 13,
  repeats: 14,
  holdFrames: 15,
  repeatDelay: 16,
  repeatRate: 17,
} as const;

const SCREEN_BASE = 0x0400;
const COLOUR_BASE = 0xd800;
const CIRCLE_SCREEN_CODE = 0x51;
const BLANK_SCREEN_CODE = 0x20;

/** `settle` discards 50 frames; a margin past that puts the loop in its steady state. */
const SETTLE_FRAMES = 60;

type Telemetry = Record<keyof typeof T, number>;

const readTelemetry = (bus: C64TestBus): Telemetry =>
  Object.fromEntries(
    Object.entries(T).map(([name, offset]) => [name, bus.memory[TELEMETRY_BASE + offset]]),
  ) as Telemetry;

const screenCodeAt = (bus: C64TestBus, col: number, row: number) => bus.memory[SCREEN_BASE + row * 40 + col];
const colourAt = (bus: C64TestBus, col: number, row: number) => bus.memory[COLOUR_BASE + row * 40 + col] & 0x0f;

interface Probe {
  bus: C64TestBus;
  hold: (state: JoystickState, frames: number) => Telemetry;
  telemetry: () => Telemetry;
}

/** Start the probe and run it past its settle window, as `run_prg` plus a wait does. */
const startProbe = (): Probe => {
  const bus = new C64TestBus();
  const cpu = new Mos6502(bus);
  const { sysAddress } = loadPrg(bus, new Uint8Array(readFileSync(PRG_PATH)));
  cpu.jumpTo(sysAddress);
  runFrames(cpu, bus, SETTLE_FRAMES);

  return {
    bus,
    hold: (state, frames) => {
      bus.joystick = joystickMask(state);
      runFrames(cpu, bus, frames);
      return readTelemetry(bus);
    },
    telemetry: () => readTelemetry(bus),
  };
};

/**
 * The moves a hold of `frames` frames earns, from the cadence the MACHINE published.
 *
 * Derived rather than tabulated, and derived from `$C010`/`$C011` rather than from
 * constants copied out of the source: the assertion then holds if the cadence is
 * retuned, and still fails if the repeat stops happening.
 *
 * One move lands on the press. If the direction is still held `delay` frames later
 * the second lands, and one more every `rate` frames after that.
 */
const expectedMoves = (frames: number, delay: number, rate: number): number => {
  if (frames < 1) return 0;
  const firstRepeat = 1 + delay;
  if (frames < firstRepeat) return 1;
  return 2 + Math.floor((frames - firstRepeat) / rate);
};

describe("joystick-probe.prg — it starts, and says so", () => {
  it("publishes its magic, its cadence and a circle in the middle of the screen", () => {
    const probe = startProbe();
    const telemetry = probe.telemetry();

    expect(telemetry.magic1).toBe(0x4a);
    expect(telemetry.magic2).toBe(0x50);
    expect(telemetry.col).toBe(20);
    expect(telemetry.row).toBe(12);
    expect(telemetry.colour).toBe(1);
    expect(telemetry.moves).toBe(0);
    expect(telemetry.fires).toBe(0);
    // The frame counter is what tells a harness the probe is still running rather
    // than stopped with the right numbers left behind in RAM.
    expect(telemetry.frames).toBeGreaterThan(0);
    expect(telemetry.repeatDelay).toBeGreaterThan(0);
    expect(telemetry.repeatRate).toBeGreaterThan(0);
    expect(screenCodeAt(probe.bus, 20, 12)).toBe(CIRCLE_SCREEN_CODE);
  });

  it("draws its banner, which is how a harness knows it is the right program", () => {
    const probe = startProbe();
    const banner = Array.from({ length: 8 }, (_, index) =>
      String.fromCharCode(probe.bus.memory[SCREEN_BASE + index] + 64),
    ).join("");
    expect(banner).toBe("JOYPROBE");
  });
});

describe("a held direction keeps moving the circle", () => {
  it("moves one cell on the press and keeps going while the direction is held", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();
    const heldFrames = repeatDelay + repeatRate * 6;

    const pressed = probe.hold({ left: true }, 1);
    expect(pressed.moves).toBe(1);
    expect(pressed.col).toBe(19);

    const held = probe.hold({ left: true }, heldFrames - 1);
    expect(held.moves).toBe(expectedMoves(heldFrames, repeatDelay, repeatRate));
    expect(held.moves).toBeGreaterThan(1);
    expect(held.col).toBe(20 - held.moves);
    expect(held.row).toBe(12);
    // The display is what the player sees, so it is asserted alongside the counters:
    // a probe that moved its own state without redrawing would otherwise pass.
    expect(screenCodeAt(probe.bus, held.col, 12)).toBe(CIRCLE_SCREEN_CODE);
    expect(screenCodeAt(probe.bus, held.col + 1, 12)).toBe(BLANK_SCREEN_CODE);
    expect(colourAt(probe.bus, held.col, 12)).toBe(held.colour);
  });

  it("counts the hold in frames, and the repeats it delivered", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();
    const heldFrames = repeatDelay + repeatRate * 4;

    const held = probe.hold({ right: true }, heldFrames);
    expect(held.holdFrames).toBe(heldFrames);
    expect(held.repeats).toBe(held.moves - 1);
    expect(held.heldMask).toBe(0x08);
  });

  it("stops the moment the direction is released, and starts a fresh delay next time", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();

    const held = probe.hold({ up: true }, repeatDelay + repeatRate * 3);
    const released = probe.hold({}, 40);

    expect(released.moves).toBe(held.moves);
    expect(released.row).toBe(held.row);
    expect(released.holdFrames).toBe(0);
    expect(released.heldMask).toBe(0);

    // The next press pays the full delay again rather than inheriting the last
    // hold's countdown, which is what stops a tap after a hold running away.
    const tapped = probe.hold({ up: true }, 1);
    expect(tapped.moves).toBe(held.moves + 1);
  });

  /**
   * The discriminating case. Before the probe repeated, a press and a long hold both
   * moved the circle exactly one cell — so a test that only asserted "the circle
   * moved" passed either way. These two assertions differ between the two versions.
   */
  it("moves further for a long hold than for a tap, which the one-cell-per-press probe did not", () => {
    const tap = startProbe();
    const tapped = tap.hold({ left: true }, 1);
    tap.hold({}, 5);

    const hold = startProbe();
    const { repeatDelay, repeatRate } = hold.telemetry();
    const heldFrames = repeatDelay + repeatRate * 10;
    const held = hold.hold({ left: true }, heldFrames);

    expect(tapped.moves).toBe(1);
    expect(held.moves).toBeGreaterThan(tapped.moves);
    expect(20 - held.col).toBe(held.moves);
  });

  it("repeats both directions of a diagonal on the same tick", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();
    const heldFrames = repeatDelay + repeatRate * 5;

    const held = probe.hold({ up: true, left: true }, heldFrames);
    const steps = expectedMoves(heldFrames, repeatDelay, repeatRate);

    expect(held.up).toBe(steps);
    expect(held.left).toBe(steps);
    expect(held.col).toBe(20 - steps);
    expect(held.row).toBe(12 - steps);
    // Two directions per tick, so the circle travelled twice as many cells as it
    // took steps — `MOVES` counts cells and the direction counters count events.
    expect(held.moves).toBe(steps * 2);
    expect(screenCodeAt(probe.bus, held.col, held.row)).toBe(CIRCLE_SCREEN_CODE);
  });

  it("keeps counting the direction at the screen edge while the circle stays put", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();
    // Far more than the 20 columns between the circle and the left edge.
    const heldFrames = repeatDelay + repeatRate * 40;

    const held = probe.hold({ left: true }, heldFrames);
    const steps = expectedMoves(heldFrames, repeatDelay, repeatRate);

    expect(held.col).toBe(0);
    expect(held.moves).toBe(20);
    expect(held.left).toBe(steps);
    expect(held.left).toBeGreaterThan(held.moves);
    expect(screenCodeAt(probe.bus, 0, 12)).toBe(CIRCLE_SCREEN_CODE);
  });
});

describe("fire stays one event per press", () => {
  it("advances the colour once however long fire is held", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();

    const held = probe.hold({ fire: true }, repeatDelay + repeatRate * 8);

    expect(held.fires).toBe(1);
    expect(held.colour).toBe(2);
    expect(held.col).toBe(20);
    expect(held.row).toBe(12);
    // Fire is excluded from the repeat entirely, so it must not open a hold either.
    expect(held.holdFrames).toBe(0);
    expect(held.repeats).toBe(0);
  });

  it("advances again on the next press", () => {
    const probe = startProbe();
    probe.hold({ fire: true }, 4);
    probe.hold({}, 4);
    const second = probe.hold({ fire: true }, 4);

    expect(second.fires).toBe(2);
    expect(second.colour).toBe(3);
    expect(colourAt(probe.bus, 20, 12)).toBe(3);
  });

  it("does not stop a direction held alongside it from repeating", () => {
    const probe = startProbe();
    const { repeatDelay, repeatRate } = probe.telemetry();
    const heldFrames = repeatDelay + repeatRate * 5;

    const held = probe.hold({ down: true, fire: true }, heldFrames);

    expect(held.fires).toBe(1);
    expect(held.down).toBe(expectedMoves(heldFrames, repeatDelay, repeatRate));
    expect(held.row).toBe(12 + held.down);
  });
});

describe("the committed binary matches the committed source", () => {
  /**
   * A stale `.prg` would leave every assertion above describing a program nobody
   * runs, because the tests and the hardware harness both use the binary. CI has no
   * assembler, so this can only check where one is installed — which is the machine
   * the source was edited on, and the only place it can go stale.
   */
  const assembler = (() => {
    try {
      execFileSync("64tass", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.runIf(assembler)("reassembles to the same bytes", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "joystick-probe-"));
    try {
      const rebuilt = path.join(scratch, "joystick-probe.prg");
      execFileSync("64tass", ["--cbm-prg", "-o", rebuilt, ASM_PATH], { stdio: "ignore" });
      expect(Array.from(readFileSync(rebuilt))).toEqual(Array.from(readFileSync(PRG_PATH)));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
