/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolveTransportFailureMessage } from "@/lib/c64api/requestFailureMessage";
import { isTransientConnectivityFailure } from "@/lib/uiErrors";

describe("resolveTransportFailureMessage", () => {
  it("names the time limit in whole or fractional seconds when the request ran out of time", () => {
    expect(resolveTransportFailureMessage("signal is aborted", { timedOut: true, timeoutMs: 15_000 })).toBe(
      "The C64 did not answer within 15 s",
    );
    expect(resolveTransportFailureMessage("Request timed out", { timedOut: true, timeoutMs: 1_500 })).toBe(
      "The C64 did not answer within 1.5 s",
    );
  });

  it("keeps host unreachable for a failure the network layer reported, even after the timer fired", () => {
    expect(resolveTransportFailureMessage("Failed to fetch", { timedOut: true, timeoutMs: 15_000 })).toBe(
      "Host unreachable",
    );
    expect(resolveTransportFailureMessage("Unable to resolve host c64u", { timedOut: false, timeoutMs: 15_000 })).toBe(
      "Host unreachable (DNS)",
    );
  });

  it("produces a timeout message that still counts as a transient connectivity failure", () => {
    const message = resolveTransportFailureMessage("signal is aborted", { timedOut: true, timeoutMs: 15_000 });
    expect(isTransientConnectivityFailure(message)).toBe(true);
  });
});
