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

import { ensureNotificationPermission } from "@/lib/native/notificationPermission";
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

  it("does not prompt off native Android", async () => {
    mocks.getPlatform.mockReturnValue("ios");
    await expect(ensureNotificationPermission()).resolves.toBe("granted");
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });

  it("is asked for before the foreground service starts", async () => {
    const order: string[] = [];
    mocks.checkPermissions.mockImplementation(async () => {
      order.push("check");
      return { notifications: "prompt" };
    });
    mocks.requestPermissions.mockImplementation(async () => {
      order.push("request");
      return { notifications: "granted" };
    });
    mocks.start.mockImplementation(async () => {
      order.push("start");
    });

    await startBackgroundExecution({ source: "test" });

    expect(order).toEqual(["check", "request", "start"]);
  });

  it("still starts the foreground service when the user refuses", async () => {
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt" });
    mocks.requestPermissions.mockResolvedValue({ notifications: "denied" });

    await startBackgroundExecution({ source: "test" });

    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
