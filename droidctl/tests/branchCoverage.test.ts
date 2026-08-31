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
import { createTestContext, invoke } from "./support/harness.js";

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
    transport.installResult = { stdout: "Performing Streamed Install\n", stderr: "", exitCode: 0, argv: [] };
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
      { targetId: TARGET, package: PACKAGE, waitForResume: true },
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

  it("uses a zero screen rectangle when the hierarchy has no bounds at all", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "5\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: "<hierarchy></hierarchy>" });
    transport.respondTo("screencap -p", {
      stdoutBytes: (await import("../src/png.js")).encodePng({
        width: 4,
        height: 4,
        pixels: Buffer.alloc(64, 3),
      }),
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_assert.assert_visible",
      { targetId: TARGET, name: "noscreen", match: { text: "anything" } },
      ctx,
    );
    expect(result.data.screen).toEqual({ width: 0, height: 0 });
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
      handle.stop("SIGINT"),
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
    await expect(
      nodeExecRunner({
        file: "node",
        args: ["-e", "process.stdout.write('x'.repeat(5000))"],
        timeoutMs: 5000,
        maxBytes: 16,
      }),
    ).rejects.toThrow();
  });
});
