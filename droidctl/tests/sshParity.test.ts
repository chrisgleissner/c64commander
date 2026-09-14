/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The same tool calls, answered by the same scripted device, through an ordinary
 * adb target and through each ssh route. A caller must not be able to tell the
 * routes apart by a tool's result, only by the refusals the attach route makes.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/png.js";
import { ALL_TOOL_NAMES } from "../src/tools/toolNames.js";
import { AdbTransport } from "../src/transport/adb.js";
import { FakeTransport } from "../src/transport/fake.js";
import { CONTAINER_ADB_ONLY } from "../src/transport/ssh.js";
import { createTestContext, invoke } from "./support/harness.js";
import { FakePhone, type PhoneScenario, usbPhone } from "./support/sshFakes.js";

const PACKAGE = "uk.gleissner.c64commander";
const SSH_TARGET = "ssh:defaultuser@192.168.2.15";
const PNG = encodePng({ width: 4, height: 8, pixels: Buffer.alloc(4 * 8 * 4, 90) });
const GETPROP = [
  "[ro.build.version.release]: [13]",
  "[ro.build.version.sdk]: [33]",
  "[ro.hardware]: [container]",
  "[ro.product.model]: [Container Model]",
  "[ro.product.name]: [container]",
].join("\n");

/** One device, answering Android shell commands the same way whichever route delivered them. */
const device: PhoneScenario["shell"] = (argv) => {
  const line = argv.join(" ");
  const answers: [RegExp, { stdout?: string | Buffer; exitCode?: number }][] = [
    [/^getprop$/, { stdout: GETPROP }],
    [/^wm size$/, { stdout: "Physical size: 480x640\n" }],
    [/^wm density$/, { stdout: "Physical density: 240\n" }],
    [/^am start/, { stdout: "Status: ok\nTotalTime: 812\n" }],
    [
      /^dumpsys activity activities$/,
      { stdout: `  mResumedActivity: ActivityRecord{1 u0 ${PACKAGE}/.MainActivity t9}\n` },
    ],
    [/^pm list packages/, { stdout: `package:${PACKAGE}\n` }],
    [/^pm (clear|install|uninstall)/, { stdout: "Success\n" }],
    [/^logcat -d/, { stdout: "I/Tag: started\nE/AndroidRuntime: FATAL EXCEPTION: main\n" }],
    [/^pidof /, { stdout: "4242\n" }],
    [/^screencap -p$/, { stdout: PNG }],
    [/^run-as .* cat 'files\//, { stdout: '{"host":"c64u"}' }],
    [/^echo /, { stdout: `${argv.slice(1).join(" ")}\n` }],
  ];
  return answers.find(([pattern]) => pattern.test(line))?.[1] ?? { stdout: "" };
};

interface Route {
  readonly phone: FakePhone;
  readonly targetId: string;
  readonly ctx: Awaited<ReturnType<typeof createTestContext>>["ctx"];
}

/** The harness always registers a fake; it gets the other kind, because the registry uses the first of a kind. */
function placeholder(kind: "adb" | "ssh"): FakeTransport {
  const fake = new FakeTransport([]);
  fake.kind = kind;
  return fake;
}

async function adbRoute(): Promise<Route> {
  const phone = new FakePhone({ shell: device });
  phone.connected.set("PHYSICAL01", "device");
  const { ctx } = await createTestContext({
    transport: placeholder("ssh"),
    extraTransports: [new AdbTransport({ exec: phone.adbExec })],
  });
  return { phone, targetId: "adb:PHYSICAL01", ctx };
}

async function sshRoute(scenario: Partial<PhoneScenario>): Promise<Route> {
  const phone = usbPhone({ ...scenario, shell: device });
  const { ctx } = await createTestContext({ transport: placeholder("adb"), extraTransports: [phone.transport()] });
  return { phone, targetId: SSH_TARGET, ctx };
}

const containerAdb = () => sshRoute({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "device" } });
const containerAttach = () =>
  sshRoute({
    sudo: true,
    helpers: ["/usr/bin/container-attach"],
    attachResults: { "helper:/usr/bin/container-attach": { exitCode: 0, firstLine: "33" } },
  });

async function workload(): Promise<{ apk: string; runRoot: string }> {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-parity-"));
  const apk = path.join(runRoot, "app.apk");
  await writeFile(apk, Buffer.from("PK apk bytes"));
  return { apk, runRoot };
}

