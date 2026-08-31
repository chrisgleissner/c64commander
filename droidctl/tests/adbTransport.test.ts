/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * These exercise the adb backend without running adb: the raw runner is injected,
 * so every assertion is about the argument vector the code builds.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AdbTransport,
  type RawExecOutcome,
  type RawExecRequest,
  type RawSpawnHandle,
  parseAdbDevices,
} from "../src/transport/adb.js";
import type { CommandRecord, ResolvedTarget } from "../src/transport/types.js";

const TARGET: ResolvedTarget = { targetId: "adb:9B0EXAMPLE", transport: "adb", serial: "9B0EXAMPLE" };

interface Recorder {
  readonly requests: RawExecRequest[];
  readonly commands: CommandRecord[];
  transport: AdbTransport;
}

function recordingTransport(reply: (request: RawExecRequest) => RawExecOutcome): Recorder {
  const requests: RawExecRequest[] = [];
  const commands: CommandRecord[] = [];
  const transport = new AdbTransport({
    exec: async (request) => {
      requests.push(request);
      return reply(request);
    },
    onCommand: (record) => commands.push(record),
  });
  return { requests, commands, transport };
}

const ok = (stdout = ""): RawExecOutcome => ({ stdout: Buffer.from(stdout), stderr: "", exitCode: 0 });

describe("adb devices parsing", () => {
  it("reads serial, state, model and the emulator flag", () => {
    const targets = parseAdbDevices(
      [
        "List of devices attached",
        "9B081FFAZ001WX         device product:flame model:Pixel_4 device:flame transport_id:1",
        "emulator-5554          offline",
        "127.0.0.1:5555         unauthorized",
        "",
      ].join("\n"),
    );

    expect(targets).toEqual([
      {
        targetId: "adb:9B081FFAZ001WX",
        transport: "adb",
        serial: "9B081FFAZ001WX",
        model: "Pixel_4",
        apiLevel: null,
        state: "device",
        isEmulator: false,
      },
      expect.objectContaining({ targetId: "adb:emulator-5554", isEmulator: true, state: "offline" }),
      expect.objectContaining({ targetId: "adb:127.0.0.1:5555", state: "unauthorized" }),
    ]);
  });

  it("maps bootloader and unrecognised states", () => {
    const targets = parseAdbDevices("abc bootloader\ndef somethingnew\n* daemon starting *\n");
    expect(targets.map((target) => target.state)).toEqual(["booting", "unknown"]);
  });
});

describe("every targeted invocation carries -s", () => {
  it("puts -s <serial> first for shell, exec-out, install, push and forward", async () => {
    const recorder = recordingTransport(() => ok("Success\n"));
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-adb-"));
    const localPath = path.join(dir, "file.bin");
    await writeFile(localPath, Buffer.alloc(4));

    await recorder.transport.exec(TARGET, ["input", "tap", "1", "2"]);
    await recorder.transport.exec(TARGET, ["screencap", "-p"], { encoding: "buffer" });
    await recorder.transport.installPackage(TARGET, "/tmp/app.apk", { allowDowngrade: true, grantPermissions: true });
    await recorder.transport.pushFile(TARGET, localPath, "/sdcard/file.bin");
    await recorder.transport.forwardPort(TARGET, 9222, "localabstract:webview_devtools_remote_1");
    await recorder.transport.removeForward(TARGET, 9222);

    for (const request of recorder.requests) {
      expect(request.args.slice(0, 2)).toEqual(["-s", "9B0EXAMPLE"]);
    }
    expect(recorder.requests.map((request) => request.args.slice(2).join(" "))).toEqual([
      "shell input tap 1 2",
      "exec-out screencap -p",
      "install -r -d -g /tmp/app.apk",
      "push " + localPath + " /sdcard/file.bin",
      "forward tcp:9222 localabstract:webview_devtools_remote_1",
      "forward --remove tcp:9222",
    ]);
  });

  it("runs enumeration without a serial, since that is what issues them", async () => {
    const recorder = recordingTransport(() => ok("List of devices attached\nabc device\n"));
    await recorder.transport.listTargets();
    expect(recorder.requests[0]?.args).toEqual(["devices", "-l"]);
  });

  it("selects exec-out for a binary read so a PNG is not newline-translated", async () => {
    const recorder = recordingTransport(() => ok("payload"));
    await recorder.transport.pullBinary(TARGET, "/sdcard/x.png");
    expect(recorder.requests[0]?.args).toEqual(["-s", "9B0EXAMPLE", "exec-out", "cat", "/sdcard/x.png"]);
  });
});

