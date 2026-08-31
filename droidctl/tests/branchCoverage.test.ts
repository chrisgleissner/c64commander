/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The defensive branches: what each guard does when the thing it guards against
 * actually happens.
 */

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifacts.js";
import { buildTransportMatrix } from "../src/resources.js";
import { createDefaultTransports } from "../src/server.js";
import { defineExecute } from "../src/tools/common.js";
import { ToolExecutionError } from "../src/tools/errors.js";
import { indexModules } from "../src/tools/registry.js";
import { defineToolModule, parseZodArgs } from "../src/tools/types.js";
import { evaluateMatches, parseNodes } from "../src/tools/modules/assert.js";
import { nodeSpawnRunner } from "../src/transport/adb.js";
import { FakeTransport } from "../src/transport/fake.js";
import type { TransportCapabilities } from "../src/transport/types.js";
import { createTestContext, invoke, withDeviceDefaults } from "./support/harness.js";

const TARGET = "adb:TESTSERIAL01";
const PACKAGE = "uk.gleissner.c64commander";

describe("transport support matrix", () => {
  it("reports unknown for a tool one transport does not list, and omits an absent note", () => {
    const adb: TransportCapabilities = { transport: "adb", tools: { "a.only": "supported" }, notes: {} };
    const ssh: TransportCapabilities = {
      transport: "ssh",
      tools: { "b.only": "unsupported" },
      notes: { "b.only": "probe Q7" },
    };

    expect(buildTransportMatrix(adb, ssh)).toEqual({
      "a.only": { adb: "supported", ssh: "unknown" },
      "b.only": { adb: "unknown", ssh: "unsupported", note: "probe Q7" },
    });
  });
});

describe("default transport wiring", () => {
  it("journals an adb command into the run's command log", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "droidctl-defaults-"));
    const artifacts = new ArtifactStore({ root, runId: "dc-DEFAULTS" });
    const [adb, ssh] = createDefaultTransports(artifacts);

    expect(adb!.kind).toBe("adb");
    expect(ssh!.kind).toBe("ssh");
    expect(artifacts.commandsRecorded()).toBe(0);

    // The onCommand hook is what makes commands.jsonl non-empty; drive it directly
    // rather than running adb.
    (adb as unknown as { onCommand: (record: unknown) => void })["onCommand"]?.({
      timestamp: "now",
      targetId: TARGET,
      transport: "adb",
      argv: ["adb", "-s", "X", "shell", "getprop"],
      exitCode: 0,
      durationMs: 1,
      bytesOut: 0,
    });
    expect(artifacts.commandsRecorded()).toBe(1);
  });
});

describe("tool registry indexing", () => {
  it("throws on a duplicate tool name rather than silently shadowing one", () => {
    const make = (name: string) =>
      defineToolModule({
        domain: "dup",
        summary: "s",
        tools: [
          {
            name,
            description: "d",
            inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
            argsSchema: z.object({}).strict(),
            execute: async () => ({ content: [{ type: "text" as const, text: "{}" }] }),
          },
        ],
      });

    expect(() => indexModules([make("dup.one"), make("dup.two")])).not.toThrow();
    expect(() => indexModules([make("dup.same"), make("dup.same")])).toThrow(/Duplicate tool name/);
  });
});

describe("argument parsing", () => {
  it("treats a missing argument object as empty", () => {
    expect(parseZodArgs(z.object({ a: z.string().optional() }).strict(), undefined)).toEqual({});
  });
});

describe("defineExecute error handling", () => {
  it("converts a ToolError into the envelope and lets anything else propagate", async () => {
    const { ctx } = await createTestContext();
    const schema = z.object({}).strict();

    const handled = await defineExecute(schema, async () => {
      throw new ToolExecutionError("expected", { code: "device_error" });
    })({}, ctx);
    expect(JSON.parse(handled.content[0]!.text).error.code).toBe("device_error");

    const unhandled = defineExecute(schema, async () => {
      throw new RangeError("not a tool error");
    })({}, ctx);
    await expect(unhandled).rejects.toThrow(RangeError);
  });
});

describe("hierarchy parsing edge cases", () => {
  it("decodes the remaining XML entities and tolerates a node with no closing bracket", () => {
    const nodes = parseNodes(
      '<hierarchy><node text="a &lt; b &gt; c &quot;q&quot; &apos;p&apos; &amp; d" class="T" enabled="false"',
    );
    expect(nodes[0]?.text).toBe(`a < b > c "q" 'p' & d`);
    expect(nodes[0]?.enabled).toBe(false);
    expect(nodes[0]?.bounds).toBeNull();
  });

  it("treats a node with no bounds as not on screen, whatever the selectors say", () => {
    const nodes = parseNodes('<hierarchy><node text="ghost" class="T" enabled="true" /></hierarchy>');
    const outcome = evaluateMatches(
      nodes,
      { text: "ghost" },
      { width: 100, height: 100 },
      {
        requireEnabled: true,
        requireOnScreen: true,
      },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.candidates[0]?.rejectedBy).toBe("requireOnScreen");
  });
});

