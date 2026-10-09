/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Silent generated SID tunes whose play routine counts its own calls at $10F0 (the tune
 * tools/hil/remote_sid_seek_poc.py generates), so the count divided by the play-call rate is the
 * exact position in the tune, wherever the tune itself sits and whatever its header says.
 */

import { COUNTER_ADDRESS } from "./device";

/**
 * Exact play-call rates on a PAL machine, so a count converts to real seconds: a PAL frame is 19656
 * cycles (50.1245 Hz, not 50), and the player times an NTSC tune at 16388 cycles (60.12 Hz, measured
 * on the C64 Ultimate). Nominal rates put the reference 0.25% ahead, 15 s at an hour into a tune.
 */
export const PAL_CPU_HZ = 985248;
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
  /** Where the code loads; the counter stays at $10F0 wherever that is. */
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

export const counterPsid = (tune: CounterTune): Uint8Array => {
  const lo = COUNTER_ADDRESS & 0xff;
  const hi = COUNTER_ADDRESS >> 8;
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
