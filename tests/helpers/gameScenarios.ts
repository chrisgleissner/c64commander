/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Synthetic C64 games, with ground truth, for evaluating the follow-focus tracker.
 *
 * Each scenario is a deterministic seeded sequence of packed 4bpp frames plus the true centre
 * of the player's sprite on every one of them. They are stylised, but each reproduces a real
 * thing games do to a tracker: animation, palette flashing, screen wrap, dying and respawning
 * somewhere else, a room change that repaints the whole screen, look-alike enemies crossing,
 * a scrolling backdrop, and being walked behind scenery.
 *
 * Frames are rendered on demand into one reused buffer, so a whole suite costs one frame of
 * memory rather than the hundreds of megabytes holding them all would.
 */

import { createFrame, drawMask, fillRect, FRAME_HEIGHT, FRAME_WIDTH, setPixel } from "./vicFrames";

export type ScenarioKind =
  "platformer" | "shooter" | "respawn" | "roomflip" | "powerup" | "swarm" | "scroller" | "maze" | "grow";

export const SCENARIO_KINDS: readonly ScenarioKind[] = [
  "platformer",
  "shooter",
  "respawn",
  "roomflip",
  "powerup",
  "swarm",
  "scroller",
  "maze",
  "grow",
];

export interface ScenarioTruth {
  /** Centre of the player's sprite, in pixels. */
  x: number;
  y: number;
  /** False while the player is dead, off-screen or fully behind scenery. */
  visible: boolean;
  /** True on a frame where the player did not travel to its new position — respawn, room change. */
  teleported: boolean;
}

export interface Scenario {
  name: string;
  kind: ScenarioKind;
  seed: number;
  frameCount: number;
  /** Where the user's long press lands, in pixels — on the player, on frame 0. */
  pick: { x: number; y: number };
  render(index: number): Uint8Array;
  truth(index: number): ScenarioTruth;
}

type Shape = "box" | "boxBig" | "walkA" | "walkB" | "blob";

interface Actor {
  x: number;
  y: number;
  colour: number;
  shape: Shape;
  visible: boolean;
}

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: number;
  /** Drawn after the actors, so it hides whatever walks behind it. */
  front?: boolean;
}

interface Room {
  bg: number;
  dot: number;
  blocks: Block[];
}

interface FrameState {
  room: number;
  scrollX: number;
  actors: Actor[];
  teleported: boolean;
}

const WALK_A = [
  "..####..",
  ".######.",
  ".######.",
  "..####..",
  ".######.",
  "########",
  "########",
  "..####..",
  "..####..",
  "..####..",
  "..####..",
  "..####..",
  "..##.##.",
  "..##.##.",
  "..##.##.",
  ".###.###",
];

const WALK_B = [
  "..####..",
  ".######.",
  ".######.",
  "..####..",
  "..####..",
  ".#####..",
  ".#####..",
  "..####..",
  "..####..",
  "..####..",
  "..####..",
  ".##..##.",
  "##....##",
  "#......#",
  "#......#",
  "##....##",
];

const BLOB = ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."];

const SHAPE_SIZE: Record<Shape, { w: number; h: number }> = {
  box: { w: 15, h: 15 },
  boxBig: { w: 15, h: 30 },
  walkA: { w: 8, h: 16 },
  walkB: { w: 8, h: 16 },
  blob: { w: 7, h: 7 },
};

/** Deterministic PRNG (mulberry32) — a scenario must be the same sequence on every run. */
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const wrapX = (x: number) => ((x % FRAME_WIDTH) + FRAME_WIDTH) % FRAME_WIDTH;

const drawActor = (frame: Uint8Array, actor: Actor): void => {
  if (!actor.visible) return;
  if (actor.shape === "box" || actor.shape === "boxBig") {
    const size = SHAPE_SIZE[actor.shape];
    fillRect(frame, Math.round(actor.x), Math.round(actor.y), size.w, size.h, actor.colour);
    return;
  }
  const mask = actor.shape === "walkA" ? WALK_A : actor.shape === "walkB" ? WALK_B : BLOB;
  drawMask(frame, mask, Math.round(actor.x), Math.round(actor.y), actor.colour);
};

const actorCentre = (actor: Actor) => {
  const size = SHAPE_SIZE[actor.shape];
  return { x: Math.round(actor.x) + (size.w - 1) / 2, y: Math.round(actor.y) + (size.h - 1) / 2 };
};

