/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { FolderOpen } from "lucide-react";
import { configCategoryIcon } from "@/pages/config/configCategoryIcon";

const CATEGORIES = [
  "Audio Mixer",
  "SID Sockets Configuration",
  "U64 Specific Settings",
  "Network Settings",
  "WiFi settings",
  "Printer Settings",
  "Drive A Settings",
  "SoftIEC Drive Settings",
  "LED Strip Settings",
  "Data Streams",
  "Clock Settings",
];

describe("configCategoryIcon", () => {
  it("gives the machine's categories distinct icons instead of one folder", () => {
    const icons = CATEGORIES.map(configCategoryIcon);
    expect(icons).not.toContain(FolderOpen);
    expect(new Set(icons).size).toBeGreaterThanOrEqual(8);
  });

  it("falls back to the folder for a category it does not recognize", () => {
    expect(configCategoryIcon("Something New")).toBe(FolderOpen);
  });

  it("matches the Wi-Fi rule before the network rule", () => {
    expect(configCategoryIcon("WiFi settings")).not.toBe(configCategoryIcon("Network Settings"));
  });
});
