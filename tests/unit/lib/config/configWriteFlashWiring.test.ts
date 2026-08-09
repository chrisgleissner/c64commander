/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown> = {}) => ({ ...details, error }),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: () => "http://127.0.0.1",
  updateHasChanges: vi.fn(),
}));

import { C64API } from "@/lib/c64api";
import { savePersistConfigToFlash } from "@/lib/config/appSettings";
import { CONFIG_FLASH_SAVE_QUIET_MS, __resetConfigFlashPersistence } from "@/lib/config/configFlashPersistence";

/**
 * The wiring, not the policy.
 *
 * `configFlashPersistence` decides WHETHER to save; these tests check that a config write actually
 * reaches it. Nothing else in the app would notice if that call were dropped — the device would
 * keep applying settings and keep forgetting them, exactly as it did before, and every other test
 * would still pass.
 */
describe("config writes and flash persistence", () => {
  const originalFetch = globalThis.fetch;
  let requests: string[];

  beforeEach(() => {
    // `shouldAdvanceTime` because the API paces config writes through its own throttle: a frozen
    // clock never lets the second write in a run reach the wire.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    __resetConfigFlashPersistence();
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        // A config write validates the value against the category spec the device reports first, so
        // a read has to answer with a plausible item or nothing reaches the wire at all.
        const body =
          (init?.method ?? "GET") === "GET"
            ? {
                "U64 Specific Settings": { "Palette Definition": { current: "", presets: [""], default: "" } },
                "C64 and Cartridge Settings": { Cartridge: { current: "", presets: [""], default: "" } },
                errors: [],
              }
            : { errors: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  const settle = () => vi.advanceTimersByTimeAsync(CONFIG_FLASH_SAVE_QUIET_MS + 50);
  const savedToFlash = () => requests.filter((url) => url.includes("save_to_flash"));

  it("writes an item to flash after a single-item write, once the user has opted in", async () => {
    savePersistConfigToFlash(true);
    const api = new C64API("http://127.0.0.1");

    await api.setConfigValue("U64 Specific Settings", "Palette Definition", "night.vpl");
    await settle();

    expect(savedToFlash()).toHaveLength(1);
  });

  it("writes to flash after a batch write too", async () => {
    savePersistConfigToFlash(true);
    const api = new C64API("http://127.0.0.1");

    await api.updateConfigBatch({ "U64 Specific Settings": { "Palette Definition": "night.vpl" } });
    await settle();

    expect(savedToFlash()).toHaveLength(1);
  });

  it("leaves the change transient while the setting is off, which is the default", async () => {
    const api = new C64API("http://127.0.0.1");

    await api.setConfigValue("U64 Specific Settings", "Palette Definition", "night.vpl");
    await settle();

    expect(savedToFlash()).toHaveLength(0);
  });

  it("does not persist a write the app intends to undo", async () => {
    // The launch-safety cartridge swap and the health-check probe both set a value, act, and set it
    // back. Writing the intermediate value to flash would make a workaround permanent if the
    // restore never happened.
    savePersistConfigToFlash(true);
    const api = new C64API("http://127.0.0.1");

    await api.setConfigValue("C64 and Cartridge Settings", "Cartridge", "", {
      __c64uTransientConfigWrite: true,
    });
    await settle();

    expect(savedToFlash()).toHaveLength(0);
  });
});
