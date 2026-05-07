/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// CI guard: CapacitorHttp routes every fetch through a JNI bridge plus the
// CapacitorCookies plugin. For C64 Commander on Android this adds 30-80 ms
// per LAN REST request, breaks AbortController propagation, and pollutes
// logcat. It must stay disabled unless a documented exemption is present in
// capacitor.config.ts (a comment containing "CAPACITOR_HTTP_EXEMPTION").

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configPath = resolve(repoRoot, "capacitor.config.ts");

const readConfig = () => readFileSync(configPath, "utf-8");

const findCapacitorHttpEnabled = (source: string): "true" | "false" | null => {
  const match = source.match(/CapacitorHttp\s*:\s*\{[^}]*enabled\s*:\s*(true|false)/s);
  return match ? (match[1] as "true" | "false") : null;
};

const hasExemption = (source: string) => /CAPACITOR_HTTP_EXEMPTION/.test(source);

describe("capacitor.config.ts", () => {
  it("declares CapacitorHttp.enabled explicitly", () => {
    const source = readConfig();
    expect(findCapacitorHttpEnabled(source)).not.toBeNull();
  });

  it("keeps CapacitorHttp disabled unless an exemption is documented", () => {
    const source = readConfig();
    const enabled = findCapacitorHttpEnabled(source);
    if (enabled === "true") {
      expect(
        hasExemption(source),
        "CapacitorHttp.enabled = true requires a CAPACITOR_HTTP_EXEMPTION comment in capacitor.config.ts",
      ).toBe(true);
    } else {
      expect(enabled).toBe("false");
    }
  });

  it("uses androidScheme http so direct fetch can reach LAN HTTP devices", () => {
    const source = readConfig();
    expect(source).toMatch(/androidScheme\s*:\s*"http"/);
  });
});