/** Is the player still on screen and not fully painted over by front scenery? */
const playerVisible = (state: FrameState, rooms: Room[]): boolean => {
  const player = state.actors[0];
  if (!player.visible) return false;
  const size = SHAPE_SIZE[player.shape];
  const centre = actorCentre(player);
  if (centre.x < 8 || centre.x > FRAME_WIDTH - 8 || centre.y < 8 || centre.y > FRAME_HEIGHT - 8) return false;
  for (const block of rooms[state.room].blocks) {
    if (!block.front) continue;
    const bx = block.x + state.scrollX;
    if (
      player.x >= bx &&
      player.x + size.w <= bx + block.w &&
      player.y >= block.y &&
      player.y + size.h <= block.y + block.h
    ) {
      return false;
    }
  }
  return true;
};

const buildRoom = (random: () => number, palette: readonly number[], withFront: boolean): Room => {
  const blocks: Block[] = [];
  const platformCount = 3 + Math.floor(random() * 3);
  for (let i = 0; i < platformCount; i += 1) {
    blocks.push({
      x: Math.floor(random() * 280),
      y: 60 + Math.floor(random() * 170),
      w: 40 + Math.floor(random() * 90),
      h: 8,
      colour: palette[1],
    });
  }
  if (withFront) {
    blocks.push({
      x: 150 + Math.floor(random() * 80),
      y: 90 + Math.floor(random() * 80),
      w: 46,
      h: 60,
      colour: palette[2],
      front: true,
    });
  }
  return { bg: palette[0], dot: palette[3], blocks };
};

const PALETTES: readonly (readonly number[])[] = [
  [6, 14, 4, 11], // blue room
  [0, 11, 9, 12], // black cave
  [5, 13, 8, 12], // green level
  [2, 10, 8, 9], // red level
];

/**
 * Build one scenario. `frameCount` frames at 20 ms is the PAL frame rate, which is the rate the
 * mirror delivers at — the tracker's own decimation is the caller's business.
 */
