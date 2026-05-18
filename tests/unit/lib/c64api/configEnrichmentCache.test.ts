/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildConfigEnrichmentNamespaceKey,
  clearAllConfigEnrichmentCache,
  loadConfigEnrichmentCategory,
  loadConfigEnrichmentNamespaceForHost,
  rememberConfigEnrichmentNamespaceForHost,
  saveConfigEnrichmentCategory,
} from "@/lib/c64api/configEnrichmentCache";

describe("configEnrichmentCache", () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllConfigEnrichmentCache();
  });

  it("round-trips cached category metadata through localStorage", () => {
    const namespaceKey = rememberConfigEnrichmentNamespaceForHost("u64", "u64-id", "3.14e");

    saveConfigEnrichmentCategory(namespaceKey, "Audio Mixer", {
      "Vol Socket 1": {
        selected: "0 dB",
        values: ["OFF", "-6 dB", "0 dB", "+6 dB"],
      },
    });

    expect(loadConfigEnrichmentNamespaceForHost("u64")).toBe(namespaceKey);
    expect(loadConfigEnrichmentCategory(namespaceKey, "Audio Mixer")).toEqual({
      "Vol Socket 1": {
        selected: "0 dB",
        values: ["OFF", "-6 dB", "0 dB", "+6 dB"],
      },
    });
  });

  it("keeps device namespaces isolated per host binding", () => {
    const u64Namespace = rememberConfigEnrichmentNamespaceForHost("u64", "u64-id", "3.14e");
    const c64uNamespace = rememberConfigEnrichmentNamespaceForHost("c64u", "c64u-id", "1.1.0");

    saveConfigEnrichmentCategory(u64Namespace, "U64 Specific Settings", {
      "System Mode": { selected: "PAL", values: ["PAL", "NTSC"] },
    });
    saveConfigEnrichmentCategory(c64uNamespace, "User Interface Settings", {
      "Color Scheme": { selected: "Commodore Blue", values: ["Commodore Blue"] },
    });

    expect(loadConfigEnrichmentNamespaceForHost("u64")).toBe(u64Namespace);
    expect(loadConfigEnrichmentNamespaceForHost("c64u")).toBe(c64uNamespace);
    expect(loadConfigEnrichmentCategory(u64Namespace, "User Interface Settings")).toBeNull();
    expect(loadConfigEnrichmentCategory(c64uNamespace, "U64 Specific Settings")).toBeNull();
  });

  it("invalidates stale firmware namespaces for the same device id", () => {
    const oldNamespace = rememberConfigEnrichmentNamespaceForHost("u64", "shared-device", "3.14d");
    saveConfigEnrichmentCategory(oldNamespace, "LED Strip Settings", {
      "LedStrip Mode": { selected: "Fixed Color", values: ["Off", "Fixed Color"] },
    });

    const nextNamespace = rememberConfigEnrichmentNamespaceForHost("u64", "shared-device", "3.14e");

    expect(nextNamespace).toBe(buildConfigEnrichmentNamespaceKey("shared-device", "3.14e"));
    expect(loadConfigEnrichmentNamespaceForHost("u64")).toBe(nextNamespace);
    expect(loadConfigEnrichmentCategory(oldNamespace, "LED Strip Settings")).toBeNull();
  });
});
