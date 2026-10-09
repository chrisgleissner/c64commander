/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Silent generated SID tunes whose play routine counts its own calls (see `counterAddressOf`; the tune
 * tools/hil/remote_sid_seek_poc.py generates), so the count divided by the play-call rate is the
 * exact position in the tune, wherever the tune itself sits and whatever its header says.
 */

import { counterAddressFor } from "../../../tests/mocks/sidPlayerSimulation";

/**
 * Exact play-call rates on a PAL machine, so a count converts to real seconds: a PAL frame is 19656
 * cycles (50.1245 Hz, not 50), and the player times an NTSC tune at 16388 cycles (60.12 Hz, measured
 * on the C64 Ultimate). Nominal rates put the reference 0.25% ahead, 15 s at an hour into a tune.
 */
export const PAL_CPU_HZ = 985248;

/**
 * The CPU clock in each System Mode, from the PLL constant of its entry in the firmware's
 * software/u64/color_timings.cc, which is proportional to the clock (PAL 81247, NTSC 84338).
 */
export const SYSTEM_MODE_CPU_HZ: Record<string, number> = Object.fromEntries(
  (
    [
      ["PAL", 81247],
      ["NTSC", 84338],
      ["PAL-60", 84372],
      ["NTSC-50", 81300],
      ["PAL-60/L", 84422],
      ["NTSC-50/L", 81385],
    ] as const
  ).map(([mode, pll]) => [mode, Math.round((PAL_CPU_HZ * pll) / 81247)]),
);

/**
 * Every period, in CPU cycles, the SID player can call a tune at (player.asm): a PAL frame (312 x 63)
 * or an NTSC one (263 x 65) for the raster interrupt, each of its CIA latches plus one, and the
 * NTSC-on-PAL period measured on the C64 Ultimate.
 */
const PLAYER_CALL_PERIODS = [19656, 17095, 0x42c6, 0x5021, 0x417f, 0x4e98, 0x3ffb, 0x4cc7, 0x4203, 0x4f37].map(
  (value, index) => (index < 2 ? value : value + 1),
);
const SNAP_TOLERANCE = 0.003;

/**
 * The exact play-call rate a measured one stands for: the candidate nearest to it in `systemMode`.
 * Throws when none is within 0.3%, rather than grade landings against a guess.
 */
export const snapCallHz = (measuredHz: number, systemMode: string, tune: CounterTune, frameLines = 0): number => {
  const modeHz = SYSTEM_MODE_CPU_HZ[systemMode];
  if (!modeHz) throw new Error(`no CPU clock is known for System Mode ${systemMode}`);
  // An Ultimate 64's player switches the machine to the tune's standard; its clock is then that standard's.
  const modeLines = ["NTSC", "PAL-60", "PAL-60/L"].includes(systemMode) ? 263 : 312;
  const cpuHz = !frameLines || frameLines === modeLines ? modeHz : frameLines === 312 ? 985248 : 1022727;
  const periods = [...PLAYER_CALL_PERIODS, NTSC_ON_PAL_CYCLES, ...(tune.ciaTimer !== null ? [tune.ciaTimer + 1] : [])];
  const nearest = periods
    .map((period) => cpuHz / period)
    .reduce((best, hz) => (Math.abs(hz - measuredHz) < Math.abs(best - measuredHz) ? hz : best));
  if (Math.abs(nearest - measuredHz) / nearest > SNAP_TOLERANCE)
    throw new Error(
      `${tune.name} plays ${measuredHz.toFixed(3)} times a second in ${systemMode}; no known rate is near it`,
    );
  return nearest;
};

/** Count the play calls over `ms` at normal speed and snap the rate. */
export const measureCallHz = async (
  counter: () => Promise<number>,
  systemMode: string,
  tune: CounterTune,
  frameLines = 0,
  ms = 12000,
): Promise<number> => {
  const read = async () => {
    const sentAt = Date.now();
    const value = await counter();
    return { value, atMs: (sentAt + Date.now()) / 2 };
  };
  const first = await read();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const last = await read();
  return snapCallHz(((last.value - first.value) * 1000) / (last.atMs - first.atMs), systemMode, tune, frameLines);
};
export const callHzOf = (cyclesPerCall: number) => PAL_CPU_HZ / cyclesPerCall;
export const PAL_FRAME_CYCLES = 19656;
export const NTSC_ON_PAL_CYCLES = 16388;

