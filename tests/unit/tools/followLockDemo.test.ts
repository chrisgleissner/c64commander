/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * `tools/c64/follow-lock-demo.prg`, executed.
 *
 * The demo is the instrument the follow-focus feature is judged with on real hardware, so a
 * defect in it reads as a defect in the app. This runs the COMMITTED binary — the same bytes
 * `runners:run_prg` uploads — in a 6502 interpreter and checks that each of its six phases does
 * what the source says it does, by reading the sprite registers the VIC would have drawn from
 * and the telemetry block a harness reads over REST.
 *
 * It is not a substitute for running the demo on a C64 and watching the phone: the point of the
 * program is the picture, and nothing here draws one. It proves the machine end is right before
 * anyone concludes the tracker is wrong.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { C64TestBus, joystickMask, loadPrg, Mos6502, runFrames, type JoystickState } from "../../helpers/mos6502";

const REPO = path.resolve(__dirname, "..", "..", "..");
const PRG_PATH = path.join(REPO, "tools", "c64", "follow-lock-demo.prg");
const ASM_PATH = path.join(REPO, "tools", "c64", "follow-lock-demo.asm");

/** Telemetry offsets from $C000. Keep in step with follow-lock-demo.asm's header. */
const TELEMETRY_BASE = 0xc000;
const T = {
  magic1: 0,
  magic2: 1,
  frames: 2,
  phase: 3,
  phaseFrames: 4,
  pxLo: 5,
  pxHi: 6,
  py: 7,
  colour: 8,
  anim: 9,
  visible: 10,
  crossings: 11,
  recolours: 12,
  wraps: 13,
  paused: 14,
  sprites: 15,
} as const;

const SPRITE_X = 0xd000;
const SPRITE_MSB = 0xd010;
const SPRITE_ENABLE = 0xd015;
const SPRITE_COLOUR = 0xd027;
const SPRITE_PTRS = 0x07f8;
const SCREEN_BASE = 0x0400;

const PHASE_LEN = 150;
const SETTLE_FRAMES = 60;
const WHITE = 1;
const ORANGE = 8;

type Telemetry = Record<keyof typeof T, number>;

const readTelemetry = (bus: C64TestBus): Telemetry =>
  Object.fromEntries(
    Object.entries(T).map(([name, offset]) => [name, bus.memory[TELEMETRY_BASE + offset]]),
  ) as Telemetry;

/** The player's nine-bit X, which is the pair the VIC needs and the pair a test has to join. */
const playerX = (telemetry: Telemetry): number => telemetry.pxHi * 256 + telemetry.pxLo;

interface Demo {
  bus: C64TestBus;
  run: (frames: number) => Telemetry;
  press: (state: JoystickState) => Telemetry;
  telemetry: () => Telemetry;
  toPhase: (phase: number) => Telemetry;
}

const startDemo = (): Demo => {
  const bus = new C64TestBus();
  const cpu = new Mos6502(bus);
  const { sysAddress } = loadPrg(bus, new Uint8Array(readFileSync(PRG_PATH)));
  cpu.jumpTo(sysAddress);
  runFrames(cpu, bus, SETTLE_FRAMES);

  const run = (frames: number) => {
    runFrames(cpu, bus, frames);
    return readTelemetry(bus);
  };
  /** One press and release, so the demo's rising-edge detection sees exactly one event. */
  const press = (state: JoystickState) => {
    bus.joystick = joystickMask(state);
    runFrames(cpu, bus, 2);
    bus.joystick = 0;
    runFrames(cpu, bus, 2);
    return readTelemetry(bus);
  };
  const toPhase = (phase: number) => {
    let telemetry = readTelemetry(bus);
    for (let attempt = 0; attempt < 8 && telemetry.phase !== phase; attempt += 1) telemetry = press({ up: true });
    expect(telemetry.phase).toBe(phase);
    return telemetry;
  };

  return { bus, run, press, telemetry: () => readTelemetry(bus), toPhase };
};