function toolCalls(
  targetId: string,
  apk: string,
  runRoot: string,
  withWebviewForward: boolean,
): [string, Record<string, unknown>][] {
  return [
    ["droid_target.describe_target", { targetId }],
    ["droid_app.install_app", { targetId, package: PACKAGE, apkPath: apk, grantPermissions: true }],
    ["droid_app.start_app", { targetId, package: PACKAGE, waitForResume: true }],
    ["droid_app.stop_app", { targetId, package: PACKAGE }],
    ["droid_app.uninstall_app", { targetId, package: PACKAGE }],
    ["droid_app.clear_app_data", { targetId, package: PACKAGE, confirm: true }],
    ["droid_app.write_app_file", { targetId, package: PACKAGE, relativePath: "c64u-config.json", content: "{}" }],
    ["droid_app.read_app_file", { targetId, package: PACKAGE, relativePath: "c64u-config.json" }],
    ["droid_input.tap", { targetId, x: 10, y: 20 }],
    ["droid_input.swipe", { targetId, x1: 1, y1: 2, x2: 30, y2: 40, durationMs: 300 }],
    ["droid_input.input_text", { targetId, text: "hello world" }],
    ["droid_input.press_key", { targetId, keycode: "KEYCODE_DPAD_DOWN", repeat: 2 }],
    ...(withWebviewForward
      ? ([["droid_device.forward_webview", { targetId, package: PACKAGE, localPort: 9222 }]] as [
          string,
          Record<string, unknown>,
        ][])
      : []),
    ["droid_capture.screenshot", { targetId, name: "home", runRoot }],
    ["droid_capture.logcat", { targetId, mode: "dump", filters: ["FATAL"], runRoot }],
    ["droid_device.run_shell", { targetId, command: ["echo", "two words"] }],
  ];
}

/** Target identity and artifact locations differ by construction; everything else must match. */
function comparable(data: Record<string, unknown>): Record<string, unknown> {
  const { targetId: _t, transport: _k, serial: _s, connection: _c, ...rest } = data;
  return JSON.parse(
    JSON.stringify(rest, (key, value) =>
      typeof value === "string" && key.endsWith("Path") ? path.basename(value) : value,
    ),
  );
}

async function runWorkload(route: Route, withWebviewForward: boolean) {
  const { apk, runRoot } = await workload();
  const results: Record<string, unknown> = {};
  for (const [name, args] of toolCalls(route.targetId, apk, runRoot, withWebviewForward)) {
    const envelope = await invoke(name, args, route.ctx);
    expect(envelope.ok, `${route.targetId} ${name}: ${JSON.stringify(envelope.error)}`).toBe(true);
    results[name] = comparable(envelope.data);
  }
  return results;
}

/** What reached the device, as Android argv, leaving out the api-level read a listing makes. */
function deviceCommands(phone: FakePhone): string[] {
  return phone.deviceShellCalls.map((call) => call.argv.join(" "));
}

