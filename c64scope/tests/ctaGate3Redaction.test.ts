/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { redactGate3SecretText } from "../src/cta/gate3.js";

describe("Gate 3 evidence redaction", () => {
  it("redacts the configured test password from evidence text", () => {
    expect(redactGate3SecretText("typing password: pwd")).toBe("typing password: [REDACTED]");
    expect(redactGate3SecretText("Password field value after edit: pwd")).toBe(
      "Password field value after edit: [REDACTED]",
    );
  });
});