describe("follow-lock-demo.prg — it starts, and says so", () => {
  it("publishes its magic, its phase and eight sprites on screen", () => {
    const demo = startDemo();
    const telemetry = demo.telemetry();

    expect(telemetry.magic1).toBe(0x46);
    expect(telemetry.magic2).toBe(0x4c);
    expect(telemetry.sprites).toBe(8);
    expect(telemetry.phase).toBe(1);
    expect(telemetry.visible).toBe(1);
    expect(telemetry.paused).toBe(0);
    expect(telemetry.frames).toBeGreaterThan(0);
    expect(demo.bus.memory[SPRITE_ENABLE]).toBe(0xff);
  });

  it("draws its banner, which is how a person knows the right program is running", () => {
    const demo = startDemo();
    const banner = Array.from({ length: 10 }, (_, index) =>
      String.fromCharCode(demo.bus.memory[SCREEN_BASE + index] + 64),
    ).join("");
    expect(banner).toBe("FOLLOWLOCK");
    // The phase digit is on the second row, and it is what a person reads off the picture.
    expect(demo.bus.memory[SCREEN_BASE + 46]).toBe(0x30 + demo.telemetry().phase);
  });

  it("gives sprite 1 the player's own shape and colour, so the crossing is between look-alikes", () => {
    const demo = startDemo();
    expect(demo.bus.memory[SPRITE_COLOUR + 1]).toBe(WHITE);
    expect(demo.bus.memory[SPRITE_COLOUR]).toBe(WHITE);
    // Sprite 1 never animates, so it holds the shape the player alternates away from and back to.
    expect(demo.bus.memory[SPRITE_PTRS + 1]).toBe(demo.bus.memory[SPRITE_PTRS]);
  });

  it("writes what it publishes to the registers the VIC actually reads", () => {
    const demo = startDemo();
    const telemetry = demo.run(10);
    expect(demo.bus.memory[SPRITE_X]).toBe(telemetry.pxLo);
    expect(demo.bus.memory[SPRITE_X + 1]).toBe(telemetry.py);
    expect(demo.bus.memory[SPRITE_MSB] & 0x01).toBe(telemetry.pxHi);
    expect(demo.bus.memory[SPRITE_COLOUR]).toBe(telemetry.colour);
  });
});

describe("the player animates and moves", () => {
  it("alternates between two silhouettes", () => {
    const demo = startDemo();
    const seen = new Set<number>();
    for (let frame = 0; frame < 20; frame += 1) {
      demo.run(1);
      seen.add(demo.bus.memory[SPRITE_PTRS]);
    }
    expect(seen.size).toBe(2);
  });

  it("drifts one pixel a frame in the idle phase", () => {
    const demo = startDemo();
    const before = demo.telemetry();
    const after = demo.run(20);
    expect(playerX(after) - playerX(before)).toBe(20);
    expect(after.py).toBe(before.py);
  });

  it("advances a phase every 150 frames, and wraps back to the first after the sixth", () => {
    const demo = startDemo();
    expect(demo.telemetry().phase).toBe(1);
    const start = demo.telemetry().phaseFrames;
    expect(demo.run(PHASE_LEN - start).phase).toBe(2);
    demo.toPhase(6);
    expect(demo.run(PHASE_LEN).phase).toBe(1);
  });
});

