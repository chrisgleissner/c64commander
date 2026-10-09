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
/**
 * Where the counter tune (tools/hil/remoteSeekHil/tunes.ts) counts its play calls: $10F0, or $F0 into
 * its own code when it loads elsewhere, because the player then puts itself and its data at $1000.
 */
export const counterAddressFor = (loadAddress: number) => (loadAddress === 0x1000 ? 0x10f0 : loadAddress + 0xf0);

/** The load address a PSID's header names, or the one its data starts with when the header has none. */
export const psidLoadAddress = (psid: Uint8Array) => {
  const view = new DataView(psid.buffer, psid.byteOffset, psid.byteLength);
  const named = view.getUint16(0x08);
  return named !== 0 ? named : view.getUint16(view.getUint16(0x06), true);
};
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
  /** CIA 1's clock: 985248 Hz in the 50 Hz System Modes, 1022727 Hz in the 60 Hz ones. */
  ciaClockHz?: number;
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
  /** Where the player's keyboard routine and fast forward flag sit (see `placeSidPlayerCode`); null for a player without them. */
  playerCode?: { keyboardAddress: number; flagAddress: number } | null;
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
  private counterAddress = counterAddressFor(0x1000);
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
  /** RAM as far as the player's code goes; everything else is computed in `byteAt`. */
  private readonly ram = new Uint8Array(0x10000);
  readonly code: ReturnType<typeof placeSidPlayerCode>;
  private readonly tornClockReads: ReadonlySet<number>;
  private readonly timerFractions: readonly number[];
  private timerReads = 0;
  private scriptedTimer: number | undefined;
  private clockReads = 0;
  private readonly timerOrigin: number;
  private pendingReleases = new Map<string, number>();
  private timerSample = 0;
  restarts = 0;
  private paused = false;
  private playCallHz: number;
  private machineFrameHz: number;
  private readonly ciaClockHz: number;
  private readonly rates: Record<number, number>;
  private readonly now: () => number;

  constructor(options: SidPlayerSimulationOptions = {}) {
    this.playCallHz = options.playCallHz ?? PAL_CIA_CLOCK_HZ / 19656;
    this.machineFrameHz = options.machineFrameHz ?? PAL_CIA_CLOCK_HZ / 19656;
    this.ciaClockHz = options.ciaClockHz ?? PAL_CIA_CLOCK_HZ;
    this.rates = options.fastForwardRateByMhz ?? MEASURED_FAST_FORWARD_RATE_BY_MHZ;
    this.now = options.now ?? (() => Date.now());
    this.firstSpeedChangeDelayMs = options.firstSpeedChangeDelayMs ?? 0;
    this.keyReleaseDelayMs = options.keyReleaseDelayMs ?? 0;
    this.timerFollowsClock = options.timerFollowsClock ?? false;
    this.layout = { ...CURRENT_PLAYER_LAYOUT, ...options.layout };
    this.code =
      options.playerCode === null
        ? { ldyOperandAddress: -1, storeAddress: -1, covers: () => false }
        : placeSidPlayerCode(this.ram, options.playerCode ?? DEFAULT_PLAYER_CODE);
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

  /** The seconds the player's clock shows on the screen right now. */
  get shownClockSeconds() {
    this.advance();
    return Math.floor(this.clockSeconds);
  }

  /** Fast forward runs while the key is down, or while the keyboard routine's `ldy #0` reads `ldy #1`. */
  get fastForwarding() {
    return this.keysDown.has("arrow_left") || this.ram[this.code.ldyOperandAddress] === 1;
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

  /** Start another tune, as runners:sidplay does, at its play-call rate on this machine. */
  loadTune(
    { playCallHz, machineFrameHz }: { playCallHz: number; machineFrameHz: number },
    counterAddress = counterAddressFor(0x1000),
  ) {
    this.counterAddress = counterAddress;
    this.advance();
    this.keysDown.clear();
    this.pendingReleases.clear();
    this.playCallHz = playCallHz;
    this.machineFrameHz = machineFrameHz;
    this.paused = false;
    this.restart();
  }

  /** machine:pause stops the CPU, so the tune and its clock stand still until machine:resume. */
  setPaused(paused: boolean) {
    this.advance();
    this.paused = paused;
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

  /** `PUT /v1/machine:writemem`: only the player's code is RAM here. */
  writeMemory(address: number, data: Uint8Array) {
    this.advance();
    this.ram.set(data, address);
  }

  private byteAt(address: number, torn: boolean, rows: Map<number, string>): number {
    if (this.code.covers(address)) return this.ram[address];
    if (address >= this.counterAddress && address < this.counterAddress + 3) {
      const calls = Math.floor(this.tuneSeconds * this.playCallHz);
      return (calls >> (8 * (address - this.counterAddress))) & 0xff;
    }
    if (address === 0xdd00) return DD00_BANK_0;
    if (address === 0xd018) return D018_SCREEN_0800;
    if (address === 0xdc04 || address === 0xdc05) {
      const latch = Math.round(this.ciaClockHz / this.playCallHz) - 1;
      if (address === 0xdc04) this.timerSample = (this.timerSample + 7) % 40;
      const counted = Math.floor(((this.now() - this.timerOrigin) * this.ciaClockHz) / 1000);
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
    if (this.paused) return;
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
    screenAddress: SIMULATED_SCREEN_ADDRESS,
    rowAddress: SIMULATED_SCREEN_ADDRESS + clockRow * 40,
    column: clockColumn,
    length: formatClock(0, clockFormat).length,
    wrapSeconds: clockFormat === "h:mm:ss" ? 100 * 3600 : 100 * 60,
  };
};

const DEFAULT_PLAYER_CODE = { keyboardAddress: 0xc340, flagAddress: 0xc1f0 };

/**
 * Lay out the player code that `findFastForwardPatch` looks for, with the bytes of the built player
 * (1541ultimate software/6502/sidcrt/target/advancedplayer.bin and player.bin) at the addresses the
 * loader would have relocated them to: the keyboard routine's row scan ending in `ldy #0 / jmp
 * store`, the store `sty flag / rts`, and the interrupt handler's `lda #flag / beq / inc $d020`.
 */
export const placeSidPlayerCode = (
  memory: Uint8Array,
  { keyboardAddress, flagAddress }: { keyboardAddress: number; flagAddress: number },
) => {
  const storeAddress = keyboardAddress + 0x40;
  const lo = (value: number) => value & 0xff;
  const hi = (value: number) => value >> 8;
  const keyboard = [0xa2, 0x07, 0xbc, 0x8a, 0x06, 0x8c, 0x00, 0xdc, 0xad, 0x01, 0xdc, 0xc9, 0xff, 0xd0, 0x0b];
  keyboard.push(0x9d, 0x92, 0x06, 0xca, 0xd0, 0xed, 0xa0, 0x00, 0x4c, lo(storeAddress), hi(storeAddress));
  const store = [0x8c, lo(flagAddress), hi(flagAddress), 0x60];
  const handlerAddress = flagAddress - 4;
  const handler = [0x68, 0x85, 0x01, 0xa9, 0x00, 0xf0, 0x09, 0xee, 0x20, 0xd0, 0x20];
  memory.set(keyboard, keyboardAddress);
  memory.set(store, storeAddress);
  memory.set(handler, handlerAddress);
  const regions = [
    [keyboardAddress, keyboard.length],
    [storeAddress, store.length],
    [handlerAddress, handler.length],
  ];
  return {
    ldyOperandAddress: keyboardAddress + keyboard.length - 4,
    storeAddress,
    covers: (address: number) => regions.some(([start, length]) => address >= start && address < start + length),
  };
};

const PAL_FRAME_HZ = PAL_CIA_CLOCK_HZ / 19656;
/** The player times an NTSC tune on a PAL machine at 16388 cycles, measured on the C64 Ultimate. */
const NTSC_ON_PAL_HZ = PAL_CIA_CLOCK_HZ / 16388;
/** The latch of `lda #lo / sta $dc04 / lda #hi / sta $dc05`, how a tune sets CIA 1 timer A, if `code` has one. */
const timerLatchIn = (code: Uint8Array): number | null => {
  for (let index = 0; index + 10 <= code.length; index += 1) {
    const [lda1, lo, sta1, a1, b1, lda2, hi, sta2, a2, b2] = code.subarray(index, index + 10);
    if (
      lda1 === 0xa9 &&
      sta1 === 0x8d &&
      a1 === 0x04 &&
      b1 === 0xdc &&
      lda2 === 0xa9 &&
      sta2 === 0x8d &&
      a2 === 0x05 &&
      b2 === 0xdc
    )
      return lo | (hi << 8);
  }
  return null;
};

/**
 * How often the player calls the play routine of `songNr` in a PSID on a PAL machine: once a frame
 * for a PAL tune, at the NTSC rate for an NTSC tune, and at the tune's own CIA 1 timer A latch for
 * a CIA-timed sub tune (found in its code; the player's 60 Hz default when it sets none).
 */
export const playCallRateOnPal = (psid: Uint8Array, songNr: number) => {
  const view = new DataView(psid.buffer, psid.byteOffset, psid.byteLength);
  const speed = view.getUint32(0x12);
  const speedBit = Math.min(Math.max(songNr, 1), 32) - 1;
  const clock = view.getUint16(4) >= 2 ? (view.getUint16(0x76) >> 2) & 0x03 : 1;
  if (((speed >>> speedBit) & 1) === 0) {
    return { playCallHz: clock === 2 ? NTSC_ON_PAL_HZ : PAL_FRAME_HZ, machineFrameHz: PAL_FRAME_HZ };
  }
  const latch = timerLatchIn(psid.subarray(view.getUint16(6)));
  const cycles = latch === null ? PAL_CIA_CLOCK_HZ / 60 : latch + 1;
  return { playCallHz: PAL_CIA_CLOCK_HZ / cycles, machineFrameHz: PAL_FRAME_HZ };
};
