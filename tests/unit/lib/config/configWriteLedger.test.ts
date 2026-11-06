/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLog } from "@/lib/logging";
import {
  buildOwnRevertPayload,
  clearConfigWriteLedger,
  loadConfigWriteLedger,
  recordConfigWrite,
} from "@/lib/config/configWriteLedger";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

describe("config write ledger", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(addLog).mockClear();
    vi.restoreAllMocks();
  });

  it("keeps the last value written per item and device until cleared", () => {
    recordConfigWrite("http://c64u", "Audio Mixer", "Vol UltiSid 1", "+6 dB");
    recordConfigWrite("http://c64u", "Audio Mixer", "Vol UltiSid 1", "0 dB");
    recordConfigWrite("http://c64u", "Clock", "Hour", 12);
    recordConfigWrite("http://u64", "Clock", "Hour", 3);

    expect(loadConfigWriteLedger("http://c64u")).toEqual({
      "Audio Mixer": { "Vol UltiSid 1": "0 dB" },
      Clock: { Hour: 12 },
    });
    clearConfigWriteLedger("http://c64u");
    expect(loadConfigWriteLedger("http://c64u")).toEqual({});
    expect(loadConfigWriteLedger("http://u64")).toEqual({ Clock: { Hour: 3 } });
  });

  it("keeps one ledger for the simulated device's current loopback port only", () => {
    recordConfigWrite("http://127.0.0.1:40001", "Clock", "Hour", 1);
    recordConfigWrite("http://127.0.0.1:40002", "Clock", "Hour", 2);
    expect(loadConfigWriteLedger("http://127.0.0.1:40001")).toEqual({});
    expect(loadConfigWriteLedger("http://127.0.0.1:40002")).toEqual({ Clock: { Hour: 2 } });
  });

  it("reverts only items this phone wrote that still hold the value it wrote", () => {
    const baseline = { Audio: { Mine: "1", Theirs: "1", Untouched: "1", Back: "1", Unread: "1" } };
    const current = { Audio: { Mine: "2", Theirs: "3", Untouched: "4", Back: "1" } };
    const ledger = { Audio: { Mine: "2", Theirs: "2", Back: "2", Unread: "2" }, Gone: { Item: "2" } };

    expect(buildOwnRevertPayload(baseline, current, ledger)).toEqual({ Audio: { Mine: "1" } });
  });

  it("compares a numeric write with the string the device reports", () => {
    expect(buildOwnRevertPayload({ Clock: { Hour: "1" } }, { Clock: { Hour: "12" } }, { Clock: { Hour: 12 } })).toEqual(
      { Clock: { Hour: "1" } },
    );
  });

  it("logs, rather than throws, when the ledger cannot be read, stored or cleared", () => {
    localStorage.setItem("c64u_config_writes:http://c64u", "{not json");
    expect(loadConfigWriteLedger("http://c64u")).toEqual({});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    recordConfigWrite("http://c64u", "Clock", "Hour", 1);
    clearConfigWriteLedger("http://c64u");
    vi.restoreAllMocks();

    const messages = vi.mocked(addLog).mock.calls.map(([level, message]) => `${level} ${message}`);
    expect(messages).toEqual([
      "warn Config write ledger could not be read; revert will treat no setting as changed here",
      "warn Config write ledger could not be read; revert will treat no setting as changed here",
      "warn Config write ledger could not be stored; revert will skip this setting",
      "warn Config write ledger could not be cleared",
    ]);
  });
});
