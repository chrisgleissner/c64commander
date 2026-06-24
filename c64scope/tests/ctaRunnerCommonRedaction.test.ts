/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { redactUiHierarchySecrets } from "../src/cta/runnerCommon.js";

describe("CTA hierarchy redaction", () => {
  it("redacts known secret literals from UI hierarchy XML", () => {
    const xml = '<node text="pwd" resource-id="password" /><node text="c64u" />';

    expect(redactUiHierarchySecrets(xml, ["pwd"])).toBe(
      '<node text="[REDACTED]" resource-id="password" /><node text="c64u" />',
    );
  });
});