function adbCommandsAfterSerial(phone: FakePhone): string[] {
  return phone.adbCalls
    .filter((args) => args[0] === "-s" && args.slice(2).join(" ") !== "shell getprop ro.build.version.sdk")
    .map((args) =>
      args
        .slice(2)
        .join(" ")
        .replace(/[^ ]*droidctl-parity-[^/]+\//, "<run>/"),
    );
}

describe("parity: container adb route against an ordinary adb target", () => {
  it("returns the same data for every tool and sends adb the same commands after the serial", async () => {
    const baseline = await adbRoute();
    const tunnelled = await containerAdb();

    const expected = await runWorkload(baseline, true);
    const actual = await runWorkload(tunnelled, true);

    expect(actual).toEqual(expected);
    expect(adbCommandsAfterSerial(tunnelled.phone)).toEqual(adbCommandsAfterSerial(baseline.phone));
    expect(
      tunnelled.phone.adbCalls.filter((args) => args[0] === "-s").every((args) => args[1] === "127.0.0.1:40000"),
    ).toBe(true);
    // The equality above is only worth something if the device actually answered.
    expect(expected["droid_target.describe_target"]).toMatchObject({
      model: "Container Model",
      apiLevel: 33,
      screen: { width: 480, height: 640, density: 240, dpr: 1.5 },
    });
    expect(expected["droid_app.start_app"]).toMatchObject({
      resumedActivity: `${PACKAGE}/.MainActivity`,
      totalTimeMs: 812,
    });
    expect(expected["droid_input.tap"]).toEqual({ tapped: true, x: 10, y: 20, holdMs: null });
    expect(expected["droid_device.forward_webview"]).toMatchObject({
      socket: "webview_devtools_remote_4242",
      pid: "4242",
    });
    expect(expected["droid_capture.screenshot"]).toMatchObject({ rawPath: "home.png", raw: { width: 4, height: 8 } });
    expect(expected["droid_capture.logcat"]).toMatchObject({ matchedCount: 1 });
    expect(adbCommandsAfterSerial(baseline.phone)).toContain(
      "forward tcp:9222 localabstract:webview_devtools_remote_4242",
    );
  });

  it("adds the connection block to describe_target and nothing to an adb target", async () => {
    const baseline = await adbRoute();
    const tunnelled = await containerAdb();
    const plain = await invoke("droid_target.describe_target", { targetId: baseline.targetId }, baseline.ctx);
    const described = await invoke("droid_target.describe_target", { targetId: SSH_TARGET }, tunnelled.ctx);

    expect(plain.data).not.toHaveProperty("connection");
    expect(described.data).toMatchObject({
      transport: "ssh",
      serial: "defaultuser@192.168.2.15",
      connection: { route: "container-adb", adbSerial: "127.0.0.1:40000", containerAdbEndpoint: "127.0.0.1:5555" },
    });
  });
});

describe("parity: container attach route against an ordinary adb target", () => {
  it("returns the same data for every tool it supports and runs the same Android commands", async () => {
    const baseline = await adbRoute();
    const attached = await containerAttach();

    const expected = await runWorkload(baseline, false);
    const actual = await runWorkload(attached, false);

    expect(actual).toEqual(expected);
    expect(expected["droid_app.read_app_file"]).toMatchObject({ content: '{"host":"c64u"}' });
    expect(actual["droid_input.press_key"]).toEqual({ pressed: true, keycode: 20, repeat: 2, longPress: false });
    expect(attached.phone.deviceShellCalls.map((call) => call.argv.join(" "))).toContain("input tap 10 20");
    expect(expected["droid_device.run_shell"]).toEqual({
      stdout: "two words\n",
      stderr: "",
      exitCode: 0,
      truncated: false,
    });
    // adb installs with its own install command; the attach route streams the APK to pm install instead.
    expect(deviceCommands(attached.phone).filter((line) => !line.startsWith("pm install"))).toEqual(
      deviceCommands(baseline.phone),
    );
    expect(deviceCommands(attached.phone)).toContain("pm install -r -g -S 12");
    expect(attached.phone.deviceShellCalls.every((call) => call.via === "attach")).toBe(true);
  });

  it("refuses each tool it cannot verify with unsupported_on_transport naming the container adb prerequisite", async () => {
    const attached = await containerAttach();
    const targetId = SSH_TARGET;
    const refusals: Record<string, Record<string, unknown>> = {
      "droid_capture.ui_hierarchy": { targetId },
      "droid_assert.assert_visible": { targetId, name: "a", match: { text: "x" } },
      "droid_assert.assert_not_visible": { targetId, name: "a", match: { text: "x" } },
      "droid_capture.start_recording": { targetId, name: "clip" },
      "droid_capture.stop_recording": { targetId, recordingId: "rec-1" },
      "droid_device.forward_webview": { targetId, package: PACKAGE, localPort: 9222 },
    };
    expect(Object.keys(refusals).sort()).toEqual(Object.keys(CONTAINER_ADB_ONLY).sort());

    for (const [name, args] of Object.entries(refusals)) {
      const envelope = await invoke(name, args, attached.ctx);
      expect(envelope.ok, name).toBe(false);
      expect(envelope.error.code, name).toBe("unsupported_on_transport");
      expect(envelope.error.message, name).toContain(CONTAINER_ADB_ONLY[name]);
      expect(envelope.error.message, name).toContain("[container-adb-disabled]");
    }
    expect(attached.phone.deviceShellCalls).toEqual([]);
  });
});

describe("parity: a target with no route", () => {
  it("refuses every targeted tool with transport_unavailable and the missing prerequisites, touching nothing", async () => {
    const blocked = await sshRoute({ login: { exitCode: 255, stderr: "Permission denied (publickey).\n" } });
    const { apk, runRoot } = await workload();
    const targetId = SSH_TARGET;
    const calls: Record<string, Record<string, unknown>> = Object.fromEntries(toolCalls(targetId, apk, runRoot, true));
    Object.assign(calls, {
      "droid_capture.ui_hierarchy": { targetId },
      "droid_assert.assert_visible": { targetId, name: "a", match: { text: "x" } },
      "droid_assert.assert_not_visible": { targetId, name: "a", match: { text: "x" } },
      "droid_capture.start_recording": { targetId, name: "clip" },
      "droid_capture.stop_recording": { targetId, recordingId: "rec-1" },
      "droid_device.prepare_device": { targetId },
      "droid_device.push_file": { targetId, localPath: apk, remotePath: "/sdcard/app.apk" },
      "droid_device.pull_file": { targetId, remotePath: "/sdcard/app.apk", localPath: path.join(runRoot, "out") },
    });
    expect(Object.keys(calls).sort()).toEqual(
      ALL_TOOL_NAMES.filter((name) => name !== "droid_target.list_targets").sort(),
    );

    for (const [name, args] of Object.entries(calls)) {
      const envelope = await invoke(name, args, blocked.ctx);
      expect(envelope.error?.code, name).toBe("transport_unavailable");
      expect(envelope.error.message, name).toContain(`${name} cannot run on ${SSH_TARGET}`);
      expect(envelope.error.message, name).toContain("ssh-copy-id defaultuser@192.168.2.15");
      expect(
        envelope.error.details.prerequisites.map((entry: { id: string }) => entry.id),
        name,
      ).toEqual(["ssh-key"]);
    }
    expect(blocked.phone.deviceShellCalls).toEqual([]);
    expect(blocked.phone.adbCalls).toEqual([]);
  });
});