describe("install failure shapes", () => {
  it("fails when adb exits zero but never printed Success", async () => {
    const transport = new FakeTransport();
    transport.installResult = {
      installed: false,
      stdout: "Performing Streamed Install\n",
      stderr: "",
      exitCode: 0,
      argv: [],
    };
    const { ctx } = await createTestContext({ transport });
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-apk-"));
    const apkPath = path.join(dir, "app.apk");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(apkPath, "apk");

    const result = await invoke("droid_app.install_app", { targetId: TARGET, package: PACKAGE, apkPath }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/Install of .* failed/);
  });
});

describe("recording ownership and empty output", () => {
  it("refuses a recordingId that belongs to another target", async () => {
    const transport = new FakeTransport([
      {
        targetId: TARGET,
        transport: "adb",
        serial: "TESTSERIAL01",
        model: null,
        apiLevel: null,
        state: "device",
        isEmulator: false,
      },
      {
        targetId: "adb:OTHER",
        transport: "adb",
        serial: "OTHER",
        model: null,
        apiLevel: null,
        state: "device",
        isEmulator: false,
      },
    ]);
    const { ctx } = await createTestContext({ transport });

    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "owned" }, ctx);
    const wrong = await invoke(
      "droid_capture.stop_recording",
      { targetId: "adb:OTHER", recordingId: started.data.recordingId },
      ctx,
    );

    expect(wrong.ok).toBe(false);
    expect(wrong.error.message).toMatch(/belongs to adb:TESTSERIAL01, not to adb:OTHER/);
  });

  it("reports a recorder that produced a zero-byte file", async () => {
    const transport = new FakeTransport();
    transport.spawnStopStderr = "ERROR: UNASSIGNED_LAYER_STACK, please check your display state.\n";
    const { ctx } = await createTestContext({ transport });

    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "empty-clip" }, ctx);
    transport.pullPayloads.set("/sdcard/droidctl-empty-clip.mp4", Buffer.alloc(0));
    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );

    expect(stopped.ok).toBe(true);
    expect(stopped.data.pulled).toBe(false);
    expect(stopped.data.reason).toMatch(/screenrecord wrote no data: ERROR: UNASSIGNED_LAYER_STACK/);
  });
});

describe("prepare_device reporting when the dumps say nothing", () => {
  it("returns nulls rather than inventing a focused window or resumed activity", async () => {
    const transport = new FakeTransport();
    transport.respondTo("getprop", { stdout: "[ro.build.version.sdk]: [33]" });
    transport.respondTo("getprop sys.boot_completed", { stdout: "1\n" });
    transport.respondTo("wm size", { stdout: "Physical size: 1080x2280\n" });
    transport.respondTo("wm density", { stdout: "Physical density: 440\n" });
    transport.respondTo("settings get global", { stdout: "1.0\n" });
    transport.respondTo("dumpsys window", { stdout: "no focus line here\n" });
    transport.respondTo("dumpsys window policy", { stdout: "mShowing=true\n" });
    transport.respondTo("dumpsys activity activities", { stdout: "nothing resumed\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.prepare_device", { targetId: TARGET }, ctx);
    expect(result.data).toMatchObject({ keyguardShowing: true, focusedWindow: null, resumedActivity: null });
  });

  it("refuses on a density override even when the size override is absent", async () => {
    const transport = new FakeTransport();
    transport.respondTo("getprop", { stdout: "[ro.build.version.sdk]: [33]" });
    transport.respondTo("getprop sys.boot_completed", { stdout: "1\n" });
    transport.respondTo("wm size", { stdout: "Physical size: 1080x2280\n" });
    transport.respondTo("wm density", { stdout: "Physical density: 440\nOverride density: 240\n" });
    transport.respondTo("settings get global", { stdout: "1.0\n" });
    transport.respondTo("dumpsys", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.prepare_device", { targetId: TARGET, requireNativeGeometry: true }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/size=none, density=240/);
  });
});

describe("hierarchy capture when both routes fail", () => {
  it("reports the file route and the tty route both failing", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "10\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: "not xml" });
    transport.respondTo("uiautomator dump /dev/tty", { throws: new Error("tty unavailable") });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, attempts: 1 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/tty unavailable/);
  });
});