describe("adb transport results", () => {
  it("caps stdout at maxBytes and reports the truncation", async () => {
    const recorder = recordingTransport(() => ok("x".repeat(100)));
    const result = await recorder.transport.exec(TARGET, ["logcat", "-d"], { maxBytes: 10 });
    expect(result.stdout).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("throws on a non-zero exit only when asked to", async () => {
    const recorder = recordingTransport(() => ({ stdout: Buffer.alloc(0), stderr: "nope", exitCode: 7 }));
    const tolerated = await recorder.transport.exec(TARGET, ["false"]);
    expect(tolerated.exitCode).toBe(7);
    await expect(recorder.transport.exec(TARGET, ["false"], { throwOnNonZeroExit: true })).rejects.toThrow(
      /Command failed on adb:9B0EXAMPLE/,
    );
  });

  it("classifies a runner timeout as the timeout error code", async () => {
    const transport = new AdbTransport({
      exec: async () => {
        throw new Error("spawnSync adb ETIMEDOUT");
      },
    });
    await expect(transport.exec(TARGET, ["shell"])).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports a failing adb devices instead of returning an empty list", async () => {
    const recorder = recordingTransport(() => ({ stdout: Buffer.alloc(0), stderr: "no server", exitCode: 1 }));
    await expect(recorder.transport.listTargets()).rejects.toThrow(/adb devices failed/);
  });

  it("reports a failing push, forward and read", async () => {
    const recorder = recordingTransport(() => ({ stdout: Buffer.alloc(0), stderr: "denied", exitCode: 1 }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-adb-fail-"));
    const localPath = path.join(dir, "f");
    await writeFile(localPath, "x");
    await expect(recorder.transport.pushFile(TARGET, localPath, "/sdcard/f")).rejects.toThrow(/adb push failed/);
    await expect(recorder.transport.forwardPort(TARGET, 1, "localabstract:x")).rejects.toThrow(/adb forward failed/);
    await expect(recorder.transport.pullBinary(TARGET, "/sdcard/x")).rejects.toThrow(/Unable to read/);
  });

  it("writes a pulled payload to a local file", async () => {
    const recorder = recordingTransport(() => ok("body"));
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-adb-pull-"));
    const localPath = path.join(dir, "out.bin");
    expect(await recorder.transport.pullFile(TARGET, "/sdcard/out.bin", localPath)).toBe(4);
    expect(await readFile(localPath, "utf8")).toBe("body");
  });

  it("reports the byte count adb printed on a push", async () => {
    const recorder = recordingTransport(() => ok("/sdcard/f: 1 file pushed. 4096 bytes in 0.010s."));
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-adb-push-"));
    const localPath = path.join(dir, "f");
    await writeFile(localPath, "x");
    expect(await recorder.transport.pushFile(TARGET, localPath, "/sdcard/f")).toBe(4096);
  });
});

describe("the command journal", () => {
  it("records argv, exit code, duration and target id for every invocation", async () => {
    const recorder = recordingTransport(() => ok("out"));
    await recorder.transport.exec(TARGET, ["getprop"]);
    await recorder.transport.listTargets().catch(() => undefined);

    expect(recorder.commands[0]).toMatchObject({
      targetId: "adb:9B0EXAMPLE",
      transport: "adb",
      argv: ["adb", "-s", "9B0EXAMPLE", "shell", "getprop"],
      exitCode: 0,
      bytesOut: 3,
    });
    expect(recorder.commands[1]?.targetId).toBeNull();
  });

  it("records a failed invocation with a null exit code", async () => {
    const commands: CommandRecord[] = [];
    const transport = new AdbTransport({
      exec: async () => {
        throw new Error("ENOENT");
      },
      onCommand: (record) => commands.push(record),
    });
    await expect(transport.exec(TARGET, ["getprop"])).rejects.toThrow();
    expect(commands[0]).toMatchObject({ exitCode: null, targetId: "adb:9B0EXAMPLE" });
  });
});

describe("detached screenrecord", () => {
  it("spawns adb shell with the serial and stops the local child with the given signal", async () => {
    const spawnCalls: string[][] = [];
    let stderrListener: ((chunk: string) => void) | null = null;
    let closeListener: ((code: number | null) => void) | null = null;
    const signals: NodeJS.Signals[] = [];

    const handle: RawSpawnHandle = {
      kill(signal) {
        signals.push(signal);
        closeListener?.(0);
      },
      onClose(listener) {
        closeListener = listener;
      },
      onStderr(listener) {
        stderrListener = listener;
      },
      killed: false,
    };

    const transport = new AdbTransport({
      spawn: (request) => {
        spawnCalls.push([...request.args]);
        return handle;
      },
    });

    const detached = transport.spawnShell(TARGET, ["screenrecord", "--time-limit", "10", "/sdcard/x.mp4"]);
    stderrListener?.("warning: something\n");
    const stopped = await detached.stop("SIGINT");

    expect(spawnCalls[0]?.slice(0, 3)).toEqual(["-s", "9B0EXAMPLE", "shell"]);
    expect(signals).toEqual(["SIGINT"]);
    expect(stopped.stderr).toBe("warning: something\n");
  });
});
