/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { countNodes, screenFromHierarchy } from "../src/tools/modules/capture.js";
import { encodePng, readPngDimensions } from "../src/png.js";
import { FakeTransport } from "../src/transport/fake.js";
import { HIERARCHY_XML, createTestContext, invoke } from "./support/harness.js";

const TARGET = "adb:TESTSERIAL01";

function screenPng(width = 1080, height = 2280): Buffer {
  return encodePng({ width, height, pixels: Buffer.alloc(width * height * 4, 180) });
}

function mp4(bytes = 4096): Buffer {
  const payload = Buffer.alloc(bytes, 0);
  payload.write("ftyp", 4, "ascii");
  payload.writeUInt32BE(bytes, 0);
  return payload;
}

describe("droid_capture.screenshot", () => {
  it("writes a raw PNG and a 480 px review PNG, both decodable", async () => {
    const transport = new FakeTransport();
    transport.respondTo("screencap -p", { stdoutBytes: screenPng() });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.screenshot", { targetId: TARGET, name: "home" }, ctx);

    expect(result.ok).toBe(true);
    expect(result.data.raw).toEqual({ width: 1080, height: 2280 });
    expect(result.data.review).toEqual({ width: 480, height: 1013 });
    expect(result.data.rawPath).toMatch(/raw\/home\.png$/);
    expect(result.data.reviewPath).toMatch(/review\/home-review\.png$/);
    expect(readPngDimensions(await readFile(result.data.rawPath))).toEqual({ width: 1080, height: 2280 });
    expect(readPngDimensions(await readFile(result.data.reviewPath))).toEqual({ width: 480, height: 1013 });
  });

  it("falls back to the file route when exec-out returns nothing", async () => {
    const transport = new FakeTransport();
    transport.respondTo("screencap -p /data/local/tmp/droidctl-screencap.png", { stdout: "" });
    transport.respondTo("screencap -p", { stdoutBytes: Buffer.alloc(0) });
    transport.pullPayloads.set("/data/local/tmp/droidctl-screencap.png", screenPng(320, 480));
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.screenshot", { targetId: TARGET, name: "fallback" }, ctx);

    expect(result.ok).toBe(true);
    expect(result.data.raw).toEqual({ width: 320, height: 480 });
    expect(transport.calls.some((call) => call.kind === "pull")).toBe(true);
    expect(transport.execArgvLines()).toContain("rm -f /data/local/tmp/droidctl-screencap.png");
  });

  it("rejects a truncated capture at the point of capture, not at evidence validation", async () => {
    const transport = new FakeTransport();
    transport.respondTo("screencap -p", { stdoutBytes: Buffer.from("not a png") });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.screenshot", { targetId: TARGET, name: "broken" }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/is not a PNG/);
  });

  it("sanitises the artifact name", async () => {
    const transport = new FakeTransport();
    transport.respondTo("screencap -p", { stdoutBytes: screenPng(64, 64) });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.screenshot", { targetId: TARGET, name: "../../escape me" }, ctx);
    expect(result.data.rawPath).toMatch(/raw\/escape-me\.png$/);
  });
});

describe("droid_capture.ui_hierarchy", () => {
  it("dumps, waits for the file to settle, reads it back and counts nodes", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "512\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: HIERARCHY_XML });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, name: "home" }, ctx);

    expect(result.ok).toBe(true);
    expect(result.data.attempts).toBe(1);
    expect(result.data.via).toBe("file");
    expect(result.data.nodeCount).toBe(4);
    expect(result.data.screen).toEqual({ width: 1080, height: 2280 });
    expect(await readFile(result.data.xmlPath, "utf8")).toBe(HIERARCHY_XML);
    expect(transport.execArgvLines()).toContain("uiautomator dump /sdcard/Download/droidctl-ui.xml");
  });

  it("retries the whole capture and then falls back to /dev/tty", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "512\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: "" });
    transport.respondTo("uiautomator dump /dev/tty", {
      stdout: `${HIERARCHY_XML}\nUI hierchary dumped to: /dev/tty`,
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, attempts: 2 }, ctx);

    expect(result.ok).toBe(true);
    expect(result.data.via).toBe("tty");
    expect(transport.execArgvLines().filter((line) => line.includes("uiautomator dump /sdcard"))).toHaveLength(2);
  });

  it("fails with no hierarchy root once every route is exhausted", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wc -c", { stdout: "512\n" });
    transport.respondTo("cat /sdcard/Download/droidctl-ui.xml", { stdout: "ERROR: could not get idle state." });
    transport.respondTo("uiautomator dump /dev/tty", { stdout: "ERROR: could not get idle state." });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.ui_hierarchy", { targetId: TARGET, attempts: 1 }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/no <hierarchy root after 1 attempts/);
  });

  it("times out rather than hanging when the dump file never settles", async () => {
    const transport = new FakeTransport();
    let size = 100;
    transport.respond((argv) => (argv.join(" ").includes("wc -c") ? { stdout: `${(size += 10)}\n` } : undefined));
    transport.respondTo("uiautomator dump /dev/tty", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.ui_hierarchy",
      { targetId: TARGET, attempts: 1, settleTimeoutMs: 250 },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/Timed out waiting for a stable UI hierarchy dump/);
  });

  it("parses node counts and screen bounds out of a hierarchy", () => {
    expect(countNodes(HIERARCHY_XML)).toBe(4);
    expect(screenFromHierarchy(HIERARCHY_XML)).toEqual({ width: 1080, height: 2280 });
    expect(screenFromHierarchy("<hierarchy/>")).toBeNull();
  });
});