describe("the detached spawn runner", () => {
  it("notifies a listener that registers after the child has already exited", async () => {
    const handle = nodeSpawnRunner({ file: "node", args: ["-e", "process.exit(0)"] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await new Promise<number | null>((resolve) => handle.onClose(resolve))).toBe(0);
  });

  it("notifies a listener when the binary cannot be spawned at all", async () => {
    const handle = nodeSpawnRunner({ file: path.join(os.tmpdir(), "droidctl-no-such-binary"), args: [] });
    expect(await new Promise<number | null>((resolve) => handle.onClose(resolve))).toBeNull();
  });
});

describe("the fake transport's own branches", () => {
  it("matches a responder by regular expression and can throw or return a non-zero exit", async () => {
    const transport = new FakeTransport();
    transport.respondTo(/^getprop/, { stdout: "matched\n" });
    transport.respondTo("boom", { throws: new Error("scripted failure") });
    transport.respondTo("bad", { exitCode: 9, stderr: "nope" });
    const { ctx } = await createTestContext({ transport });

    const matched = await invoke("droid_device.run_shell", { targetId: TARGET, command: ["getprop", "x"] }, ctx);
    expect(matched.data.stdout).toBe("matched\n");

    // A plain Error is not a ToolError, so it propagates for the server to report
    // as unhandled rather than being dressed up as a normal failure.
    await expect(invoke("droid_device.run_shell", { targetId: TARGET, command: ["boom"] }, ctx)).rejects.toThrow(
      /scripted failure/,
    );

    const failed = await invoke("droid_device.run_shell", { targetId: TARGET, command: ["bad"] }, ctx);
    expect(failed.data).toMatchObject({ exitCode: 9, stderr: "nope" });
  });
});

describe("optional arguments, present and absent", () => {
  const apk = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-opts-"));
    const apkPath = path.join(dir, "app.apk");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(apkPath, "apk");
    return apkPath;
  };

  const ready = () => {
    const transport = new FakeTransport();
    transport.respondTo("pm list packages", { stdout: `package:${PACKAGE}\n` });
    transport.respondTo("getprop", { stdout: "[ro.build.version.sdk]: [33]" });
    transport.respondTo("wm size", { stdout: "Physical size: 1080x2280\n" });
    transport.respondTo("wm density", { stdout: "Physical density: 440\n" });
    transport.respondTo("am start", { stdout: "Status: ok\nTotalTime: 100\n" });
    transport.respondTo("dumpsys activity activities", { stdout: `mResumedActivity: ${PACKAGE}/.MainActivity` });
    transport.respondTo("logcat -d", { stdout: "one line\n" });
    return transport;
  };

  it("passes every install flag through when all are given, and none when they are not", async () => {
    const withAll = ready();
    const ctxAll = (await createTestContext({ transport: withAll })).ctx;
    await invoke(
      "droid_app.install_app",
      {
        targetId: TARGET,
        package: PACKAGE,
        apkPath: await apk(),
        reinstall: false,
        allowDowngrade: true,
        grantPermissions: true,
        allowTestPackages: true,
      },
      ctxAll,
    );
    expect(withAll.calls.find((call) => call.kind === "install")?.argv).toEqual(
      expect.arrayContaining(["install", "-d", "-g", "-t"]),
    );

    const withNone = ready();
    const ctxNone = (await createTestContext({ transport: withNone })).ctx;
    await invoke("droid_app.install_app", { targetId: TARGET, package: PACKAGE, apkPath: await apk() }, ctxNone);
    expect(withNone.calls.find((call) => call.kind === "install")?.argv.slice(0, 2)).toEqual(["install", "-r"]);
  });

  it("launches by explicit activity and reports a missing TotalTime as null", async () => {
    const transport = ready();
    transport.respondTo("am start", { stdout: "Status: ok\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.start_app",
      { targetId: TARGET, package: PACKAGE, activity: ".OtherActivity" },
      ctx,
    );
    expect(result.data.totalTimeMs).toBeNull();
    expect(transport.execArgvLines()).toContain(`am start -W -n ${PACKAGE}/.OtherActivity`);
  });

  it("carries every optional run_shell and logcat argument", async () => {
    const transport = ready();
    transport.respondTo("pidof", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    await invoke(
      "droid_device.run_shell",
      { targetId: TARGET, command: ["echo", "hi"], timeoutMs: 1000, maxBytes: 4096, stdin: "payload" },
      ctx,
    );

    const logcat = await invoke(
      "droid_capture.logcat",
      { targetId: TARGET, mode: "dump", name: "opts", lines: 10, format: "brief", tags: ["A", "B"], maxBytes: 4096 },
      ctx,
    );
    expect(transport.execArgvLines()).toContain("logcat -d -t 10 -v brief -s A:I -s B:I");
    expect(logcat.data.matchedCount).toBe(0);
  });

  it("passes the screenshot review options and a swipe duration through", async () => {
    const transport = ready();
    const { encodePng } = await import("../src/png.js");
    transport.respondTo("screencap -p", {
      stdoutBytes: encodePng({ width: 200, height: 100, pixels: Buffer.alloc(200 * 100 * 4, 90) }),
    });
    const { ctx } = await createTestContext({ transport });

    const shot = await invoke(
      "droid_capture.screenshot",
      { targetId: TARGET, name: "opts", reviewWidth: 100, maxDimension: 500 },
      ctx,
    );
    expect(shot.data.review).toEqual({ width: 100, height: 50 });

    await invoke("droid_input.swipe", { targetId: TARGET, x1: 1, y1: 2, x2: 3, y2: 4, durationMs: 900 }, ctx);
    expect(transport.execArgvLines()).toContain("input swipe 1 2 3 4 900");
  });

  it("starts a recording with an explicit size and bit rate", async () => {
    const transport = ready();
    const { ctx } = await createTestContext({ transport });

    await invoke(
      "droid_capture.start_recording",
      { targetId: TARGET, name: "sized", timeLimitSec: 5, bitRate: 4_000_000, size: "480x640" },
      ctx,
    );
    expect(transport.spawned[0]?.argv.join(" ")).toBe(
      "screenrecord --bit-rate 4000000 --time-limit 5 --size 480x640 /sdcard/droidctl-sized.mp4",
    );
  });

  it("writes artifacts into an explicit runRoot", async () => {
    const transport = ready();
    transport.respondTo("wc -c", { stdout: "9\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", {
      stdout: '<hierarchy><node bounds="[0,0][10,10]" enabled="true" /></hierarchy>',
    });
    const { ctx } = await createTestContext({ transport });
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-runroot-"));

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, name: "rr", runRoot }, ctx);
    expect(result.data.xmlPath.startsWith(runRoot)).toBe(true);
  });
});

describe("adb devices parsing details", () => {
  it("ignores a tail entry that is not a key:value pair", async () => {
    const { parseAdbDevices } = await import("../src/transport/adb.js");
    const [target] = parseAdbDevices("List of devices attached\nSERIAL device bare model:Pixel_4 :leading\n");
    expect(target).toMatchObject({ serial: "SERIAL", model: "Pixel_4" });
  });

  it("skips a line with no state field", async () => {
    const { parseAdbDevices } = await import("../src/transport/adb.js");
    expect(parseAdbDevices("List of devices attached\nSERIALONLY\n")).toEqual([]);
  });
});

describe("capability refusal message", () => {
  it("omits the trailing note when the transport has none for that tool", async () => {
    const { requireCapability } = await import("../src/tools/common.js");
    const handle = {
      info: {
        targetId: "x",
        transport: "adb" as const,
        serial: "x",
        model: null,
        apiLevel: null,
        state: "device" as const,
        isEmulator: false,
      },
      transport: {
        kind: "adb" as const,
        capabilities: () => ({ transport: "adb" as const, tools: { "t.x": "unsupported" as const }, notes: {} }),
      },
      target: { targetId: "x", transport: "adb" as const, serial: "x" },
    };
    expect(() => requireCapability(handle as never, "t.x")).toThrow(/t\.x is unsupported on the adb transport\.$/);
  });
});

describe("remaining guards", () => {
  it("uses a generated run id and the default artifact root when neither is given", async () => {
    const { createDroidctlServerRuntime } = await import("../src/server.js");
    const runtime = createDroidctlServerRuntime({ transports: [new FakeTransport()] });
    expect(runtime.artifacts.runId).toMatch(/^dc-\d{8}T\d{6}Z$/);
    expect(runtime.artifacts.runDir).toContain(path.join("artifacts", "droidctl"));
  });

  it("skips the capability gate when no tool name is on the context", async () => {
    const { resolveTarget } = await import("../src/tools/common.js");
    const { ctx } = await createTestContext();
    const handle = await resolveTarget({ ...ctx, toolName: undefined }, TARGET);
    expect(handle.target.targetId).toBe(TARGET);
  });

  it("reports a non-Error thrown by a transport during enumeration", async () => {
    const { TransportRegistry } = await import("../src/transport/registry.js");
    const transport = new FakeTransport();
    transport.listTargetsError = "a string, not an Error" as unknown as Error;
    const listing = await new TransportRegistry([transport]).list();
    expect(listing.transportErrors).toEqual([{ transport: "adb", message: "a string, not an Error" }]);
  });

  it("fails waitForResume when nothing at all is resumed", async () => {
    const transport = new FakeTransport();
    transport.respondTo("am start", { stdout: "Status: ok\nTotalTime: 5\n" });
    transport.respondTo("dumpsys activity activities", { stdout: "no resumed line" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.start_app",
      { targetId: TARGET, package: PACKAGE, waitForResume: true, resumeTimeoutMs: 150 },
      ctx,
    );
    expect(result.error.message).toMatch(/\(resumed: none\)/);
  });

  it("writes an app file at the sandbox root, where there is no sub-directory", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    await invoke(
      "droid_app.write_app_file",
      { targetId: TARGET, package: PACKAGE, relativePath: "files", content: "x" },
      ctx,
    );
    expect(transport.execArgvLines()[0]).toContain("mkdir -p 'files'");
  });

  it("falls back to a generic message when run-as fails with no stderr", async () => {
    const transport = new FakeTransport();
    transport.respondTo("run-as", { exitCode: 1, stderr: "   " });
    const { ctx } = await createTestContext({ transport });

    const write = await invoke(
      "droid_app.write_app_file",
      { targetId: TARGET, package: PACKAGE, relativePath: "a.json", content: "{}" },
      ctx,
    );
    const read = await invoke(
      "droid_app.read_app_file",
      { targetId: TARGET, package: PACKAGE, relativePath: "a.json" },
      ctx,
    );
    expect(write.error.message).toMatch(/non-zero exit$/);
    expect(read.error.message).toMatch(/non-zero exit$/);
  });

  it("evaluates a match with both state predicates switched off", () => {
    const nodes = parseNodes('<hierarchy><node text="t" class="T" enabled="false" bounds="[0,0][0,0]" /></hierarchy>');
    const outcome = evaluateMatches(
      nodes,
      { text: "t" },
      { width: 10, height: 10 },
      {
        requireEnabled: false,
        requireOnScreen: false,
      },
    );
    expect(outcome.passed).toBe(true);
    expect(outcome.candidates[0]?.rejectedBy).toBeNull();
  });

  it("refuses rather than passing an assertion when no screen rectangle can be established", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "5\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: "<hierarchy></hierarchy>" });
    transport.respondTo("getprop", { stdout: "" });
    transport.respondTo("wm size", { stdout: "" });
    transport.respondTo("wm density", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    // The dangerous shape: a 0x0 screen fails requireOnScreen for every node, so
    // assert_not_visible would report a clean pass with the node right there.
    const negative = await invoke(
      "droid_assert.assert_not_visible",
      { targetId: TARGET, name: "noscreen", match: { text: "Something went wrong" } },
      ctx,
    );
    expect(negative.ok).toBe(false);
    expect(negative.error.message).toMatch(/visibility cannot be decided/);
  });

  it("falls back to the device geometry when the hierarchy carries no bounds", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "5\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", {
      stdout: '<hierarchy><node text="Something went wrong" class="T" enabled="true" /></hierarchy>',
    });
    transport.respondTo("getprop", { stdout: "[ro.build.version.sdk]: [33]" });
    transport.respondTo("wm size", { stdout: "Physical size: 1080x2280\n" });
    transport.respondTo("wm density", { stdout: "Physical density: 440\n" });
    transport.respondTo("screencap -p", {
      stdoutBytes: (await import("../src/png.js")).encodePng({ width: 4, height: 4, pixels: Buffer.alloc(64, 3) }),
    });
    const { ctx } = await createTestContext({ transport });

    const negative = await invoke(
      "droid_assert.assert_not_visible",
      { targetId: TARGET, name: "crashtext", match: { text: "Something went wrong" } },
      ctx,
    );
    expect(negative.data.screen).toEqual({ width: 1080, height: 2280 });
    // The node has no bounds, so it is still not visible - but that verdict now
    // comes from a real screen rectangle rather than from 0x0.
    expect(negative.data.passed).toBe(true);
    expect(negative.data.matches[0].rejectedBy).toBe("requireOnScreen");
  });

  it("writes failure evidence into an explicit runRoot", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "5\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", {
      stdout: '<hierarchy><node bounds="[0,0][10,10]" enabled="true" /></hierarchy>',
    });
    transport.respondTo("screencap -p", {
      stdoutBytes: (await import("../src/png.js")).encodePng({ width: 4, height: 4, pixels: Buffer.alloc(64, 3) }),
    });
    const { ctx } = await createTestContext({ transport });
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-evidence-"));

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "missing", match: { text: "absent" }, runRoot },
      ctx,
    );
    expect(result.data.passed).toBe(false);
    expect(result.data.evidence.screenshotPath.startsWith(runRoot)).toBe(true);
  });

  it("keeps -r off an install that explicitly disables reinstall", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const requests: string[][] = [];
    const transport = new AdbTransport({
      exec: async (request) => {
        requests.push([...request.args]);
        return { stdout: Buffer.from("Success"), stderr: "", exitCode: 0 };
      },
    });
    await transport.installPackage({ targetId: "adb:X", transport: "adb", serial: "X" }, "/tmp/a.apk", {
      reinstall: false,
      timeoutMs: 1000,
    });
    expect(requests[0]).toEqual(["-s", "X", "install", "/tmp/a.apk"]);
  });

  it("classifies a non-timeout spawn failure as a device error", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const transport = new AdbTransport({
      exec: async () => {
        throw "a string failure";
      },
    });
    await expect(
      transport.exec({ targetId: "adb:X", transport: "adb", serial: "X" }, ["getprop"]),
    ).rejects.toMatchObject({ code: "device_error" });
  });

  it("reverses a Paeth filter that selects each of its three predictors", async () => {
    const { decodePng, encodePng } = await import("../src/png.js");
    // Encode then decode a gradient: the Paeth branch picks a, b and c across it.
    const pixels = Buffer.alloc(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i += 1) {
      pixels[i * 4] = (i * 7) % 256;
      pixels[i * 4 + 1] = (i * 13) % 256;
      pixels[i * 4 + 2] = (i * 29) % 256;
      pixels[i * 4 + 3] = 255;
    }
    expect(decodePng(encodePng({ width: 8, height: 8, pixels })).pixels).toEqual(pixels);
  });
});

