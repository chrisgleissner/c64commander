/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { reconciliationMarkdown, reconcileInventories } from "../src/cta/reconciliation.js";

describe("CTA inventory reconciliation", () => {
  it("reports missing, new, changed, and duplicate runtime controls", () => {
    const documented = [
      { fingerprint: "a", route: "/", label: "Reset", role: "button" },
      { fingerprint: "b", route: "/", label: "Reboot", role: "button" },
      { fingerprint: "dup", route: "/", label: "Duplicate", role: "button" },
      { fingerprint: "dup", route: "/", label: "Duplicate", role: "button" },
    ];
    const runtime = [
      { fingerprint: "a", route: "/", label: "Reset now", role: "button" },
      { fingerprint: "c", route: "/", label: "Pause", role: "button" },
    ];

    const result = reconcileInventories(documented, runtime);

    expect(result.documentedButNotFound.map((item) => item.fingerprint)).toEqual(["b", "dup", "dup"]);
    expect(result.foundButUndocumented.map((item) => item.fingerprint)).toEqual(["c"]);
    expect(result.changedTypeOrLabel).toHaveLength(1);
    expect(result.duplicates.map((item) => item.fingerprint)).toEqual(["dup", "dup"]);
    expect(reconciliationMarkdown(result)).toContain("Found But Undocumented");
  });
});