export type CounterTune = {
  name: string;
  video: "PAL" | "NTSC";
  /** Iterations of a five-cycle loop in the play routine: how heavy the tune is to fast forward. */
  busyLoops: number;
  /** CIA 1 timer A latch for a CIA-timed tune; null for once a frame. */
  ciaTimer: number | null;
  /** Where the code loads; the counter is at $10F0, or $F0 into the code when it loads elsewhere. */
  loadAddress?: number;
  songs?: number;
  startSong?: number;
  /** PSID v3/v4 extra SID chips, e.g. $D420 and $D440. */
  extraSids?: number[];
  magic?: "PSID" | "RSID";
  /** Header flag bit 1: a BASIC tune, which the player RUNs instead of calling. */
  basic?: boolean;
  /** No play routine: the tune installs its own interrupt. */
  noPlayRoutine?: boolean;
};

/** Play calls per second of `tune` on a PAL machine. */
export const callHzOfTune = (tune: CounterTune) =>
  tune.ciaTimer !== null
    ? callHzOf(tune.ciaTimer + 1)
    : callHzOf(tune.video === "NTSC" ? NTSC_ON_PAL_CYCLES : PAL_FRAME_CYCLES);

/** Where `tune` counts its play calls. */
export const counterAddressOf = (tune: CounterTune) => counterAddressFor(tune.loadAddress ?? 0x1000);

export const counterPsid = (tune: CounterTune): Uint8Array => {
  const counter = counterAddressOf(tune);
  const lo = counter & 0xff;
  const hi = counter >> 8;
  const loadAddress = tune.loadAddress ?? 0x1000;
  const init = [0xa9, 0x00, 0x8d, lo, hi, 0x8d, lo + 1, hi, 0x8d, lo + 2, hi];
  if (tune.ciaTimer !== null) {
    init.push(0xa9, tune.ciaTimer & 0xff, 0x8d, 0x04, 0xdc, 0xa9, tune.ciaTimer >> 8, 0x8d, 0x05, 0xdc);
  }
  init.push(0x60);
  const play = [0xee, lo, hi, 0xd0, 0x08, 0xee, lo + 1, hi, 0xd0, 0x03, 0xee, lo + 2, hi];
  if (tune.busyLoops > 0) play.push(0xa2, tune.busyLoops, 0xca, 0xd0, 0xfd);
  play.push(0x60);
  const code = [...init, 0, 0, 0, 0, ...play];
  const extraSids = tune.extraSids ?? [];
  const version = extraSids.length >= 2 ? 4 : extraSids.length === 1 ? 3 : 2;
  const header = new Uint8Array(0x7c);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode(tune.magic ?? "PSID"));
  view.setUint16(4, version);
  view.setUint16(6, 0x7c);
  view.setUint16(10, loadAddress);
  view.setUint16(12, tune.noPlayRoutine ? 0 : loadAddress + init.length + 4);
  const songs = tune.songs ?? 1;
  view.setUint16(14, songs);
  view.setUint16(16, tune.startSong ?? 1);
  // Every sub tune shares the tune's timing.
  view.setUint32(18, tune.ciaTimer === null ? 0 : songs >= 32 ? 0xffffffff : 2 ** songs - 1);
  header.set(new TextEncoder().encode(`seek ${tune.name}`.slice(0, 31)), 0x16);
  view.setUint16(0x76, (tune.video === "PAL" ? 0x04 : 0x08) | (tune.basic ? 0x02 : 0));
  // PSID v3/v4: the second and third SID's address, as the middle byte of $Dxx0.
  if (extraSids[0]) header[0x7a] = (extraSids[0] >> 4) & 0xff;
  if (extraSids[1]) header[0x7b] = (extraSids[1] >> 4) & 0xff;
  return Uint8Array.from([...header, loadAddress & 0xff, loadAddress >> 8, ...code]);
};

/** The tunes the soak cycles through: light and heavy, PAL, NTSC and multi-speed. */
export const SOAK_TUNES: CounterTune[] = [
  { name: "PAL, once a frame, light", video: "PAL", busyLoops: 0, ciaTimer: null },
  { name: "PAL, once a frame, heavy", video: "PAL", busyLoops: 255, ciaTimer: null },
  { name: "NTSC on the machine's frame", video: "NTSC", busyLoops: 200, ciaTimer: null },
  { name: "PAL, CIA timer at 4x", video: "PAL", busyLoops: 200, ciaTimer: 0x1331 },
  { name: "PAL, CIA timer at 2x", video: "PAL", busyLoops: 120, ciaTimer: 0x2663 },
];
