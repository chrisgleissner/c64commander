/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";
import { parseDiscoverArgs } from "../src/ctaDiscover.js";

describe("CTA discover CLI", () => {
  afterEach(() => {
    delete process.env.ANDROID_SERIAL;
  });

  it("parses inline and separated flags", () => {
    const args = parseDiscoverArgs([
      "--serial",
      "9B0",
      "--route=/docs",
      "--overlay",
      "licenses",
      "--scroll-container=main",
      "--max-scrolls",
      "3",
      "--start-app",
    ]);

    expect(args).toEqual({
      serial: "9B0",
      route: "/docs",
      overlay: "licenses",
      scrollContainerId: "main",
      maxScrolls: 3,
      startApp: true,
    });
  });

  it("uses ANDROID_SERIAL when no serial flag is present", () => {
    process.env.ANDROID_SERIAL = "env-serial";

    expect(parseDiscoverArgs([]).serial).toBe("env-serial");
  });

  it("rejects invalid max scroll values", () => {
    expect(() => parseDiscoverArgs(["--max-scrolls=-1"])).toThrow(/Invalid --max-scrolls/);
    expect(() => parseDiscoverArgs(["--max-scrolls=nan"])).toThrow(/Invalid --max-scrolls/);
  });
});
