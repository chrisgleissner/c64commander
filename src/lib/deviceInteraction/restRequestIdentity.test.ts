/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildRestRequestIdentity,
  canonicalizeRestPath,
  isConfigMutationPath,
  isMachineControlPath,
} from "@/lib/deviceInteraction/restRequestIdentity";

describe("restRequestIdentity", () => {
  it("normalizes equal query params with different order to the same identity", () => {
    const left = buildRestRequestIdentity({
      method: "GET",
      path: "/v1/configs?b=2&a=1",
      baseUrl: "http://c64u",
    });
    const right = buildRestRequestIdentity({
      method: "GET",
      path: "/v1/configs?a=1&b=2",
      baseUrl: "http://c64u",
    });

    expect(left).toBe(right);
    expect(canonicalizeRestPath("/v1/configs?b=2&a=1")).toBe("/v1/configs?a=1&b=2");
  });

  it("keeps different query params distinct", () => {
    const left = buildRestRequestIdentity({
      method: "GET",
      path: "/v1/configs?a=1&b=2",
      baseUrl: "http://c64u",
    });
    const right = buildRestRequestIdentity({
      method: "GET",
      path: "/v1/configs?a=1&b=3",
      baseUrl: "http://c64u",
    });

    expect(left).not.toBe(right);
  });

  it("classifies machine-control and config mutations without collapsing them together", () => {
    expect(isMachineControlPath("/v1/machine:pause")).toBe(true);
    expect(isMachineControlPath("/v1/runners:sidplay?file=test.sid")).toBe(true);
    expect(isConfigMutationPath("/v1/configs/Audio%20Mixer/Vol%20Socket%201?value=0%20dB")).toBe(true);
    expect(isMachineControlPath("/v1/configs")).toBe(false);
  });
});
