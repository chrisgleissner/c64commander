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
const TITLE = "*** THE C-64 ULTIMATE SID PLAYER ***";
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
  now?: () => number;
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
    return [...this.keysDown];
  }

  setCpuSpeedMhz(mhz: number) {
    this.advance();
    this.cpuMhz = mhz;
  }

  pressKey(key: string) {
    this.advance();
    if ((key === "minus" || key === "plus") && !this.keysDown.has(key)) this.restart();
    this.keysDown.add(key);
  }

  releaseKey(key: string) {
    this.advance();
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
    const out = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) out[index] = this.byteAt(address + index);
    return out;
  }

  private byteAt(address: number): number {
    if (address === 0xdd00) return DD00_BANK_0;
    if (address === 0xd018) return D018_SCREEN_0800;
    if (address === 0xdc04 || address === 0xdc05) {
      const latch = Math.round(PAL_CIA_CLOCK_HZ / this.playCallHz) - 1;
      if (address === 0xdc04) this.timerSample = (this.timerSample + 7) % 40;
      const value = Math.round((latch * (40 - this.timerSample)) / 40);
      return address === 0xdc04 ? value & 0xff : value >> 8;
    }
    const offset = address - SIMULATED_SCREEN_ADDRESS;
    if (offset >= 0 && offset < TITLE.length) return toScreenCode(TITLE[offset]);
    if (offset >= 920 && offset < 925) {
      const shown = Math.floor(this.clockSeconds);
      const text = `${String(Math.floor(shown / 60) % 100).padStart(2, "0")}:${String(shown % 60).padStart(2, "0")}`;
      return text.charCodeAt(offset - 920);
    }
    if (offset >= 0 && offset < 1000) return 0x20;
    return 0;
  }

  private advance() {
    const now = this.now();
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
