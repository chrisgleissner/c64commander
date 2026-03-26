/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decrementFtpInFlight,
  decrementRestInFlight,
  decrementTelnetInFlight,
  getDiagnosticsActivitySnapshot,
  incrementFtpInFlight,
  incrementRestInFlight,
  incrementTelnetInFlight,
  resetDiagnosticsActivity,
} from "@/lib/diagnostics/diagnosticsActivity";

describe("diagnosticsActivity", () => {
  beforeEach(() => {
    resetDiagnosticsActivity();
  });

  it("tracks in-flight counts and emits updates", () => {
    const handler = vi.fn();
    window.addEventListener("c64u-activity-updated", handler);

    incrementRestInFlight();
    incrementFtpInFlight();
    incrementTelnetInFlight();
    expect(getDiagnosticsActivitySnapshot()).toEqual({
      restInFlight: 1,
      ftpInFlight: 1,
      telnetInFlight: 1,
    });
    expect(handler).toHaveBeenCalledTimes(3);

    decrementRestInFlight();
    decrementFtpInFlight();
    decrementTelnetInFlight();
    expect(getDiagnosticsActivitySnapshot()).toEqual({
      restInFlight: 0,
      ftpInFlight: 0,
      telnetInFlight: 0,
    });
    expect(handler).toHaveBeenCalledTimes(6);

    resetDiagnosticsActivity();
    expect(getDiagnosticsActivitySnapshot()).toEqual({
      restInFlight: 0,
      ftpInFlight: 0,
      telnetInFlight: 0,
    });
    expect(handler).toHaveBeenCalledTimes(7);

    window.removeEventListener("c64u-activity-updated", handler);
  });

  it("clamps decrement operations at zero", () => {
    const handler = vi.fn();
    window.addEventListener("c64u-activity-updated", handler);

    decrementRestInFlight();
    decrementFtpInFlight();
    decrementTelnetInFlight();
    expect(getDiagnosticsActivitySnapshot()).toEqual({
      restInFlight: 0,
      ftpInFlight: 0,
      telnetInFlight: 0,
    });
    expect(handler).toHaveBeenCalledTimes(3);

    window.removeEventListener("c64u-activity-updated", handler);
  });
});