describe("the last guards", () => {
  it("converts an unexpected throw from a tool into an error result at the server boundary", async () => {
    const { createDroidctlServerRuntime } = await import("../src/server.js");
    const runtime = createDroidctlServerRuntime({ transports: [new FakeTransport()], runId: "dc-BOUNDARY" });
    const handlers = (
      runtime.server as unknown as { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<unknown>> }
    )._requestHandlers;

    const failure = (await handlers.get("tools/call")!(
      { method: "tools/call", params: { name: "droid_target.nope", arguments: {} } },
      {},
    )) as { isError?: boolean };
    expect(failure.isError).toBe(true);

    const ok = (await handlers.get("tools/call")!(
      { method: "tools/call", params: { name: "droid_target.list_targets" } },
      {},
    )) as { isError?: boolean };
    expect(ok.isError).toBeUndefined();
  });

  it("names the missing stderr when a recorder produced nothing and said nothing", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });
    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "silent" }, ctx);
    transport.pullPayloads.set("/sdcard/droidctl-silent.mp4", Buffer.alloc(0));

    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );
    expect(stopped.data.reason).toMatch(/no stderr from the recorder/);
  });

  it("accepts runtime content when a pid was resolved and lines came back", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "77\n" });
    transport.respondTo("logcat -d", { stdout: "a line\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.logcat",
      { targetId: TARGET, mode: "dump", package: PACKAGE, requireRuntimeContent: true },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.data.pid).toBe("77");
  });

  it("settles a dump whose size reading is not a number, then stabilises", async () => {
    const transport = new FakeTransport();
    const sizes = ["not-a-number\n", "12\n", "12\n"];
    let index = 0;
    transport.respond((argv) => (argv.join(" ").includes("wc -c") ? { stdout: sizes[index++] ?? "12\n" } : undefined));
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", {
      stdout: '<hierarchy><node bounds="[0,0][10,10]" enabled="true" /></hierarchy>',
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, name: "settle" }, ctx);
    expect(result.ok).toBe(true);
  });

  it("reports a socket with no numeric suffix as a null pid", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "5 6\n" });
    transport.respondTo("cat /proc/net/unix", { stdout: "0000: 1 0 1 0 0 1 @webview_devtools_remote_5" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_device.forward_webview",
      { targetId: TARGET, package: PACKAGE, localPort: 9222 },
      ctx,
    );
    expect(result.data.pid).toBe("5");
  });

  it("resolves a detached stop by timeout when the child never closes", async () => {
    const { AdbTransport, DETACHED_STOP_TIMEOUT_MS } = await import("../src/transport/adb.js");
    expect(DETACHED_STOP_TIMEOUT_MS).toBeGreaterThan(0);
    const transport = new AdbTransport({
      spawn: () => ({ kill: () => undefined, onClose: () => undefined, onStderr: () => undefined }),
    });
    const handle = transport.spawnShell({ targetId: "adb:X", transport: "adb", serial: "X" }, ["screenrecord"]);

    const stopped = await Promise.race([
      handle.stop("graceful"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 200)),
    ]);
    // The bounded wait is 15s, so within 200ms the promise must still be pending:
    // that is the guarantee, not that it resolves instantly.
    expect(stopped).toBe("still waiting");
  });

  it("rejects when the local adb binary itself cannot be spawned", async () => {
    const { nodeExecRunner } = await import("../src/transport/adb.js");
    await expect(
      nodeExecRunner({ file: "node", args: ["-e", "process.exit(0)"], timeoutMs: 5000, maxBytes: 1024 }),
    ).resolves.toMatchObject({ exitCode: 0 });
    // Oversized output is truncated by the caller, not fatal to the runner: a
    // 135 MB recording pull must not die on an exec buffer.
    await expect(
      nodeExecRunner({
        file: "node",
        args: ["-e", "process.stdout.write('x'.repeat(5000))"],
        timeoutMs: 5000,
        maxBytes: 16,
      }),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(
      nodeExecRunner({
        file: path.join(os.tmpdir(), "droidctl-absent-binary"),
        args: [],
        timeoutMs: 5000,
        maxBytes: 16,
      }),
    ).rejects.toThrow();
  });
});

