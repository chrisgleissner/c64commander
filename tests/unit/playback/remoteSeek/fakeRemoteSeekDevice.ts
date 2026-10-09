/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SidPlayerSimulation, type SidPlayerSimulationOptions } from "../../../mocks/sidPlayerSimulation";
import type { RemoteSeekApi } from "@/lib/playback/remoteSeek/remoteSidSeekController";

export const C64U_CPU_SPEEDS = [
  " 1",
  " 2",
  " 3",
  " 4",
  " 6",
  " 8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
  "32",
  "40",
  "48",
  "64",
];
export const TURBO_CONTROL_VALUES = ["Off", "Manual", "U64 Turbo Registers", "TurboEnable Bit"];
export const DEVICE_KEY = JSON.stringify(["5d0464", "c64u"]);

type Settings = { "CPU Speed": string; "Turbo Control": string; "System Mode": string; "Vol Master": string };
export const MASTER_VOLUME_VALUES = ["OFF", "-42 dB", "-6 dB", " 0 dB", "+6 dB"];

/**
 * A C64 Ultimate as remote seeking talks to it: the SID player simulation behind readmem and
 * machine:input, and the three U64 settings behind the config endpoints. Every request is logged
 * in order, so tests can assert what reached the device and when.
 */
export const createFakeRemoteSeekDevice = (
  options: SidPlayerSimulationOptions & {
    settings?: Partial<Settings>;
    deviceKey?: string;
    latencyMs?: number;
    /** Extra latency of up to this much on each request, varying from request to request. */
    latencyJitterMs?: number;
    /** How long a config write waits, as the app's config write interval makes it wait. */
    configWriteDelayMs?: number;
    /**
     * The Ultimate-II+(L): no key input (machine:input answers 501) and no U64 Specific Settings,
     * so no CPU Speed, Turbo Control or System Mode either.
     */
    cartridge?: boolean;
  } = {},
) => {
  const player = new SidPlayerSimulation(options);
  const settings: Settings = {
    "CPU Speed": " 1",
    "Turbo Control": "Manual",
    "System Mode": "PAL",
    "Vol Master": " 0 dB",
    ...options.settings,
  };
  const log: string[] = [];
  /** A failing key event leaves the key as it was; `keyEventStallMs` makes it fail as a timeout would, that late. */
  const failures = { configWrites: 0, keyEvents: 0, keyEventStallMs: 0 };
  let connectedKey: string | null = options.deviceKey ?? DEVICE_KEY;
  const latencyMs = options.latencyMs ?? 0;
  let jitterStep = 0;
  const jitter = () => {
    jitterStep = (jitterStep + 7) % 11;
    return Math.round(((options.latencyJitterMs ?? 0) * jitterStep) / 10);
  };
  const roundTrip = () => {
    const delay = latencyMs + jitter();
    return delay > 0 ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve();
  };
  const applySpeed = () =>
    player.setCpuSpeedMhz(settings["Turbo Control"] === "Off" ? 1 : Number(settings["CPU Speed"].trim()));
  applySpeed();

  const api: RemoteSeekApi = {
    currentDeviceKey: () => connectedKey,
    getConfigItem: async (category, item) => {
      if (options.cartridge) throw new Error(`HTTP 404 ${category} / ${item}`);
      const values =
        item === "CPU Speed"
          ? C64U_CPU_SPEEDS
          : item === "Turbo Control"
            ? TURBO_CONTROL_VALUES
            : item === "Vol Master"
              ? MASTER_VOLUME_VALUES
              : ["PAL", "NTSC", "PAL-60", "NTSC-50"];
      return { [category]: { [item]: { current: settings[item as keyof Settings], values } } } as never;
    },
    setConfigValue: async (_category, item, value, flags) => {
      if (options.configWriteDelayMs) await new Promise((resolve) => setTimeout(resolve, options.configWriteDelayMs));
      if (failures.configWrites > 0) {
        failures.configWrites -= 1;
        log.push(`FAILED ${item}=${String(value).trim()}`);
        throw new Error("HTTP 503");
      }
      log.push(
        `${item}=${String(value).trim()}${flags?.__c64uTransientConfigRestore ? " (restore)" : flags?.__c64uTransientConfigWrite ? " (transient)" : ""}`,
      );
      settings[item as keyof Settings] = String(value);
      applySpeed();
      return {} as never;
    },
    sendMachineInputBatch: async ({ events }) => {
      await roundTrip();
      if (options.cartridge) throw new Error("HTTP 501 Not Implemented");
      for (const event of events) {
        if (event.kind !== "keyboard") continue;
        if (failures.keyEvents > 0) {
          failures.keyEvents -= 1;
          if (failures.keyEventStallMs) await new Promise((resolve) => setTimeout(resolve, failures.keyEventStallMs));
          log.push(`FAILED key ${event.transition} ${event.inputs.join("+")}`);
          throw new Error("HTTP 503");
        }
        log.push(`key ${event.transition} ${event.inputs.join("+")}`);
        for (const key of event.inputs) {
          if (event.transition === "press") player.pressKey(key);
          else player.releaseKey(key);
        }
      }
      return {};
    },
    getMachineInputState: async () => {
      if (options.cartridge) throw new Error("HTTP 501 Not Implemented");
      return { keyboard: { inputs: player.heldKeys } };
    },
    writeMemory: async (address, data) => {
      await roundTrip();
      log.push(`writemem ${address} ${Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
      player.writeMemory(parseInt(address, 16), data);
      return {};
    },
    readMemory: async (address, length) => {
      await roundTrip();
      return player.readMemory(parseInt(address, 16), length);
    },
  };

  return {
    api,
    player,
    settings,
    log,
    failures,
    connectTo: (key: string | null) => {
      connectedKey = key;
    },
  };
};
