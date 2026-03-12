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
      shell: vi
        .fn()
        .mockResolvedValueOnce("isKeyguardShowing=true")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("isKeyguardShowing=false"),
      pressKey: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await ensureDeviceUnlocked(lockedClient as never, "serial-1");
    expect(lockedClient.pressKey).toHaveBeenCalledWith("serial-1", 224);
    expect(lockedClient.pressKey).toHaveBeenCalledWith("serial-1", 82);
    expect(lockedClient.shell).toHaveBeenCalledWith("serial-1", "wm dismiss-keyguard");
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

  it("fails when the keyguard never dismisses", async () => {
    const { ensureDeviceUnlocked } = await import("../src/validation/appFirstPrimitives.js");

    const lockedClient = {
      shell: vi.fn().mockResolvedValue("isKeyguardShowing=true"),
      pressKey: vi.fn().mockResolvedValue(undefined),
      swipe: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureDeviceUnlocked(lockedClient as never, "serial-1")).rejects.toThrow(
      /Device remained locked after app-first unlock attempts/,
    );
    expect(lockedClient.pressKey).toHaveBeenCalledTimes(6);
    expect(lockedClient.swipe).toHaveBeenCalledTimes(3);
  }, 6000);

  it("launches, restarts, taps by text, and validates route markers", async () => {
    const {
      launchAppForeground,
      navigateToRoute,
      restartApp,
      tapByResourceId,
      tapByText,
      tapByTextContaining,
      waitForRouteMarkers,
    } = await import("../src/validation/appFirstPrimitives.js");
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

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="" resource-id="playlist-play" content-desc="Play" class="android.widget.Button" clickable="true" enabled="true" bounds="[319,495][442,618]" />
        </hierarchy>
      `);
    expect(await tapByText(client as never, "serial-1", "Play")).toBe(true);

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="" resource-id="import-option-c64u" content-desc="Add file / folder from C64U" class="android.widget.Button" clickable="true" enabled="true" bounds="[540,300][900,450]" />
        </hierarchy>
      `);
    expect(await tapByTextContaining(client as never, "serial-1", "C64U")).toBe(true);

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="" resource-id="add-items-to-playlist" content-desc="Add items to playlist" class="android.widget.Button" clickable="true" enabled="true" bounds="[734,1845][990,1969]" />
        </hierarchy>
      `);
    expect(await tapByResourceId(client as never, "serial-1", "add-items-to-playlist")).toBe(true);

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
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
          <node text="Home" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[40,1731][185,1887]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/play");
    expect(client.tap).toHaveBeenCalled();

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Home" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[40,1731][185,1887]" />
        </hierarchy>
      `);
    await waitForRouteMarkers("serial-1", "/", 1);
  }, 12000);

  it("navigates using bottom-tab resource ids when labels are icon-only", async () => {
    const { navigateToRoute } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="" resource-id="tab-home" content-desc="Home" class="android.widget.Button" clickable="true" enabled="true" bounds="[33,2004][181,2150]" />
          <node text="" resource-id="tab-play" content-desc="Play" class="android.widget.Button" clickable="true" enabled="true" bounds="[203,2004][341,2150]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/play");
    expect(client.tap).toHaveBeenCalledWith("serial-1", 272, 2077);
  }, 4000);

  it("navigates using a bottom-tab resource id when the first hierarchy already exposes it", async () => {
    const { navigateToRoute } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy></hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="" resource-id="tab-play" content-desc="" class="android.widget.Button" clickable="true" enabled="true" bounds="[203,2004][341,2150]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/play");
    expect(client.tap).toHaveBeenCalledWith("serial-1", 272, 2077);
  }, 4000);

  it("dismisses the connection-status overlay before route navigation", async () => {
    const { navigateToRoute } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Connection Status" class="android.widget.TextView" clickable="false" enabled="true" bounds="[167,814][913,869]" />
          <node text="Close" class="android.widget.Button" clickable="true" enabled="true" bounds="[888,792][935,841]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/play");

    expect(client.tap).toHaveBeenNthCalledWith(1, "serial-1", 911, 816);
    expect(client.tap).toHaveBeenNthCalledWith(2, "serial-1", 271, 1809);
  }, 4000);

  it("returns false for tappable nodes without usable bounds and tolerates non-tappable overlays", async () => {
    const { navigateToRoute, tapByResourceId, tapByText, tapByTextContaining, waitForRouteMarkers } =
      await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Broken" class="android.widget.Button" clickable="true" enabled="true" bounds="[bad]" />
        </hierarchy>
      `);
    await expect(tapByText(client as never, "serial-1", "Broken")).resolves.toBe(false);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Broken suffix" class="android.widget.Button" clickable="true" enabled="true" bounds="[bad]" />
        </hierarchy>
      `);
    await expect(tapByTextContaining(client as never, "serial-1", "suffix")).resolves.toBe(false);

    dumpUiHierarchyMock.mockResolvedValueOnce(`<hierarchy></hierarchy>`);
    await expect(tapByTextContaining(client as never, "serial-1", "missing")).resolves.toBe(false);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node resource-id="playlist-play" class="android.widget.Button" clickable="true" enabled="true" bounds="[bad]" />
        </hierarchy>
      `);
    await expect(tapByResourceId(client as never, "serial-1", "playlist-play")).resolves.toBe(false);

    dumpUiHierarchyMock.mockResolvedValueOnce(`<hierarchy></hierarchy>`);
    await expect(tapByResourceId(client as never, "serial-1", "playlist-play")).resolves.toBe(false);

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Connection Status" class="android.widget.TextView" clickable="false" enabled="true" bounds="[167,814][913,869]" />
          <node text="Close" class="android.widget.Button" clickable="true" enabled="true" bounds="[bad]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/");
    expect(client.tap).toHaveBeenLastCalledWith("serial-1", 107, 2077);

    dumpUiHierarchyMock.mockReset();
    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `);
    await expect(waitForRouteMarkers("serial-1", "/", 1)).resolves.toBeUndefined();
  }, 6000);

  it("fails when route marker expectations are missing for a route", async () => {
    const { waitForRouteMarkers } = await import("../src/validation/appFirstPrimitives.js");

    await expect(waitForRouteMarkers("serial-1", "/missing", 1)).rejects.toThrow(
      /No route markers configured for route '\/missing'/,
    );
  });

  it("fails route marker checks when the active bottom tab points at a different route", async () => {
    const { waitForRouteMarkers } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    dumpUiHierarchyMock.mockResolvedValue(`
        <hierarchy>
          <node text="HOME" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Save RAM" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,100][200,200]" />
          <node text="QUICK CONFIG" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
        </hierarchy>
      `);

    await expect(waitForRouteMarkers("serial-1", "/", 1)).rejects.toThrow(/activeTab=Play/);
  });

  it("ignores overlays that do not expose a close button and continues navigation", async () => {
    const { navigateToRoute } = await import("../src/validation/appFirstPrimitives.js");
    dumpUiHierarchyMock.mockReset();

    const client = {
      tap: vi.fn().mockResolvedValue(undefined),
    };

    dumpUiHierarchyMock.mockResolvedValueOnce(`
        <hierarchy>
          <node text="Connection Status" class="android.widget.TextView" clickable="false" enabled="true" bounds="[167,814][913,869]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `).mockResolvedValueOnce(`
        <hierarchy>
          <node text="Play" class="android.widget.Button" clickable="true" enabled="true" focused="true" bounds="[198,1731][345,1887]" />
          <node text="PLAY FILES" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,154][300,243]" />
          <node text="Playlist" class="android.widget.TextView" clickable="false" enabled="true" bounds="[42,300][300,360]" />
        </hierarchy>
      `);

    await navigateToRoute(client as never, "serial-1", "/play");

    expect(client.tap).toHaveBeenCalledTimes(1);
    expect(client.tap).toHaveBeenCalledWith("serial-1", 271, 1809);
  }, 4000);

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
