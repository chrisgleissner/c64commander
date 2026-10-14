/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * An ssh tunnel into a phone's Android container must neither keep the process
 * that opened it running nor outlive it. These tests cover both halves: the
 * spawned tunnel does not hold the event loop, and the exit listener ends every
 * tunnel that is still open.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeSpawnRunner, type RawSpawnHandle } from "../src/transport/adb.js";
import type { Tunnel } from "../src/transport/sshProbe.js";
import { TunnelReaper, nodeTunnelReaperDeps, processTunnelReaper } from "../src/transport/tunnelReaper.js";
import { ReplayingHandle, usbPhone } from "./support/sshFakes.js";

const ADB_PHONE = { listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "device" as const } };
const DROIDCTL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIT_FIXTURE = path.join(DROIDCTL_ROOT, "tests", "fixtures", "tunnelExitChild.ts");

function heldResources(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "ProcessWrap" || name === "PipeWrap").length;
}

function tunnel(serial: string, handle: RawSpawnHandle, closed = false): Tunnel {
  return { localPort: 40_000, serial, endpoint: "127.0.0.1:5555", handle, argv: ["ssh", "-N"], closed, stderr: "" };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

describe("a tunnel process and the event loop", () => {
  it("does not hold the event loop when the spawn asks to be detached, and does otherwise", async () => {
    const baseline = heldResources();
    const script = ["-e", "setInterval(() => {}, 1e9)"];

    const detached = nodeSpawnRunner({ file: process.execPath, args: script, detachFromEventLoop: true });
    const heldWhileDetached = heldResources();
    const attached = nodeSpawnRunner({ file: process.execPath, args: script });
    const heldWithBoth = heldResources();

    const closed = Promise.all([detached, attached].map((handle) => new Promise((resolve) => handle.onClose(resolve))));
    detached.kill("SIGTERM");
    attached.kill("SIGTERM");
    await closed;

    expect(heldWhileDetached).toBe(baseline);
    expect(heldWithBoth).toBe(baseline + 3);
  });
});

describe("the tunnel reaper", () => {
  it("registers one exit listener for every tunnel the process opens", async () => {
    const phone = usbPhone(ADB_PHONE);
    await phone.transport().listTargets();
    await phone.transport().listTargets();

    expect(phone.tunnels.size).toBe(2);
    expect(phone.reaper.liveCount()).toBe(2);
    expect(phone.exitListeners).toHaveLength(1);
  });

  it("stops each live tunnel and disconnects it from the adb server when the process exits", async () => {
    const phone = usbPhone(ADB_PHONE);
    await phone.transport().listTargets();

    phone.exitListeners[0]!();

    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual(["SIGTERM"]);
    expect(phone.exitCommands).toEqual([["adb", "disconnect", "127.0.0.1:40000"]]);
    expect(phone.reaper.liveCount()).toBe(0);
  });

  it("skips a tunnel that was closed normally before the process exits", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.dispose();
    const signalsAfterDispose = [...phone.tunnels.get(40_000)!.handle.signals];

    phone.exitListeners[0]!();

    expect(phone.reaper.liveCount()).toBe(0);
    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual(signalsAfterDispose);
    expect(phone.exitCommands).toEqual([]);
  });

  it("forgets a tunnel that failed to open, because opening already closed it", async () => {
    const phone = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "refused" } });
    await phone.transport().listTargets();

    expect(phone.tunnels.size).toBe(1);
    expect(phone.reaper.liveCount()).toBe(0);
  });

  it("does not signal a tunnel whose ssh process already ended, but still disconnects its serial", async () => {
    const phone = usbPhone(ADB_PHONE);
    await phone.transport().listTargets();
    phone.tunnels.get(40_000)!.handle.close(255);

    phone.exitListeners[0]!();

    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual([]);
    expect(phone.exitCommands).toEqual([["adb", "disconnect", "127.0.0.1:40000"]]);
  });

  it("logs a failed stop or disconnect with its serial and carries on with the next tunnel", () => {
    const warnings: { message: string; details: Record<string, unknown> }[] = [];
    const ran: (readonly string[])[] = [];
    const reaper = new TunnelReaper({
      runSync: (argv) => {
        ran.push(argv);
        if (argv.includes("127.0.0.1:40001")) {
          throw "adb is gone";
        }
      },
      onProcessExit: () => undefined,
      warn: (message, details) => warnings.push({ message, details }),
    });
    const stubborn = new ReplayingHandle();
    stubborn.kill = () => {
      throw new Error("kill refused");
    };
    const bare = new ReplayingHandle();
    bare.kill = () => {
      throw Object.assign(new Error("no stack"), { stack: undefined });
    };
    const healthy = new ReplayingHandle();
    reaper.track(tunnel("127.0.0.1:40000", stubborn), ["adb", "disconnect", "127.0.0.1:40000"]);
    reaper.track(tunnel("127.0.0.1:40001", bare), ["adb", "disconnect", "127.0.0.1:40001"]);
    reaper.track(tunnel("127.0.0.1:40002", healthy), ["adb", "disconnect", "127.0.0.1:40002"]);

    reaper.reap();

    expect(ran.map((argv) => argv[2])).toEqual(["127.0.0.1:40000", "127.0.0.1:40001", "127.0.0.1:40002"]);
    expect(healthy.signals).toEqual(["SIGTERM"]);
    expect(warnings.map(({ message, details }) => [message, details["serial"], details["error"]])).toEqual([
      ["Could not stop an ssh tunnel at process exit", "127.0.0.1:40000", expect.stringContaining("kill refused")],
      ["Could not stop an ssh tunnel at process exit", "127.0.0.1:40001", "no stack"],
      ["Could not disconnect an ssh tunnel from the adb server at process exit", "127.0.0.1:40001", "adb is gone"],
    ]);
  });
});