describe("hardening found by the adversarial review", () => {
  it("truncates an oversized payload instead of failing the call", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const transport = new AdbTransport({
      exec: async () => ({ stdout: Buffer.alloc(5000, 0x61), stderr: "", exitCode: 0 }),
    });
    const result = await transport.exec({ targetId: "adb:X", transport: "adb", serial: "X" }, ["logcat"], {
      maxBytes: 16,
    });
    expect(result.stdout).toHaveLength(16);
    expect(result.truncated).toBe(true);
  });

  it("reports a killed adb child as a timeout, not a device error", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const transport = new AdbTransport({
      exec: async () => ({ stdout: Buffer.alloc(0), stderr: "", exitCode: -1, timedOut: true }),
    });
    await expect(
      transport.exec({ targetId: "adb:X", transport: "adb", serial: "X" }, ["uiautomator", "dump"]),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("renders an abstract socket and a TCP endpoint into adb's own forward grammar", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const requests: string[][] = [];
    const transport = new AdbTransport({
      exec: async (request) => {
        requests.push([...request.args]);
        return { stdout: Buffer.alloc(0), stderr: "", exitCode: 0 };
      },
    });
    const target = { targetId: "adb:X", transport: "adb" as const, serial: "X" };
    await transport.forwardPort(target, 1, { kind: "abstractSocket", name: "sock" });
    await transport.forwardPort(target, 2, { kind: "tcp", port: 5555 });
    expect(requests.map((r) => r.slice(3))).toEqual([
      ["tcp:1", "localabstract:sock"],
      ["tcp:2", "tcp:5555"],
    ]);
  });

  it("turns an immediate stop into SIGKILL and a graceful one into SIGINT", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const signals: NodeJS.Signals[] = [];
    const make = () => {
      let onClose: ((code: number | null) => void) | undefined;
      return {
        handle: {
          kill(signal: NodeJS.Signals) {
            signals.push(signal);
            onClose?.(0);
          },
          onClose(listener: (code: number | null) => void) {
            onClose = listener;
          },
          onStderr() {},
        },
      };
    };
    const transport = new AdbTransport({ spawn: () => make().handle });
    const target = { targetId: "adb:X", transport: "adb" as const, serial: "X" };
    await transport.spawnShell(target, ["screenrecord"]).stop("graceful");
    await transport.spawnShell(target, ["screenrecord"]).stop("immediate");
    expect(signals).toEqual(["SIGINT", "SIGKILL"]);
  });

  it("decides install success in the backend rather than by regexing its stdout", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const outcomes = [
      { text: "Success\n", installed: true, mismatch: false },
      { text: "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]", installed: false, mismatch: true },
      { text: "Performing Streamed Install\n", installed: false, mismatch: false },
    ];
    for (const outcome of outcomes) {
      const transport = new AdbTransport({
        exec: async () => ({ stdout: Buffer.from(outcome.text), stderr: "", exitCode: 0 }),
      });
      const result = await transport.installPackage(
        { targetId: "adb:X", transport: "adb", serial: "X" },
        "/tmp/a.apk",
        {},
      );
      expect({ installed: result.installed, mismatch: result.signatureMismatch }).toEqual({
        installed: outcome.installed,
        mismatch: outcome.mismatch,
      });
    }
  });

  it("refuses a tool the transport does not list at all", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    transport.toolSupport = { "droid_input.tap": "supported", "droid_target.describe_target": "supported" };
    const { ctx } = await createTestContext({ transport });

    const allowed = await invoke("droid_input.tap", { targetId: TARGET, x: 1, y: 1 }, ctx);
    expect(allowed.ok).toBe(true);

    const refused = await invoke("droid_app.stop_app", { targetId: TARGET, package: PACKAGE }, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("unsupported_on_transport");
    expect(refused.error.message).toMatch(/not listed in the adb transport's capability map/);
  });

  it("polls for the resumed activity instead of reading it once", async () => {
    const transport = new FakeTransport();
    transport.respondTo("am start", { stdout: "Status: ok\nTotalTime: 5\n" });
    let reads = 0;
    transport.respond((argv) =>
      argv.join(" ").startsWith("dumpsys activity activities")
        ? { stdout: ++reads < 3 ? "nothing yet" : `mResumedActivity: ${PACKAGE}/.MainActivity` }
        : undefined,
    );
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.start_app",
      { targetId: TARGET, package: PACKAGE, waitForResume: true, resumeTimeoutMs: 4000 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(3);
  });

  it("accepts a logcat with content when no package was named", async () => {
    const transport = new FakeTransport();
    transport.respondTo("logcat -d", { stdout: "some line\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.logcat",
      { targetId: TARGET, mode: "dump", requireRuntimeContent: true },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.data.lineCount).toBe(1);
  });

  it("counts a byte budget in bytes, not UTF-16 units", async () => {
    const transport = new FakeTransport();
    transport.respondTo("cat 'files/e.txt'", { stdout: "€€€€€" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.read_app_file",
      { targetId: TARGET, package: PACKAGE, relativePath: "e.txt", maxBytes: 4 },
      ctx,
    );
    // Three bytes, not four: the cut moves back to a character boundary rather
    // than splitting the euro sign and emitting a replacement character.
    expect(result.data).toMatchObject({ content: "\u20ac", bytes: 3, totalBytes: 15, truncated: true });
    expect(Buffer.byteLength(result.data.content, "utf8")).toBeLessThanOrEqual(4);
  });

  it("decodes the numeric character references Android emits for newline and tab", () => {
    const nodes = parseNodes(
      '<hierarchy><node text="line&#10;two&#9;tabbed&#x41;" class="T" enabled="true" /></hierarchy>',
    );
    expect(nodes[0]?.text).toBe("line\ntwo\ttabbedA");
  });

  it("reports an undecodable screenshot as a tool error, not an internal one", async () => {
    const transport = new FakeTransport();
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    transport.respondTo("screencap -p", { stdoutBytes: broken });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.screenshot", { targetId: TARGET, name: "broken" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("device_error");
    expect(result.error.message).toMatch(/could not be decoded/);
  });
});

describe("residual guards after the hardening", () => {
  const target = { targetId: "adb:X", transport: "adb" as const, serial: "X" };

  it("reports a failing adb pull and a failing logcat dump", async () => {
    const { AdbTransport } = await import("../src/transport/adb.js");
    const failing = new AdbTransport({
      exec: async () => ({ stdout: Buffer.alloc(0), stderr: "remote object does not exist", exitCode: 1 }),
    });
    await expect(failing.pullFile(target, "/sdcard/x.mp4", path.join(os.tmpdir(), "x.mp4"))).rejects.toThrow(
      /adb pull of .* failed/,
    );

    const transport = new FakeTransport();
    transport.respondTo("logcat -d", { exitCode: 1, stderr: "device offline" });
    const { ctx } = await createTestContext({ transport });
    const dump = await invoke("droid_capture.logcat", { targetId: TARGET, mode: "dump" }, ctx);
    expect(dump.ok).toBe(false);
    expect(dump.error.message).toMatch(/logcat -d failed/);
  });

  it("rejects a spawn failure that is not a signal kill", async () => {
    const { nodeExecRunner } = await import("../src/transport/adb.js");
    await expect(
      nodeExecRunner({ file: path.join(os.tmpdir(), "droidctl-missing-bin"), args: [], timeoutMs: 2000, maxBytes: 64 }),
    ).rejects.toThrow();
  });

  it("keeps a pulled MP4 that carries a valid ftyp box and deletes the device copy", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });
    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "kept" }, ctx);
    const mp4 = Buffer.alloc(2048);
    mp4.write("ftyp", 4, "ascii");
    transport.pullPayloads.set("/sdcard/droidctl-kept.mp4", mp4);

    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );
    expect(stopped.data).toMatchObject({ pulled: true, bytes: 2048 });
    expect(transport.execArgvLines()).toContain("rm -f /sdcard/droidctl-kept.mp4");
  });

  it("fails requireRuntimeContent when the named package never appears", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "" });
    transport.respondTo("logcat -d", { stdout: "unrelated chatter\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.logcat",
      { targetId: TARGET, mode: "dump", package: PACKAGE, requireRuntimeContent: true },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/no runtime content/);
  });

  it("returns the payload untouched when it fits the byte budget", async () => {
    const { truncateUtf8 } = await import("../src/tools/modules/app.js");
    expect(truncateUtf8(Buffer.from("abc"), 10).toString()).toBe("abc");
    expect(truncateUtf8(Buffer.from("abcdef"), 3).toString()).toBe("abc");
    // A cut landing exactly on a boundary is not moved back.
    expect(truncateUtf8(Buffer.from("€€"), 3).toString()).toBe("€");
  });
});

