/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ notifications: "prompt" as string })),
  requestPermissions: vi.fn(async () => ({ notifications: "granted" as string })),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  heartbeat: vi.fn(async () => undefined),
  addLog: vi.fn(),
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => "android"),
  getLifecycleState: vi.fn(() => "active"),
  classifyError: vi.fn(() => ({ failureClass: "plugin-failure", category: "integration" })),
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  NOTIFICATIONS_PERMISSION_ALIAS: "notifications",
  BackgroundExecution: {
    start: mocks.start,
    stop: mocks.stop,
    heartbeat: mocks.heartbeat,
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
  },
}));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));
vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: mocks.isNativePlatform,
  getPlatform: mocks.getPlatform,
}));
vi.mock("@/lib/appLifecycle", () => ({ getLifecycleState: mocks.getLifecycleState }));
vi.mock("@/lib/tracing/failureTaxonomy", () => ({ classifyError: mocks.classifyError }));

import { ensureNotificationPermission, requestNotificationPermissionOnce } from "@/lib/native/notificationPermission";
import { resetBackgroundExecutionState, startBackgroundExecution } from "@/lib/native/backgroundExecutionManager";

const repoRoot = process.cwd();

describe("the notification permission the foreground service needs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackgroundExecutionState();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt" });
    mocks.requestPermissions.mockResolvedValue({ notifications: "granted" });
  });

  it("is declared in the manifest, or the notification is dropped from API 33", () => {
    const manifest = readFileSync(path.join(repoRoot, "android/app/src/main/AndroidManifest.xml"), "utf8");
    expect(manifest).toContain('android:name="android.permission.POST_NOTIFICATIONS"');
  });

  it("is offered by the plugin that owns the foreground service", () => {
    const plugin = readFileSync(
      path.join(repoRoot, "android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt"),
      "utf8",
    );
    expect(plugin).toContain("Manifest.permission.POST_NOTIFICATIONS");
    expect(plugin).toContain('NOTIFICATIONS_PERMISSION_ALIAS = "notifications"');
  });

  it("prompts when the state is still prompt", async () => {
    await expect(ensureNotificationPermission()).resolves.toBe("granted");
    expect(mocks.requestPermissions).toHaveBeenCalledWith({ permissions: ["notifications"] });
  });

  it("does not prompt again once the user has refused", async () => {
    mocks.checkPermissions.mockResolvedValue({ notifications: "denied" });
    await expect(ensureNotificationPermission()).resolves.toBe("denied");
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  /*
   * This is the state Android really reports after ONE refusal; "denied" only arrives after the
   * second. While this counted as askable, the same system dialog — with no explanation of its own —
   * appeared again at the start of the next tune, which is what a user on the Play page saw.
   */
  it("does not prompt again while Android is asking for a rationale", async () => {
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt-with-rationale" });
    await expect(ensureNotificationPermission()).resolves.toBe("prompt-with-rationale");
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("does not prompt off native Android", async () => {
    mocks.getPlatform.mockReturnValue("ios");
    await expect(ensureNotificationPermission()).resolves.toBe("granted");
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });

  it("is never checked or requested when the foreground service starts", async () => {
    await startBackgroundExecution({ source: "test" });

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("does not hold the foreground service start behind an unanswered prompt", async () => {
    mocks.requestPermissions.mockReturnValue(new Promise(() => undefined));
    void requestNotificationPermissionOnce();

    await startBackgroundExecution({ source: "test" });

    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});

describe("the planned notification permission request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt" });
    mocks.requestPermissions.mockResolvedValue({ notifications: "granted" });
  });

  const loadFreshModule = () => import("@/lib/native/notificationPermission");

  it("asks the system once per session however often it is called", async () => {
    const { requestNotificationPermissionOnce: requestOnce } = await loadFreshModule();

    await expect(requestOnce()).resolves.toBe("granted");
    await expect(requestOnce()).resolves.toBe("granted");

    expect(mocks.checkPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("does not ask in a later session once the user has refused", async () => {
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt-with-rationale" });
    const { requestNotificationPermissionOnce: requestOnce } = await loadFreshModule();

    await expect(requestOnce()).resolves.toBe("prompt-with-rationale");

    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  const settled = {
    connectionState: "REAL_CONNECTED",
    interstitialActive: false,
    tourActive: false,
    tourOfferPending: false,
    playbackActive: false,
  } as const;

  it("is due once a device or Demo Mode is connected and nothing else is in progress", async () => {
    const { isNotificationPermissionMoment: isMoment } = await loadFreshModule();

    expect(isMoment(settled)).toBe(true);
    expect(isMoment({ ...settled, connectionState: "DEMO_ACTIVE" })).toBe(true);
  });

  it.each([
    ["no device has connected yet", { connectionState: "UNKNOWN" }],
    ["discovery is still running", { connectionState: "DISCOVERING" }],
    ["the app is offline", { connectionState: "OFFLINE_NO_DEMO" }],
    ["a dialog or sheet is open", { interstitialActive: true }],
    ["the tour is running", { tourActive: true }],
    ["the first-launch tour is about to be offered", { tourOfferPending: true }],
    ["a tune is playing", { playbackActive: true }],
  ] as const)("is not due while %s", async (_label, override) => {
    const { isNotificationPermissionMoment: isMoment } = await loadFreshModule();

    expect(isMoment({ ...settled, ...override })).toBe(false);
  });
});
