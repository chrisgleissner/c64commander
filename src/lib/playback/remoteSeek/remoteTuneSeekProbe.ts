/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { SidHeaderMetadata } from "@/lib/sid/sidUtils";
import {
  CPU_SPEED_ITEM,
  readU64ConfigItem,
  SYSTEM_MODE_ITEM,
  type FastForwardMethod,
  type RemoteSeekDeviceApi,
} from "./remoteSeekDeviceGuard";
import { remoteSeekErrorDetails as errorDetails } from "./remoteSeekErrors";
import {
  cpuSpeedMhz,
  isSixtyHzMachine,
  machineTimingFor,
  NTSC_FRAME_LINES,
  NTSC_TUNE_ON_PAL_CYCLES,
  PAL_FRAME_LINES,
  PAL_TUNE_ON_NTSC_CYCLES,
  type MachineTiming,
} from "./remoteSeekPlan";
import { locateSidPlayerClock } from "./sidPlayerClock";
import { scanForFastForwardPatch } from "./sidPlayerFastForwardPatch";
import type { SidPlayerClockField } from "./sidPlayerScreen";

/** Whether, and how, a tune the C64 plays itself can be seeked: decided once per tune, after it starts. */

export type RemoteTuneSeekProfile = {
  /** Where the player draws its clock, found on the screen rather than assumed. */
  clock: SidPlayerClockField;
  timing: MachineTiming;
  /** Play calls per second when the header settles it; null for a CIA-timed tune, which is measured. */
  headerPlayCallHz: number | null;
  /** Empty when the machine has no CPU Speed; fast forward then runs at the machine's own speed. */
  cpuSpeedOptions: string[];
  /** The left-arrow key where the machine takes key input, else the player's own keyboard routine. */
  fastForward: FastForwardMethod;
  /**
   * How a rewind starts the sub tune again: the player's minus and plus keys, or, without key input,
   * starting the tune afresh the way the Play page started it.
   */
  restart: "keys" | "replay";
};

const RASTER_SAMPLES = 60;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Lines in the frames the machine runs now, from the raster line ($D011 bit 7 and $D012) read at
 * uneven times: a line past the last of an NTSC frame means PAL. Sixty reads all miss PAL's last 49
 * lines about once in 30,000 tries. Null when the raster cannot be read.
 */
export const measureFrameLines = async (api: RemoteSeekDeviceApi, isCurrent: () => boolean): Promise<number | null> => {
  let highest = -1;
  try {
    for (let index = 0; index < RASTER_SAMPLES && isCurrent(); index += 1) {
      if (index > 0) await sleep((index * 7) % 20);
      const [d011, d012] = await api.readMemory("D011", 2, { __c64uIntent: "user", __c64uBypassCooldown: true });
      highest = Math.max(highest, ((d011 & 0x80) << 1) | d012);
      if (highest >= NTSC_FRAME_LINES) return PAL_FRAME_LINES;
    }
  } catch (error) {
    addLog("warn", "Remote seek: raster unreadable; timing the tune by System Mode", errorDetails(error));
    return null;
  }
  return highest < 0 ? null : NTSC_FRAME_LINES;
};

/** Why a tune cannot be seeked on the C64, or null when it can be as far as its header tells. */
export const remoteSeekHeaderBlocker = (header: SidHeaderMetadata | null): string | null => {
  if (!header) return "the tune's header is not available";
  if (header.magicId !== "PSID") return "RSID tunes run their own interrupt, which the player cannot speed up";
  if (header.playAddress === 0) return "the tune installs its own interrupt, which the player cannot speed up";
  return null;
};

/** Play calls per second from the header, or null when the tune's own CIA timer decides it. */
export const headerPlayCallHz = (header: SidHeaderMetadata, songNr: number, timing: MachineTiming): number | null => {
  const speedBit = Math.min(Math.max(songNr, 1), 32) - 1;
  if (((header.speedBits >>> speedBit) & 1) === 1) return null;
  const sixtyHz = isSixtyHzMachine(timing);
  if (header.clock === "ntsc" && !sixtyHz) return timing.ciaClockHz / NTSC_TUNE_ON_PAL_CYCLES;
  if (header.clock === "pal" && sixtyHz) return timing.ciaClockHz / PAL_TUNE_ON_NTSC_CYCLES;
  return timing.frameHz;
};

/**
 * Find the player's clock after a tune starts, and the settings a seek depends on.
 * Returns null when the C64 shows no ticking clock, e.g. on a simulated device.
 */
export const probeRemoteTuneSeek = async (
  api: RemoteSeekDeviceApi,
  header: SidHeaderMetadata,
  songNr: number,
  isCurrent: () => boolean = () => true,
  { keyInput = true }: { keyInput?: boolean } = {},
): Promise<RemoteTuneSeekProfile | null> => {
  const clock = await locateSidPlayerClock(api.readMemory, isCurrent);
  if (clock === null) return null;
  const patch = keyInput ? null : await scanForFastForwardPatch(api.readMemory, isCurrent);
  if (!keyInput && patch === null) {
    addLog("debug", "Remote seek unavailable: no key input, and the player's keyboard routine was not found");
    return null;
  }
  const fastForward: FastForwardMethod = patch
    ? { kind: "patch", ldyOperandAddress: patch.ldyOperandAddress }
    : { kind: "key" };
  const systemMode = await readU64ConfigItem(api, SYSTEM_MODE_ITEM).catch((error) => {
    addLog("warn", "Remote seek: System Mode unreadable; assuming PAL timing", errorDetails(error));
    return null;
  });
  const cpuSpeed = await readU64ConfigItem(api, CPU_SPEED_ITEM).catch((error) => {
    addLog("warn", "Remote seek: CPU Speed unreadable; fast forward only", errorDetails(error));
    return null;
  });
  const timing = machineTimingFor(systemMode?.value, await measureFrameLines(api, isCurrent));
  const cpuSpeedOptions = (cpuSpeed?.options ?? []).filter((option) => cpuSpeedMhz(option) !== null);
  return {
    clock,
    timing,
    headerPlayCallHz: headerPlayCallHz(header, songNr, timing),
    cpuSpeedOptions: cpuSpeedOptions.length > 1 ? cpuSpeedOptions : [],
    fastForward,
    restart: keyInput ? "keys" : "replay",
  };
};
