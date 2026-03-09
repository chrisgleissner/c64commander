/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";

const dumpUiHierarchyMock = vi.fn();

vi.mock("../src/validation/helpers.js", () => ({
  dumpUiHierarchy: dumpUiHierarchyMock,
}));

describe("app-first primitives", () => {
  it("unlocks the device only when keyguard is showing", async () => {
    const { ensureDeviceUnlocked } = await import("../src/validation/appFirstPrimitives.js");

    const lockedClient = {
      shell: vi.fn().mockResolvedValue("isKeyguardShowing=true"),
      pressKey: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await ensureDeviceUnlocked(lockedClient as never, "serial-1");
    expect(lockedClient.pressKey).toHaveBeenCalledWith("serial-1", 82);
    expect(lockedClient.swipe).toHaveBeenCalled();

    const unlockedClient = {
      shell: vi.fn().mockResolvedValue("isKeyguardShowing=false"),
      pressKey: vi.fn(),
      swipe: vi.fn(),
    };
    await ensureDeviceUnlocked(unlockedClient as never, "serial-1");
    expect(unlockedClient.pressKey).not.toHaveBeenCalled();
    expect(unlockedClient.swipe).not.toHaveBeenCalled();
  }, 4000);

  it("launches, restarts, taps by text, and validates route markers", async () => {
    const { launchAppForeground, navigateToRoute, restartApp, tapByText, waitForRouteMarkers } =
      await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      shell: vi.fn().mockResolvedValue("isKeyguardShowing=false"),
      startApp: vi.fn().mockResolvedValue(undefined),
      stopApp: vi.fn().mockResolvedValue(undefined),
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Other" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValue(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Home" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[40,1731][185,1887]" />
        </hierarchy>
      `);

    await launchAppForeground(client as never, "serial-1");
    await restartApp(client as never, "serial-1");
    expect(client.startApp).toHaveBeenCalledTimes(2);
    expect(client.stopApp).toHaveBeenCalledTimes(1);

    expect(await tapByText(client as never, "serial-1", "Save RAM")).toBe(true);
    expect(await tapByText(client as never, "serial-1", "Missing")).toBe(false);

    await navigateToRoute(client as never, "serial-1", "/play");
    expect(client.tap).toHaveBeenCalled();

    await waitForRouteMarkers("serial-1", "/", 1);
  }, 12000);

  it("fails for unsupported routes and missing markers", async () => {
    const { navigateToRoute, waitForRouteMarkers } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();
    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    await expect(navigateToRoute(client as never, "serial-1", "/missing")).rejects.toThrow(/Unsupported route/);

    dumpUiHierarchyMock.mockResolvedValue(
      `<hierarchy><node text="Other" enabled="true" bounds="[1,1][10,10]" /></hierarchy>`,
    );
    await expect(waitForRouteMarkers("serial-1", "/play", 1)).rejects.toThrow(/Route '\/play' marker check failed/);
  }, 4000);
});
