/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWebviewSockets } from "../src/tools/modules/device.js";
import { FakeTransport } from "../src/transport/fake.js";
import { createTestContext, invoke, withDeviceDefaults } from "./support/harness.js";

const TARGET = "adb:TESTSERIAL01";
const PACKAGE = "uk.gleissner.c64commander";
const OTHER_PACKAGE = "uk.gleissner.c64uremote";

function readyDevice(options: { sizeOverride?: string; densityOverride?: number } = {}): FakeTransport {
  const transport = withDeviceDefaults(new FakeTransport(), options);
  transport.respondTo("getprop sys.boot_completed", { stdout: "1\n" });
  transport.respondTo("settings get global", { stdout: "0.0\n" });
  transport.respondTo("dumpsys window policy", { stdout: "  mShowing=false\n" });
  transport.respondTo("dumpsys window", {
    stdout: "  mCurrentFocus=Window{a u0 uk.gleissner.c64commander/.MainActivity}",
  });
  transport.respondTo("dumpsys activity activities", { stdout: `mResumedActivity: ${PACKAGE}/.MainActivity` });
  return transport;
}

describe("droid_device.prepare_device", () => {
  it("waits for boot, dismisses the keyguard and reports the readiness cluster in one call", async () => {
    const transport = readyDevice();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.prepare_device",
      { targetId: TARGET, stayOn: "usb", disableAnimations: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      bootCompleted: true,
      keyguardShowing: false,
      stayOn: "usb",
      sizeOverride: null,
      resumedActivity: `${PACKAGE}/.MainActivity`,
      focusedWindow: `${PACKAGE}/.MainActivity`,
    });
    expect(result.data.animationScales).toEqual({
      window_animation_scale: "0.0",
      transition_animation_scale: "0.0",
      animator_duration_scale: "0.0",
    });

    const lines = transport.execArgvLines();
    expect(lines).toContain("wm dismiss-keyguard");
    expect(lines).toContain("svc power stayon usb");
    expect(lines).toContain("settings put global window_animation_scale 0");
  });

  it("refuses to report a device ready under a leftover display override", async () => {
    const transport = readyDevice({ sizeOverride: "480x640", densityOverride: 240 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.prepare_device", { targetId: TARGET, requireNativeGeometry: true }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/running under a display override \(size=480x640, density=240\)/);
    expect(result.error.message).toMatch(/wm size reset/);
  });

  it("times out when the device never reports sys.boot_completed", async () => {
    const transport = readyDevice();
    transport.respondTo("getprop sys.boot_completed", { stdout: "0\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.prepare_device", { targetId: TARGET, timeoutMs: 30 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("timeout");
  });

  it("skips the wait but still reports boot state when waitForBoot is false", async () => {
    const transport = readyDevice();
    transport.respondTo("getprop sys.boot_completed", { stdout: "0\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.prepare_device",
      { targetId: TARGET, waitForBoot: false, dismissKeyguard: false },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.data.bootCompleted).toBe(false);
    expect(transport.execArgvLines()).not.toContain("wm dismiss-keyguard");
  });
});

describe("droid_device.run_shell", () => {
  it("passes an argument vector through and returns the streams", async () => {
    const transport = new FakeTransport();
    transport.respondTo("settings put system", { stdout: "", stderr: "", exitCode: 0 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.run_shell",
      { targetId: TARGET, command: ["settings", "put", "system", "user_rotation", "1"] },
      ctx,
    );

    expect(result.data).toMatchObject({ exitCode: 0, truncated: false });
    expect(transport.execArgvLines()).toEqual(["settings put system user_rotation 1"]);
  });

  it("returns a non-zero exit code as data rather than as an error", async () => {
    const transport = new FakeTransport();
    transport.respondTo("false", { exitCode: 1, stderr: "boom" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.run_shell", { targetId: TARGET, command: ["false"] }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ exitCode: 1, stderr: "boom" });
  });

  it("rejects an empty command", async () => {
    const { ctx } = await createTestContext();
    const result = await invoke("droid_device.run_shell", { targetId: TARGET, command: [] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_input");
  });
});

describe("droid_device.forward_webview", () => {
  it("forwards to the named application's socket, replacing an existing forward", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "4242\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.forward_webview",
      { targetId: TARGET, package: PACKAGE, localPort: 9222 },
      ctx,
    );

    expect(result.data).toMatchObject({ localPort: 9222, socket: "webview_devtools_remote_4242", pid: "4242" });
    expect(transport.calls.map((call) => call.kind)).toContain("removeForward");
    expect(transport.forwards).toEqual([{ localPort: 9222, remote: "localabstract:webview_devtools_remote_4242" }]);
  });

  it("falls back to /proc/net/unix when pidof returns more than one pid", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "4242 4243\n" });
    transport.respondTo("cat /proc/net/unix", {
      stdout: [
        "0000: 00000002 0 00010000 1 0 12345 @webview_devtools_remote_4242",
        "0000: 00000002 0 00010000 1 0 12346 @webview_devtools_remote_9999",
      ].join("\n"),
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.forward_webview",
      { targetId: TARGET, package: PACKAGE, localPort: 9222, replaceExisting: false },
      ctx,
    );

    expect(result.data.socket).toBe("webview_devtools_remote_4242");
    expect(transport.calls.map((call) => call.kind)).not.toContain("removeForward");
  });

  it("refuses to guess when two editions each expose a socket", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "4242 4243\n" });
    transport.respondTo("cat /proc/net/unix", {
      stdout: [
        "0000: 1 0 1 0 0 1 @webview_devtools_remote_4242",
        "0000: 1 0 1 0 0 2 @webview_devtools_remote_4243",
      ].join("\n"),
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.forward_webview",
      { targetId: TARGET, package: PACKAGE, localPort: 9222 },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/refusing to guess/);
    expect(transport.forwards).toEqual([]);
  });

  it("reports a package that is not running", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.forward_webview",
      { targetId: TARGET, package: OTHER_PACKAGE, localPort: 9222 },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/is not running/);
  });

  it("keeps only the sockets belonging to the named application's pids", () => {
    const dump = [
      "0000: 1 0 1 0 0 1 @webview_devtools_remote_100",
      "0000: 1 0 1 0 0 2 @webview_devtools_remote_200",
      "0000: 1 0 1 0 0 3 @some_other_socket",
    ].join("\n");
    expect(parseWebviewSockets(dump, ["200"])).toEqual(["webview_devtools_remote_200"]);
    expect(parseWebviewSockets(dump, ["999"])).toEqual([]);
  });
});

describe("droid_device file transfer", () => {
  it("pushes an existing file and refuses a missing one", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-push-"));
    const localPath = path.join(dir, "fixture.sid");
    await writeFile(localPath, Buffer.alloc(128, 7));
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const pushed = await invoke(
      "droid_device.push_file",
      { targetId: TARGET, localPath, remotePath: "/sdcard/fixture.sid" },
      ctx,
    );
    expect(pushed.data).toEqual({ bytes: 128, remotePath: "/sdcard/fixture.sid" });
    expect(transport.pushed).toEqual([{ localPath, remotePath: "/sdcard/fixture.sid" }]);

    const missing = await invoke(
      "droid_device.push_file",
      { targetId: TARGET, localPath: path.join(dir, "absent"), remotePath: "/sdcard/absent" },
      ctx,
    );
    expect(missing.ok).toBe(false);
    expect(missing.error.message).toMatch(/Nothing to push/);
  });

  it("pulls a file to a local path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-pull-"));
    const localPath = path.join(dir, "result.json");
    const transport = new FakeTransport();
    transport.pullPayloads.set("/sdcard/result.json", Buffer.from('{"ok":true}'));
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.pull_file",
      { targetId: TARGET, remotePath: "/sdcard/result.json", localPath },
      ctx,
    );

    expect(result.data).toEqual({ bytes: 11, localPath });
    expect(await readFile(localPath, "utf8")).toBe('{"ok":true}');
  });

  it("reports a pull of something that is not there", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.pull_file",
      { targetId: TARGET, remotePath: "/sdcard/nope", localPath: "/tmp/nope" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