describe("the process-wide tunnel reaper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a reaper of its own, shared by every transport that is given none", () => {
    expect(processTunnelReaper).toBeInstanceOf(TunnelReaper);
    expect(processTunnelReaper.liveCount()).toBe(0);
  });

  it("runs a command to completion and throws when it cannot be started", () => {
    expect(() => nodeTunnelReaperDeps.runSync([process.execPath, "-e", ""])).not.toThrow();
    expect(() =>
      nodeTunnelReaperDeps.runSync([path.join(os.tmpdir(), "droidctl-no-such-adb"), "disconnect"]),
    ).toThrow();
  });

  it("listens for the process exit event", () => {
    const listener = () => undefined;
    nodeTunnelReaperDeps.onProcessExit(listener);
    try {
      expect(process.listeners("exit")).toContain(listener);
    } finally {
      process.removeListener("exit", listener);
    }
  });

  it("writes its warnings to the droidctl log", () => {
    const written = vi.spyOn(console, "error").mockImplementation(() => undefined);
    nodeTunnelReaperDeps.warn("tunnel trouble", { serial: "127.0.0.1:40000" });
    expect(written).toHaveBeenCalledWith('[droidctl] tunnel trouble {"serial":"127.0.0.1:40000"}');
  });
});

describe("a process that opened a tunnel", () => {
  it("exits on its own once its work is done, and its tunnel process ends with it", async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "droidctl-tunnel-exit-"));
    const pidFile = path.join(workDir, "tunnel.pid");
    const child = spawn(process.execPath, ["--import", "tsx", EXIT_FIXTURE, workDir], {
      cwd: DROIDCTL_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let readyAt: number | null = null;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (readyAt === null && output.includes("ready")) {
        readyAt = Date.now();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    let exitCode: number | null | undefined;
    let exitedAt = 0;
    void exited.then((code) => {
      exitCode = code;
      exitedAt = Date.now();
    });

    try {
      const exitedInTime = await waitFor(() => exitCode !== undefined, 20_000);
      expect(exitedInTime, `the process did not exit; output:\n${output}`).toBe(true);
      expect(exitCode, output).toBe(0);
      expect(readyAt, output).not.toBeNull();
      expect(exitedAt - readyAt!).toBeLessThan(5_000);

      const tunnelPid = Number(readFileSync(pidFile, "utf8"));
      expect(await waitFor(() => !isAlive(tunnelPid), 3_000), `tunnel process ${tunnelPid} survived`).toBe(true);
      expect(readFileSync(path.join(workDir, "exit.log"), "utf8")).toBe("adb disconnect 127.0.0.1:40000\n");
    } finally {
      if (exitCode === undefined) {
        child.kill("SIGKILL");
        await exited;
      }
      if (existsSync(pidFile)) {
        const tunnelPid = Number(readFileSync(pidFile, "utf8"));
        if (isAlive(tunnelPid)) {
          process.kill(tunnelPid, "SIGKILL");
        }
      }
      await rm(workDir, { recursive: true, force: true });
    }
  }, 30_000);
});
