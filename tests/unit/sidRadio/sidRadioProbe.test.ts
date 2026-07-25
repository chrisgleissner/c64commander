/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveSidRadioEnabled } from "@/lib/config/appSettings";
import { registerSidRadioProbe } from "@/lib/sidRadio/sidRadioProbe";

describe("registerSidRadioProbe", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__sidRadioProbe;
    delete window.__sidRadioReady;
  });
  afterEach(() => {
    delete window.__sidRadioProbe;
    delete window.__sidRadioReady;
  });

  it("does not install the probe when SID Radio is turned off", () => {
    saveSidRadioEnabled(false); // GA default is on, so disable it explicitly
    registerSidRadioProbe();
    expect(window.__sidRadioProbe).toBeUndefined();
  });

  it("installs window.__sidRadioProbe when SID Radio is enabled", () => {
    saveSidRadioEnabled(true);
    registerSidRadioProbe();
    expect(typeof window.__sidRadioProbe).toBe("function");
  });

  it("records the worker error on __sidRadioReady when Workers are unavailable", async () => {
    // jsdom has no Worker → the probe surfaces the off-main-thread guard error.
    saveSidRadioEnabled(true);
    registerSidRadioProbe();
    await expect(window.__sidRadioProbe!()).rejects.toThrow(/Web Workers|main thread/);
    expect(window.__sidRadioReady).toMatchObject({ error: expect.stringMatching(/Web Workers|main thread/) });
  });
});
