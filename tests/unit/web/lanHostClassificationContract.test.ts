/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isLoopbackHost, isPrivateLanAddress, isTrustedInsecureHost } from "../../../web/server/src/hostValidation.js";

// HARD27-025: the same fixture drives LanHostClassificationContractTest on the
// Kotlin side, so the two implementations of the private-LAN address rule
// cannot drift apart without one of the two tests failing. Only addresses and
// the loopback name are shared; the name policies are platform-specific and
// each has its own test.
const FIXTURE_PATH = "android/app/src/test/resources/lan-host-classification.json";

interface HostCase {
  host: string;
  privateLan: boolean;
  loopback: boolean;
  note: string;
}

const cases = (JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: HostCase[] }).cases;

describe("private-LAN address classification contract", () => {
  it("covers both answers, so a rule that always returns the same value fails", () => {
    expect(cases.filter((entry) => entry.privateLan).length).toBeGreaterThan(0);
    expect(cases.filter((entry) => !entry.privateLan).length).toBeGreaterThan(0);
    expect(cases.filter((entry) => entry.loopback).length).toBeGreaterThan(0);
  });

  for (const entry of cases) {
    it(`classifies ${entry.host} as ${entry.privateLan ? "" : "not "}private LAN (${entry.note})`, () => {
      expect(isPrivateLanAddress(entry.host)).toBe(entry.privateLan);
      expect(isLoopbackHost(entry.host)).toBe(entry.loopback);
    });
  }

  it("applies the same rule to a host value carrying a port", () => {
    for (const entry of cases) {
      const hostValue = entry.host.includes(":") ? `[${entry.host}]:8080` : `${entry.host}:8080`;
      expect(isTrustedInsecureHost(hostValue)).toBe(entry.privateLan);
    }
  });
});