describe("droid_capture recording", () => {
  it("starts detached, then stops, pulls the MP4 and deletes it from the device", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const started = await invoke(
      "droid_capture.start_recording",
      { targetId: TARGET, name: "walk", timeLimitSec: 30 },
      ctx,
    );
    expect(started.data).toMatchObject({ timeLimitSec: 30, devicePath: "/sdcard/droidctl-walk.mp4" });
    expect(transport.spawned[0]?.argv.join(" ")).toBe(
      "screenrecord --bit-rate 6000000 --time-limit 30 /sdcard/droidctl-walk.mp4",
    );

    transport.pullPayloads.set("/sdcard/droidctl-walk.mp4", mp4());
    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );

    expect(stopped.data).toMatchObject({ stopped: true, pulled: true, bytes: 4096 });
    expect(transport.spawned[0]?.stopSignals).toEqual(["SIGINT"]);
    expect((await stat(stopped.data.localPath)).size).toBe(4096);
    expect(transport.execArgvLines()).toContain("rm -f /sdcard/droidctl-walk.mp4");
  });

  it("reports a missing file at stop time as a failed pull, not as an exception", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "gone" }, ctx);
    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );

    expect(stopped.ok).toBe(true);
    expect(stopped.data).toMatchObject({ stopped: true, pulled: false });
    expect(stopped.data.reason).toMatch(/Nothing to pull/);
  });

  it("rejects a pulled file with no MP4 ftyp box", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const started = await invoke("droid_capture.start_recording", { targetId: TARGET, name: "empty" }, ctx);
    transport.pullPayloads.set("/sdcard/droidctl-empty.mp4", Buffer.alloc(64));
    const stopped = await invoke(
      "droid_capture.stop_recording",
      { targetId: TARGET, recordingId: started.data.recordingId },
      ctx,
    );

    expect(stopped.ok).toBe(false);
    expect(stopped.error.message).toMatch(/no MP4 ftyp box/);
  });

  it("refuses an unknown recordingId and one belonging to another target", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const unknown = await invoke("droid_capture.stop_recording", { targetId: TARGET, recordingId: "rec-9999" }, ctx);
    expect(unknown.ok).toBe(false);
    expect(unknown.error.message).toMatch(/Unknown recordingId/);
  });
});

describe("droid_capture.logcat", () => {
  it("clears the buffer", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.logcat", { targetId: TARGET, mode: "clear" }, ctx);
    expect(result.data.cleared).toBe(true);
    expect(transport.execArgvLines()).toEqual(["logcat -c"]);
  });

  it("resolves a package pid, applies filters server-side and writes the whole log", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "4242\n" });
    transport.respondTo("logcat -d", {
      stdout: ["10-01 E AndroidRuntime: FATAL EXCEPTION", "10-01 I chromium: fine", "10-01 I other: noise"].join("\n"),
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.logcat",
      {
        targetId: TARGET,
        mode: "dump",
        name: "crash",
        lines: 200,
        format: "threadtime",
        package: "uk.gleissner.c64commander",
        tags: ["StreamUdpPlugin"],
        filters: ["AndroidRuntime|FATAL", "chromium"],
      },
      ctx,
    );

    expect(result.data).toMatchObject({ lineCount: 3, matchedCount: 2, pid: "4242" });
    expect(transport.execArgvLines()).toContain("logcat -d -t 200 -v threadtime --pid 4242 -s StreamUdpPlugin:I");
    expect(await readFile(result.data.logPath, "utf8")).toContain("noise");
  });

  it("fails a capture with no runtime content when that is required", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pidof", { stdout: "" });
    transport.respondTo("logcat -d", { stdout: "10-01 I unrelated: nothing here\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_capture.logcat",
      { targetId: TARGET, mode: "dump", package: "uk.gleissner.c64commander", requireRuntimeContent: true },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/no runtime content/);
  });

  it("reports a buffer that exceeded the cap instead of returning a partial log", async () => {
    const transport = new FakeTransport();
    transport.respond((argv) => (argv.join(" ").startsWith("logcat -d") ? { stdout: "x".repeat(200) } : undefined));
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.logcat", { targetId: TARGET, mode: "dump", maxBytes: 10 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/exceeded the 10 byte cap/);
  });

  it("reports a failing logcat call", async () => {
    const transport = new FakeTransport();
    transport.respondTo("logcat -c", { exitCode: 1, stderr: "device offline" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.logcat", { targetId: TARGET, mode: "clear" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/logcat -c failed/);
  });
});
