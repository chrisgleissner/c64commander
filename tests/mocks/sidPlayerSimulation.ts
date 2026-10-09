/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A model of the Ultimate SID player as remote seeking sees it through REST, for unit tests and
 * the mock C64 server. The numbers are the ones `tools/hil/remote_sid_seek_poc.py` measured on a
 * C64 Ultimate:
 *
 * - the player draws "mm:ss" at screen+920 and the screen sits at $0800 here (DD00 bank 0, D018 $25);
 * - holding the left-arrow key fast forwards at a rate set by CPU Speed;
 * - while fast forwarding the clock counts play calls as frames, so a tune that is not called once a
 *   frame (an NTSC tune on a PAL machine, a multi-speed tune) moves its clock faster than its music;
 * - minus or plus restarts the sub tune and resets the clock;
 * - CIA 1 timer A ($DC04) counts down from the latch that sets the play-call rate.
 */

export const SIMULATED_SCREEN_ADDRESS = 0x0800;
const DD00_BANK_0 = 0x97;
const D018_SCREEN_0800 = 0x25;
const PAL_CIA_CLOCK_HZ = 985248;
export const MEASURED_FAST_FORWARD_RATE_BY_MHZ: Record<number, number> = {
  1: 10,
  2: 12,
  4: 39,
  8: 72,
  16: 125,
  32: 206,
  64: 294,
};

export type SidPlayerSimulationOptions = {
  playCallHz?: number;
  machineFrameHz?: number;
  fastForwardRateByMhz?: Record<number, number>;
  /**
   * The first CPU Speed change after a tune starts took up to a second longer to apply on the C64
   * Ultimate than later ones; this delays the first one by that much.
   */
  firstSpeedChangeDelayMs?: number;
  /**
   * The player scans the keyboard once a frame, so a released key keeps the fast forward running
   * for up to a frame or two after the release arrives.
   */
  keyReleaseDelayMs?: number;
  /**
   * Let CIA 1 timer A count down in step with time, so reads that repeat at its period all see the
   * same count. By default the samples cycle through the range regardless of when they are read.
   */
  timerFollowsClock?: boolean;
  /** What the first reads of CIA 1 timer A return, as fractions of the latch; later reads as configured. */
  timerFractions?: number[];
  /**
   * The clock reads (counted from 1) that catch the player mid-update. It writes the digits ones
   * first, so such a read shows the new seconds with the minutes still a minute behind.
   */
  tornClockReads?: number[];
  /** Where and how the player draws its screen; by default as the current player does. */
  layout?: Partial<SidPlayerLayout>;
  now?: () => number;
};

/**
 * The player's screen. The current player draws its title on row 0, the song length on row 21 and
 * the running clock as "mm:ss" at the start of row 23; a redesigned one may put them elsewhere and
 * format the clock differently.
 */
export type SidPlayerLayout = {
  title: string;
  clockRow: number;
  clockColumn: number;
  clockFormat: "mm:ss" | "m:ss" | "h:mm:ss";
  songLengthRow: number | null;
};

const CURRENT_PLAYER_LAYOUT: SidPlayerLayout = {
  title: "*** THE C-64 ULTIMATE SID PLAYER ***",
  clockRow: 23,
  clockColumn: 0,
  clockFormat: "mm:ss",
  songLengthRow: 21,
};

const twoDigits = (value: number) => String(value).padStart(2, "0");

const formatClock = (seconds: number, format: SidPlayerLayout["clockFormat"]) => {
  const minutes = Math.floor(seconds / 60);
  if (format === "h:mm:ss")
    return `${Math.floor(minutes / 60) % 100}:${twoDigits(minutes % 60)}:${twoDigits(seconds % 60)}`;
  if (format === "m:ss") return `${minutes % 100}:${twoDigits(seconds % 60)}`;
  return `${twoDigits(minutes % 100)}:${twoDigits(seconds % 60)}`;
};

const toScreenCode = (char: string) => {
  const code = char.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 64;
  return code;
};

export class SidPlayerSimulation {
  private clockSeconds = 0;
  private tuneSeconds = 0;
  private lastUpdate: number;
  private keysDown = new Set<string>();
  private cpuMhz = 1;
  private pendingSpeed: { mhz: number; atMs: number } | null = null;
  private speedChanged = false;
  private readonly firstSpeedChangeDelayMs: number;
  private readonly keyReleaseDelayMs: number;
  private readonly timerFollowsClock: boolean;
  readonly layout: SidPlayerLayout;
  private readonly tornClockReads: ReadonlySet<number>;
  private readonly timerFractions: readonly number[];
  private timerReads = 0;
  private scriptedTimer: number | undefined;
  private clockReads = 0;
  private readonly timerOrigin: number;
  private pendingReleases = new Map<string, number>();
  private timerSample = 0;
  restarts = 0;
  private readonly playCallHz: number;
  private readonly machineFrameHz: number;
  private readonly rates: Record<number, number>;
  private readonly now: () => number;

  constructor(options: SidPlayerSimulationOptions = {}) {
    this.playCallHz = options.playCallHz ?? 50;
    this.machineFrameHz = options.machineFrameHz ?? 50;
    this.rates = options.fastForwardRateByMhz ?? MEASURED_FAST_FORWARD_RATE_BY_MHZ;
    this.now = options.now ?? (() => Date.now());
    this.firstSpeedChangeDelayMs = options.firstSpeedChangeDelayMs ?? 0;
    this.keyReleaseDelayMs = options.keyReleaseDelayMs ?? 0;
    this.timerFollowsClock = options.timerFollowsClock ?? false;
    this.layout = { ...CURRENT_PLAYER_LAYOUT, ...options.layout };
    this.tornClockReads = new Set(options.tornClockReads ?? []);
    this.timerFractions = options.timerFractions ?? [];
    this.timerOrigin = this.now();
    this.lastUpdate = this.now();
  }