describe("the last three branches", () => {
  it("selects the upper-left predictor when Paeth prefers it", async () => {
    const { decodePng, encodePng } = await import("../src/png.js");
    // A checkerboard drives Paeth through all three predictor choices.
    const size = 6;
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const o = (y * size + x) * 4;
        const v = (x * 97 + y * 211) % 256;
        pixels[o] = v;
        pixels[o + 1] = 255 - v;
        pixels[o + 2] = (v * 3) % 256;
        pixels[o + 3] = 255;
      }
    }
    expect(decodePng(encodePng({ width: size, height: size, pixels })).pixels).toEqual(pixels);
  });

  it("names a size override with no density override in the refusal", async () => {
    const transport = new FakeTransport();
    transport.respondTo("getprop", { stdout: "[ro.build.version.sdk]: [33]" });
    transport.respondTo("getprop sys.boot_completed", { stdout: "1\n" });
    transport.respondTo("wm size", { stdout: "Physical size: 1080x2280\nOverride size: 480x640\n" });
    transport.respondTo("wm density", { stdout: "Physical density: 440\n" });
    transport.respondTo("settings get global", { stdout: "1.0\n" });
    transport.respondTo("dumpsys", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_device.prepare_device", { targetId: TARGET, requireNativeGeometry: true }, ctx);
    expect(result.error.message).toMatch(/size=480x640, density=none/);
  });

  it("propagates a non-zero exit as an error when the caller asked it to", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });
    const handle = await ctx.transports.resolve(TARGET);
    transport.respondTo("false", { exitCode: 3, stderr: "no" });

    await expect(handle.transport.exec(handle.target, ["false"], { throwOnNonZeroExit: true })).rejects.toThrow(
      /Command failed on adb:TESTSERIAL01/,
    );
  });
});
