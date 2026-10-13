/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { hostWindowScript, parseHostWindow, runtimeStem } from "../src/transport/sshWindow.js";
import { TEST_HOST_WINDOW } from "./support/sshFakes.js";

describe("runtimeStem", () => {
  it("takes the runtime name from a dedicated attach helper and ignores lxc-attach", () => {
    expect(runtimeStem(["/usr/bin/lxc-attach", "/usr/sbin/runtime-attach"])).toBe("runtime");
    expect(runtimeStem(["/usr/bin/lxc-attach"])).toBeNull();
    expect(runtimeStem([])).toBeNull();
  });
});

describe("hostWindowScript", () => {
  const window = { ...TEST_HOST_WINDOW, raise: { ...TEST_HOST_WINDOW.raise } };

  it("calls the configured compositor and raises only when asked, and only the runtime's bridge", () => {
    const check = hostWindowScript("defaultuser", "runtime", window, false);
    expect(check).toContain("--dest=test.Compositor ");
    expect(check).toContain("send / test.Compositor.TopmostWindowPid");
    expect(check).toContain("^/usr/libexec/runtime/[^/]+-bridge$");
    expect(check).toContain("id -u 'defaultuser'");
    expect(check).not.toContain("test.Compositor.RaiseWindowsOf");
    expect(hostWindowScript("defaultuser", "runtime", window, true)).toContain(
      'send /windows test.Compositor.RaiseWindowsOf string:"$bridge"',
    );
  });

  it("never raises when no raise method is configured", () => {
    expect(hostWindowScript("u", "runtime", { ...window, raise: null }, true)).not.toContain("raised=");
  });

  it("finds the bridge in /proc rather than with ps, whose listing can leave out other users", () => {
    const script = hostWindowScript("u", "runtime", window, false);
    expect(script).toContain("/proc/[0-9]*/cmdline");
    expect(script).not.toMatch(/\bps\b/);
  });
});

describe("parseHostWindow", () => {
  it("compares the topmost window's executable with the bridge, preferring the state after a raise", () => {
    expect(parseHostWindow("bridge=/b\nbefore=0|\nraised=1\nafter=9|/b\n")).toEqual({
      checked: true,
      reason: null,
      known: true,
      containerInFront: true,
      raised: true,
      topmost: "9|/b",
    });
    expect(parseHostWindow("bridge=/b\nbefore=12|/usr/bin/other\n")).toMatchObject({
      known: true,
      containerInFront: false,
      raised: false,
    });
  });

  it("says why the window is unknown without a bridge or without a compositor answer", () => {
    expect(parseHostWindow("before=12|/usr/bin/other\n")).toMatchObject({
      checked: true,
      known: false,
      containerInFront: null,
      reason: expect.stringMatching(/no running window bridge/),
    });
    expect(parseHostWindow("bridge=/b\ncompositor=absent\n")).toMatchObject({
      known: false,
      topmost: null,
      reason: expect.stringMatching(/did not answer/),
    });
  });
});