  /** Seconds of music played, which the clock only equals for a tune called once a frame. */
  get tunePositionSeconds() {
    this.advance();
    return this.tuneSeconds;
  }

  get fastForwarding() {
    return this.keysDown.has("arrow_left");
  }

  get heldKeys() {
    this.advance();
    return [...this.keysDown];
  }

  setCpuSpeedMhz(mhz: number) {
    this.advance();
    if (!this.speedChanged && this.firstSpeedChangeDelayMs > 0) {
      this.pendingSpeed = { mhz, atMs: this.now() + this.firstSpeedChangeDelayMs };
    } else {
      this.pendingSpeed = null;
      this.cpuMhz = mhz;
    }
    this.speedChanged = true;
  }

  pressKey(key: string) {
    this.advance();
    if ((key === "minus" || key === "plus") && !this.keysDown.has(key)) this.restart();
    this.pendingReleases.delete(key);
    this.keysDown.add(key);
  }

  releaseKey(key: string) {
    this.advance();
    if (this.keyReleaseDelayMs > 0 && this.keysDown.has(key)) {
      this.pendingReleases.set(key, this.now() + this.keyReleaseDelayMs);
      return;
    }
    this.keysDown.delete(key);
  }

  releaseAll() {
    this.advance();
    this.keysDown.clear();
  }

  restart() {
    this.clockSeconds = 0;
    this.tuneSeconds = 0;
    this.restarts += 1;
    this.lastUpdate = this.now();
  }

  /** Memory as `GET /v1/machine:readmem` returns it, for the addresses the player and seeking use. */
  readMemory(address: number, length: number): Uint8Array {
    this.advance();
    const clockAddress = SIMULATED_SCREEN_ADDRESS + this.layout.clockRow * 40 + this.layout.clockColumn;
    const coversClock = address <= clockAddress && clockAddress < address + length;
    const torn = coversClock && this.tornClockReads.has(++this.clockReads);
    const rows = new Map<number, string>();
    const out = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) out[index] = this.byteAt(address + index, torn, rows);
    return out;
  }

  private byteAt(address: number, torn: boolean, rows: Map<number, string>): number {
    if (address === 0xdd00) return DD00_BANK_0;
    if (address === 0xd018) return D018_SCREEN_0800;
    if (address === 0xdc04 || address === 0xdc05) {
      const latch = Math.round(PAL_CIA_CLOCK_HZ / this.playCallHz) - 1;
      if (address === 0xdc04) this.timerSample = (this.timerSample + 7) % 40;
      const counted = Math.floor(((this.now() - this.timerOrigin) * PAL_CIA_CLOCK_HZ) / 1000);
      if (address === 0xdc04) this.scriptedTimer = this.timerFractions[this.timerReads++];
      const scripted = this.scriptedTimer;
      const value =
        scripted !== undefined
          ? Math.round(latch * scripted)
          : this.timerFollowsClock
            ? latch - (counted % (latch + 1))
            : Math.round((latch * (40 - this.timerSample)) / 40);
      return address === 0xdc04 ? value & 0xff : value >> 8;
    }
    const offset = address - SIMULATED_SCREEN_ADDRESS;
    if (offset < 0 || offset >= 1000) return 0;
    const row = Math.floor(offset / 40);
    if (!rows.has(row)) rows.set(row, this.screenRow(row, torn));
    return toScreenCode(rows.get(row)!.charAt(offset % 40));
  }

  private screenRow(row: number, torn: boolean): string {
    const { title, clockRow, clockColumn, clockFormat, songLengthRow } = this.layout;
    const shown = Math.max(0, Math.floor(this.clockSeconds) - (torn ? 60 : 0));
    let text = "";
    if (row === 0) text = title;
    if (row === songLengthRow) text = "SONG LENGTH 03:00";
    if (row === clockRow) text = `${" ".repeat(clockColumn)}${formatClock(shown, clockFormat)}`;
    return text.padEnd(40, " ").slice(0, 40);
  }

  private advance() {
    const now = this.now();
    for (const [key, atMs] of [...this.pendingReleases].sort((a, b) => a[1] - b[1])) {
      if (atMs > now) continue;
      this.advanceTo(atMs);
      this.keysDown.delete(key);
      this.pendingReleases.delete(key);
    }
    if (this.pendingSpeed && now >= this.pendingSpeed.atMs) {
      this.advanceTo(this.pendingSpeed.atMs);
      this.cpuMhz = this.pendingSpeed.mhz;
      this.pendingSpeed = null;
    }
    this.advanceTo(now);
  }

  private advanceTo(now: number) {
    const elapsed = Math.max(0, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    if (this.fastForwarding) {
      const clockGain = elapsed * (this.rates[this.cpuMhz] ?? this.rates[1]);
      this.clockSeconds += clockGain;
      this.tuneSeconds += clockGain * (this.machineFrameHz / this.playCallHz);
    } else {
      this.clockSeconds += elapsed;
      this.tuneSeconds += elapsed;
    }
  }
}

/** The clock field the app should find on a simulated player with `layout`. */
export const simulatedClockField = (layout: Partial<SidPlayerLayout> = {}) => {
  const { clockRow, clockColumn, clockFormat } = { ...CURRENT_PLAYER_LAYOUT, ...layout };
  return {
    rowAddress: SIMULATED_SCREEN_ADDRESS + clockRow * 40,
    column: clockColumn,
    length: formatClock(0, clockFormat).length,
    wrapSeconds: clockFormat === "h:mm:ss" ? 100 * 3600 : 100 * 60,
  };
};
