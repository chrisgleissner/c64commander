/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCAL_SID_MODEL,
  loadLearnedDeviceSidModel,
  loadLocalSidModel,
  loadLocalSidModelFromDevice,
  resolveLocalSidModel,
  saveLearnedDeviceSidModel,
  saveLocalSidModel,
  saveLocalSidModelFromDevice,
} from "@/lib/config/appSettings";
import { buildRenderedTuneKey } from "@/lib/playback/renderedTuneCache";
import { toEngineSidModel } from "@/lib/playback/localSidWorkerProtocol";
import { LocalSidEngine, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

beforeEach(() => {
  localStorage.clear();
});

describe("fallback SID model preference", () => {
  it("defaults to the chip libsidplayfp itself assumes, so a fresh install sounds unchanged", () => {
    expect(DEFAULT_LOCAL_SID_MODEL).toBe("8580");
    expect(loadLocalSidModel()).toBe("8580");
    expect(resolveLocalSidModel()).toBe("8580");
  });

  it("infers from the connected machine by default", () => {
    expect(loadLocalSidModelFromDevice()).toBe(true);
  });

  it("prefers the chip learned from the machine over the manual choice", () => {
    saveLocalSidModel("8580");
    saveLearnedDeviceSidModel("6581");
    expect(resolveLocalSidModel()).toBe("6581");
  });

  it("uses the manual choice once inference is switched off, without forgetting what was learned", () => {
    saveLocalSidModel("8580");
    saveLearnedDeviceSidModel("6581");
    saveLocalSidModelFromDevice(false);
    expect(resolveLocalSidModel()).toBe("8580");
    // Switching inference back on must restore the learned chip rather than start again from
    // nothing, or turning the setting off would quietly cost the user their device reading.
    saveLocalSidModelFromDevice(true);
    expect(resolveLocalSidModel()).toBe("6581");
  });

  it("uses the manual choice while nothing has been learned yet", () => {
    saveLocalSidModel("6581");
    expect(loadLearnedDeviceSidModel()).toBeNull();
    expect(resolveLocalSidModel()).toBe("6581");
  });

  it("survives a restart", async () => {
    saveLearnedDeviceSidModel("6581");
    saveLocalSidModel("8580");
    // A restart is a fresh module graph reading the same storage; nothing in memory carries over.
    vi.resetModules();
    const reloaded = await import("@/lib/config/appSettings");
    expect(reloaded.loadLearnedDeviceSidModel()).toBe("6581");
    expect(reloaded.resolveLocalSidModel()).toBe("6581");
  });

  it("ignores a stored value that is not one of the two chips", () => {
    localStorage.setItem("c64u_local_sid_model", "MOS6581");
    localStorage.setItem("c64u_learned_device_sid_model", "SwinSID");
    expect(loadLocalSidModel()).toBe("8580");
    expect(loadLearnedDeviceSidModel()).toBeNull();
  });
});

describe("toEngineSidModel", () => {
  it("translates to libsidplayfp's spelling", () => {
    expect(toEngineSidModel("6581")).toBe("MOS6581");
    expect(toEngineSidModel("8580")).toBe("MOS8580");
  });
});

describe("buildRenderedTuneKey", () => {
  it("separates subsongs of one file", () => {
    expect(buildRenderedTuneKey("hvsc/Commando.sid", 0)).not.toBe(buildRenderedTuneKey("hvsc/Commando.sid", 1));
  });

  it("separates renders made on different chips", () => {
    saveLocalSidModelFromDevice(false);
    saveLocalSidModel("6581");
    const on6581 = buildRenderedTuneKey("hvsc/Commando.sid", 0);
    saveLocalSidModel("8580");
    // Cached PCM was produced by whichever chip was configured at the time. Reusing it after the
    // chip changed would keep serving the old performance, and a lead-in cached under the old
    // chip would hand over to live rendering under the new one part-way through a track.
    expect(buildRenderedTuneKey("hvsc/Commando.sid", 0)).not.toBe(on6581);
  });
});

/** A fake worker that only records what the engine posted. */
class RecordingWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: "message", handler: (event: MessageEvent<LocalSidWorkerToMain>) => void): void;
  addEventListener(type: "error", handler: (event: { message?: string }) => void): void;
  addEventListener(type: "messageerror", handler: () => void): void;
  addEventListener(type: string, handler: (...args: never[]) => void): void {
    if (type === "message") this.handler = handler as typeof this.handler;
  }
  terminate(): void {}
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LocalSidEngine chip selection", () => {
  it("sends the resolved chip with every tune it opens, and never forces it", async () => {
    saveLearnedDeviceSidModel("6581");
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    void engine.play(new ArrayBuffer(64), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await flush();
    const open = worker.sent.find((message) => message.type === "open");
    expect(open).toMatchObject({ sidModel: "MOS6581" });
    // Forcing would override each tune's own header, which is the opposite of a fallback.
    expect(open).not.toHaveProperty("forceSidModel");
  });

  it("picks up a chip change on the next tune without a restart", async () => {
    saveLocalSidModelFromDevice(false);
    saveLocalSidModel("8580");
    const worker = new RecordingWorker();
    const engine = new LocalSidEngine({ workerFactory: () => worker });
    void engine.play(new ArrayBuffer(64), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await flush();
    expect(worker.sent.find((message) => message.type === "open")).toMatchObject({ sidModel: "MOS8580" });

    saveLocalSidModel("6581");
    void engine.play(new ArrayBuffer(64), 0, {});
    await flush();
    const opens = worker.sent.filter((message) => message.type === "open");
    expect(opens).toHaveLength(2);
    expect(opens[1]).toMatchObject({ sidModel: "MOS6581" });
  });
});
