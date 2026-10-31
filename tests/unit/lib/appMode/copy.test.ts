/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { MODE_COPY, MODE_NAMES } from "@/lib/appMode/copy";

const FEATURE_NAMES = new Set([
  "SID",
  "Player",
  "Full",
  "App",
  "Demo",
  "Mode",
  "C64",
  "HVSC",
  "Live",
  "View",
  "Radio",
  "Ultimate",
  "Settings",
  "Play",
  "Docs",
  "Home",
  "WiFi",
]);
const BRITISH =
  /\b(colour|favourite|behaviour|organis|recognis|centre|licence|analogue|catalogue|grey|whilst|towards|cancelled)\w*/i;

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Object.values(value as object).flatMap(strings);

const sentenceCaseViolations = (text: string): string[] =>
  text
    .split(/(?<=[.?!])\s+/)
    .flatMap((sentence) => sentence.split(/\s+/).slice(1))
    .filter((word) => /^[A-Z][a-z]/.test(word) && !FEATURE_NAMES.has(word.replace(/[^A-Za-z0-9]/g, "")));

describe("mode copy", () => {
  it("SPM-SWT-03 SID Player copy is sentence case", () => {
    for (const text of strings(MODE_COPY)) {
      expect(sentenceCaseViolations(text), text).toEqual([]);
    }
  });

  it("SPM-SWT-03 SID Player copy is American English and names no unannounced hardware", () => {
    for (const text of [...strings(MODE_COPY), ...strings(MODE_NAMES)]) {
      expect(text).not.toMatch(BRITISH);
      expect(text).not.toMatch(/callback|sailfish|jolla|8020/i);
    }
  });

  it("SPM-TONE-01 SID Player-only copy avoids the jargon list", () => {
    const jargon = /\b(REST|FTP|Telnet|host|IP|PAL|NTSC|dB|KERNAL|BASIC|6581|8580)\b/;
    for (const text of [...strings(MODE_COPY)]) {
      expect(text).not.toMatch(jargon);
    }
  });

  it("SPM-SWT-03 the compact bodies fit two compact lines", () => {
    for (const body of [MODE_COPY.enter.compactBody, MODE_COPY.leave.compactBody, MODE_COPY.firstRun.compactBody]) {
      expect(body.length, body).toBeLessThanOrEqual(50);
    }
  });

  it("SPM-SWT-03 the mode names are the ones the spec fixes", () => {
    expect(MODE_NAMES).toEqual({ fullApp: "Full App", demoMode: "Demo Mode", sidPlayer: "SID Player" });
  });

  it("SPM-TONE-02 the first-run dialog says what to do in plain words, without ROM or network jargon", () => {
    const text = strings(MODE_COPY.firstRun).join(" ");
    expect(text).not.toMatch(/\b(REST|FTP|IP|host|KERNAL|BASIC|PAL|NTSC|dB)\b/);
    expect(MODE_COPY.firstRun.useSidPlayer).toBe("Use SID Player");
    expect(MODE_COPY.firstRun.tryDemoMode).toBe("Try Demo Mode");
    expect(MODE_COPY.firstRun.retry).toBe("Retry connection");
  });
});