export const buildScenario = (kind: ScenarioKind, seed: number, frameCount = 240): Scenario => {
  const random = rng(seed * 7919 + kind.length * 104729);
  const rooms: Room[] = [];
  const scrolling = kind === "scroller";
  const roomCount = kind === "roomflip" ? 3 : 1;
  for (let i = 0; i < roomCount; i += 1) {
    rooms.push(buildRoom(random, PALETTES[(seed + i) % PALETTES.length], kind === "maze" || kind === "platformer"));
  }

  const playerColour = kind === "swarm" ? 1 : [1, 7, 13, 3][seed % 4];
  const decoyColours =
    kind === "swarm" ? [1, 1, 1, 1, 1] : [10, 8, 12, 3, 15].map((c) => (c === playerColour ? 15 : c));
  const decoyCount = kind === "swarm" ? 5 : kind === "platformer" ? 2 : 3;

  const states: FrameState[] = [];
  let px = 40 + Math.floor(random() * 60);
  let py = 120;
  let vx = kind === "shooter" ? 9 : 2 + random() * 1.5;
  let vy = 0;
  let room = 0;
  let scrollX = 0;
  let colour = playerColour;

  const decoys: Actor[] = [];
  for (let i = 0; i < decoyCount; i += 1) {
    decoys.push({
      x: 120 + i * 48,
      y: 60 + Math.floor(random() * 150),
      colour: decoyColours[i % decoyColours.length],
      shape: kind === "swarm" ? "walkA" : i % 2 === 0 ? "blob" : "box",
      visible: true,
    });
  }
  const decoyVx = decoys.map((_, i) => (i % 2 === 0 ? -2.5 : 3) * (kind === "swarm" ? 1.4 : 1));

  for (let i = 0; i < frameCount; i += 1) {
    let teleported = false;
    let visible = true;

    // --- the player ---
    if (kind === "respawn" && i % 70 === 40) {
      visible = false; // dead
    } else if (kind === "respawn" && i % 70 === 55) {
      px = 40;
      py = 120;
      vx = Math.abs(vx);
      teleported = true;
    } else if (kind === "respawn" && i % 70 > 40 && i % 70 < 55) {
      visible = false;
    }

    if (kind === "roomflip" && i > 0 && i % 80 === 0) {
      room = (room + 1) % rooms.length;
      px = FRAME_WIDTH - px;
      py = 60 + ((i * 37) % 150);
      teleported = true;
    }

    if (kind === "powerup") {
      const phase = i % 120;
      colour = phase < 40 ? playerColour : phase < 80 ? [1, 7, 13, 3, 10][i % 5] : 8;
    }

    px += vx;
    if (kind === "shooter") {
      px = wrapX(px);
    } else if (px < 12 || px > FRAME_WIDTH - 28) {
      vx = -vx;
      px += vx * 2;
    }

    if (kind === "platformer") {
      // a jump every second or so, and gravity back down to the ground line
      if (i % 55 === 0) vy = -7;
      vy += 0.6;
      py += vy;
      if (py > 170) {
        py = 170;
        vy = 0;
      }
    } else if (kind !== "respawn" && kind !== "roomflip") {
      py += Math.sin(i / 23 + seed) * 1.4;
      py = Math.max(30, Math.min(FRAME_HEIGHT - 40, py));
    }

    if (scrolling) scrollX = -((i * 2) % FRAME_WIDTH);

    const walking = kind === "platformer" || kind === "maze" || kind === "swarm";
    // A player that doubles in height and back, the way a power-up works: the same sprite in a
    // different state, which is a thing a tracker has to learn rather than treat as a stranger.
    const grown = kind === "grow" && Math.floor(i / 60) % 2 === 1;
    const player: Actor = {
      x: px,
      y: py,
      colour,
      shape: walking ? (Math.floor(i / 4) % 2 === 0 ? "walkA" : "walkB") : grown ? "boxBig" : "box",
      visible,
    };

    // --- everything else ---
    const actors: Actor[] = [player];
    for (let d = 0; d < decoys.length; d += 1) {
      const decoy = decoys[d];
      decoy.x += decoyVx[d];
      if (decoy.x < 8 || decoy.x > FRAME_WIDTH - 24) decoyVx[d] = -decoyVx[d];
      const shape = kind === "swarm" ? (Math.floor(i / 4) % 2 === 0 ? "walkA" : "walkB") : decoy.shape;
      // Swarm decoys home in on the player's row, so they genuinely cross it.
      const y = kind === "swarm" ? py + Math.sin(i / 17 + d) * 6 : decoy.y;
      actors.push({ x: decoy.x, y, colour: decoy.colour, shape, visible: true });
    }

    states.push({ room, scrollX, actors, teleported });
  }

  const buffer = createFrame(0);
  const scenario: Scenario = {
    name: `${kind}#${seed}`,
    kind,
    seed,
    frameCount,
    pick: { x: 0, y: 0 },
    render(index: number): Uint8Array {
      const state = states[Math.max(0, Math.min(frameCount - 1, index))];
      const active = rooms[state.room];
      buffer.fill((active.bg << 4) | active.bg);
      for (let y = 4; y < FRAME_HEIGHT; y += 24) {
        for (let x = (state.scrollX % 24) + 24; x < FRAME_WIDTH - 4; x += 24) {
          setPixel(buffer, Math.round(x), y, active.dot);
        }
      }
      for (const block of active.blocks) {
        if (block.front) continue;
        fillRect(buffer, Math.round(block.x + state.scrollX), block.y, block.w, block.h, block.colour);
      }
      for (const actor of state.actors) drawActor(buffer, actor);
      for (const block of active.blocks) {
        if (!block.front) continue;
        fillRect(buffer, Math.round(block.x + state.scrollX), block.y, block.w, block.h, block.colour);
      }
      return buffer;
    },
    truth(index: number): ScenarioTruth {
      const state = states[Math.max(0, Math.min(frameCount - 1, index))];
      const centre = actorCentre(state.actors[0]);
      return { x: centre.x, y: centre.y, visible: playerVisible(state, rooms), teleported: state.teleported };
    },
  };

  const first = scenario.truth(0);
  scenario.pick = { x: first.x, y: first.y };
  return scenario;
};

/** Every scenario at one seed — the unit an evaluation run is scored over. */
export const buildSuite = (seed: number, frameCount = 240): Scenario[] =>
  SCENARIO_KINDS.map((kind) => buildScenario(kind, seed, frameCount));
