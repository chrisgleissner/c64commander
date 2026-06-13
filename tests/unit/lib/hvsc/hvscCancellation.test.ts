/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  HVSC_CANCELLATION_CODE,
  createHvscCancellationError,
  isHvscCancellationError,
} from "@/lib/hvsc/hvscCancellation";

describe("isHvscCancellationError", () => {
  it("recognizes a typed cancellation error by its marker props", () => {
    const error = createHvscCancellationError();
    expect(error.code).toBe(HVSC_CANCELLATION_CODE);
    expect(isHvscCancellationError(error)).toBe(true);
  });

  it("recognizes an AbortError by name", () => {
    const error = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isHvscCancellationError(error)).toBe(true);
  });

  it("recognizes a boundary-stripped cancellation that only carries a message", () => {
    // The native HVSC bridge (and any structured-clone boundary) drops the
    // marker props and surfaces a plain Error, so a user-initiated cancel must
    // still be detected from its message — otherwise it is mis-reported as a
    // failure toast.
    expect(isHvscCancellationError(new Error("HVSC update cancelled"))).toBe(true);
    expect(isHvscCancellationError(new Error("Cancelled"))).toBe(true);
    expect(isHvscCancellationError(new Error("operation was canceled"))).toBe(true);
  });

  it("does not treat unrelated failures (or incidental 'cancelled' mentions) as cancellations", () => {
    expect(isHvscCancellationError(new Error("Host unreachable"))).toBe(false);
    expect(isHvscCancellationError(new Error("download failed"))).toBe(false);
    // A network failure that merely mentions the word must still surface as a
    // real failure — the message match is anchored to the end of the message.
    expect(isHvscCancellationError(new Error("cancelled by network peer"))).toBe(false);
    expect(isHvscCancellationError(null)).toBe(false);
    expect(isHvscCancellationError("cancelled")).toBe(false);
  });
});
