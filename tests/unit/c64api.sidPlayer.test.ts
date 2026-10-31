/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { C64API } from "@/lib/c64api";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import {
  MODE_SWITCH_GRACE_MS,
  resetDeviceTrafficGateForTests,
  SidPlayerTrafficBlockedError,
} from "@/lib/appMode/deviceTrafficGate";
import { addErrorLog, addLog } from "@/lib/logging";

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

const enterSidPlayerLongAgo = () => {
  saveStartupModeByUser("sid-player");
  vi.setSystemTime(Date.now() + MODE_SWITCH_GRACE_MS + 1);
};

describe("C64API in SID Player", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    localStorage.clear();
    saveStartupModeByUser("default");
    resetDeviceTrafficGateForTests();
    vi.mocked(addLog).mockClear();
    vi.mocked(addErrorLog).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  });

  afterEach(() => vi.useRealTimers());

  it("SPM-NET-03 a REST call in SID Player is refused before dispatch, with one warning", async () => {
    enterSidPlayerLongAgo();
    const api = new C64API("http://c64u");

    await expect(api.getInfo()).rejects.toBeInstanceOf(SidPlayerTrafficBlockedError);
    await expect(api.getInfo()).rejects.toBeInstanceOf(SidPlayerTrafficBlockedError);

    expect(fetch).not.toHaveBeenCalled();
    const warnings = vi
      .mocked(addLog)
      .mock.calls.filter(([level, message]) => level === "warn" && String(message).includes("SID Player blocked"));
    expect(warnings).toHaveLength(1);
  });

  it("SPM-NET-03 the same call in Full App reaches the network", async () => {
    const api = new C64API("http://c64u");
    await expect(api.getInfo()).rejects.toThrow();
    expect(fetch).toHaveBeenCalled();
  });

  it("SPM-NET-03 the memory and upload methods are refused too, with the host in the gate detail", async () => {
    enterSidPlayerLongAgo();
    const api = new C64API("http://c64u");
    const bytes = new Uint8Array([1, 2, 3]);
    const blob = new Blob([bytes]);
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["readMemory", () => api.readMemory("0400", 4)],
      ["writeMemory", () => api.writeMemory("0400", bytes)],
      ["writeMemoryBlock", () => api.writeMemoryBlock("0400", bytes)],
      ["mountDriveUpload", () => api.mountDriveUpload("a", new Blob([new Uint8Array(174848)]), "d64")],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(SidPlayerTrafficBlockedError);
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(api.readMemory("0400", 4)).rejects.toMatchObject({
      detail: expect.objectContaining({ host: "c64u" }),
    });
  });

  it("SPM-NET-03 a refused call logs only the gate warning, no request entry and no error", async () => {
    enterSidPlayerLongAgo();
    const api = new C64API("http://c64u");
    for (let attempt = 0; attempt < 3; attempt += 1) await expect(api.getInfo()).rejects.toThrow();
    expect(vi.mocked(addErrorLog).mock.calls).toEqual([]);
    expect(vi.mocked(addLog).mock.calls.map(([level, message]) => `${level}:${message}`)).toEqual([
      "warn:SID Player blocked device traffic: rest",
    ]);
  });

  it("SPM-NET-03 only request and fetchWithTimeout reach the network primitives", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/lib/c64api.ts"), "utf8").split("\n");
    const header = /^ {2}(?:private |public |protected |static )?(?:async )?(\w+)(?:<[^>]*>)?\(/;
    const primitive = /(?:^|[^\w.])(fetchWithSignalCompatibility|capacitorHttpDeviceFetch)\(/;
    let current = "";
    const users = new Set<string>();
    source.forEach((line) => {
      const match = header.exec(line);
      if (match) current = match[1];
      if (
        /^(?:const|async function|function)\b/.test(line) ||
        /^export (?:const|async function|function)\b/.test(line)
      ) {
        current = "<module>";
      }
      if (primitive.test(line) && !/^\s*(?:\/\/|\*)/.test(line) && !/^(?:export )?const /.test(line))
        users.add(current);
    });
    expect([...users].sort()).toEqual(["<module>", "fetchWithTimeout", "request"].filter((name) => users.has(name)));
    expect(users.has("<module>") ? [...users].filter((name) => name !== "<module>").sort() : [...users].sort()).toEqual(
      ["fetchWithTimeout", "request"],
    );
  });
});