describe("the phases each do the thing they exist for", () => {
  it("phase 3 flashes the colour and then keeps a new one", () => {
    const demo = startDemo();
    demo.toPhase(3);
    const colours = new Set<number>();
    for (let frame = 0; frame < 100; frame += 1) colours.add(demo.run(1).colour);
    expect(colours.size).toBeGreaterThan(3);
    expect(demo.telemetry().recolours).toBeGreaterThan(20);

    // The rest of the phase settles on one new colour and holds it — the power-up, not the damage.
    const settled = demo.run(45);
    expect(settled.colour).toBe(ORANGE);
    expect(demo.run(3).colour).toBe(ORANGE);
  });

  it("phase 4 moves eight pixels a frame and wraps off one side onto the other", () => {
    const demo = startDemo();
    demo.toPhase(4);
    const before = demo.telemetry();
    const after = demo.run(10);
    expect((playerX(after) - playerX(before) + 512) % 512).toBe(80);

    // 512 X units at 8 a frame is 64 frames, so a hundred guarantees at least one wrap.
    const wrapsBefore = demo.telemetry().wraps;
    expect(demo.run(100).wraps).toBeGreaterThan(wrapsBefore);
  });

  it("phase 5 puts the player and its look-alike on one row and passes them through each other", () => {
    const demo = startDemo();
    demo.toPhase(5);
    const start = demo.telemetry();
    expect(demo.bus.memory[SPRITE_X + 3]).toBe(start.py); // sprite 1's Y is the player's

    const crossingsBefore = start.crossings;
    const after = demo.run(PHASE_LEN - 10);
    expect(after.crossings).toBeGreaterThan(crossingsBefore);
    expect(demo.bus.memory[SPRITE_COLOUR + 1]).toBe(demo.bus.memory[SPRITE_COLOUR]);
  });

  it("phase 6 switches the player off for a while and keeps moving it", () => {
    const demo = startDemo();
    demo.toPhase(6);
    const before = demo.run(30);
    expect(before.visible).toBe(1);
    expect(demo.bus.memory[SPRITE_ENABLE] & 0x01).toBe(1);

    const hidden = demo.run(25);
    expect(hidden.visible).toBe(0);
    expect(demo.bus.memory[SPRITE_ENABLE] & 0x01).toBe(0);
    // Still travelling while it cannot be seen: the view has to arrive where it ended up.
    const later = demo.run(20);
    expect(playerX(later)).toBeGreaterThan(playerX(hidden));
    expect(later.visible).toBe(0);

    const back = demo.run(20);
    expect(back.visible).toBe(1);
    expect(demo.bus.memory[SPRITE_ENABLE] & 0x01).toBe(1);
  });
});

describe("the controls a person uses during a hardware session", () => {
  it("fire freezes every sprite, and freezes them again on the way back", () => {
    const demo = startDemo();
    const paused = demo.press({ fire: true });
    expect(paused.paused).toBe(1);

    const frozen = demo.run(30);
    expect(playerX(frozen)).toBe(playerX(paused));
    expect(frozen.phaseFrames).toBe(paused.phaseFrames);

    const resumed = demo.press({ fire: true });
    expect(resumed.paused).toBe(0);
    expect(playerX(demo.run(10))).toBeGreaterThan(playerX(resumed));
  });

  it("up skips to the next phase without waiting three seconds for it", () => {
    const demo = startDemo();
    expect(demo.telemetry().phase).toBe(1);
    expect(demo.press({ up: true }).phase).toBe(2);
    expect(demo.telemetry().phaseFrames).toBeLessThan(10);
    expect(demo.press({ up: true }).phase).toBe(3);
  });
});

describe("the committed binary matches the committed source", () => {
  /**
   * A stale `.prg` would leave every assertion above describing a program nobody runs, because
   * the tests and the hardware session both use the binary. CI has no assembler, so this can
   * only check where one is installed — which is the machine the source was edited on, and the
   * only place it can go stale.
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
    const scratch = mkdtempSync(path.join(tmpdir(), "follow-lock-demo-"));
    try {
      const rebuilt = path.join(scratch, "follow-lock-demo.prg");
      execFileSync("64tass", ["--cbm-prg", "-o", rebuilt, ASM_PATH], { stdio: "ignore" });
      expect(Array.from(readFileSync(rebuilt))).toEqual(Array.from(readFileSync(PRG_PATH)));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
