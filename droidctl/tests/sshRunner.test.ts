/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import type { RawExecRequest } from "../src/transport/adb.js";
import type { SshEndpoint } from "../src/transport/sshCommands.js";
import { MAX_CONTROL_DIR_LENGTH, SshCommandRunner } from "../src/transport/sshRunner.js";
import type { CommandRecord } from "../src/transport/types.js";
import { FakeSshSystem, ReplayingHandle } from "./support/sshFakes.js";

const PHONE: SshEndpoint = { host: "192.168.2.15", port: 22, user: "defaultuser", identityFile: null };

function runner(
  exec: (request: RawExecRequest) => Promise<{ stdout: Buffer; stderr: string; exitCode: number; timedOut?: boolean }>,
  options: { controlDir?: string | null; privateDirOk?: boolean } = {},
) {
  const system = new FakeSshSystem();
  system.privateDirOk = options.privateDirOk ?? true;
  const commands: CommandRecord[] = [];
  const requests: RawExecRequest[] = [];
  const spawned: { file: string; args: readonly string[] }[] = [];
  const instance = new SshCommandRunner({
    sshPath: "/usr/bin/ssh",
    exec: async (request) => {
      requests.push(request);
      return exec(request);
    },
    spawn: (request) => {
      spawned.push(request);
      return new ReplayingHandle();
    },
    system,
    controlDir: options.controlDir === undefined ? "/tmp/droidctl-ssh" : options.controlDir,
    onCommand: (record) => commands.push(record),
  });
  return { instance, commands, requests, spawned };
}

describe("the ssh command runner", () => {
  it("runs through the multiplexing socket and journals the invocation", async () => {
    const { instance, commands, requests } = runner(async () => ({
      stdout: Buffer.from("out"),
      stderr: "",
      exitCode: 0,
    }));

    const outcome = await instance.run("ssh:t", PHONE, "sh -c true", { timeoutMs: 1_000, stdin: Buffer.from("in") });

    expect(outcome).toMatchObject({ kind: "ran", exitCode: 0, timedOut: false });
    expect(requests[0]).toMatchObject({ file: "/usr/bin/ssh", timeoutMs: 1_000, stdin: Buffer.from("in") });
    expect(requests[0]!.args).toContain("ControlPath=/tmp/droidctl-ssh/%C");
    expect(requests[0]!.maxBytes).toBe(32 * 1024 * 1024);
    expect(commands[0]).toMatchObject({ targetId: "ssh:t", transport: "ssh", exitCode: 0, bytesOut: 3 });
    expect(commands[0]!.argv[0]).toBe("/usr/bin/ssh");
  });

  it("reports a binary that cannot start as spawn-failed and journals a null exit code", async () => {
    const { instance, commands } = runner(async () => {
      throw new Error("spawn /usr/bin/ssh ENOENT");
    });
    expect(await instance.run(null, PHONE, "true", { timeoutMs: 1 })).toMatchObject({
      kind: "spawn-failed",
      message: "spawn /usr/bin/ssh ENOENT",
    });
    expect(commands[0]).toMatchObject({ exitCode: null, targetId: null });

    const odd = runner(async () => {
      throw "not an error object";
    });
    expect(await odd.instance.run(null, PHONE, "true", { timeoutMs: 1 })).toMatchObject({
      message: "not an error object",
    });
  });

  it("turns multiplexing off for a directory that is too long or not private", async () => {
    const ok = async () => ({ stdout: Buffer.alloc(0), stderr: "", exitCode: 0 });
    expect(runner(ok, { controlDir: "/x".repeat(MAX_CONTROL_DIR_LENGTH) }).instance.controlPath()).toBeNull();
    expect(runner(ok, { privateDirOk: false }).instance.controlPath()).toBeNull();
    expect(runner(ok, { controlDir: null }).instance.controlPath()).toBeNull();
    const disabled = runner(ok, { controlDir: null });
    expect(await disabled.instance.masterPid(null, PHONE)).toBeNull();
    expect(disabled.requests).toEqual([]);
  });

  it("reads the master pid, and treats a missing master or a failing check as none", async () => {
    const running = runner(async () => ({
      stdout: Buffer.alloc(0),
      stderr: "Master running (pid=77)\r\n",
      exitCode: 0,
    }));
    expect(await running.instance.masterPid("ssh:t", PHONE)).toBe(77);
    expect(running.requests[0]!.args).toEqual(expect.arrayContaining(["-O", "check"]));

    const stopped = runner(async () => ({ stdout: Buffer.alloc(0), stderr: "No such file", exitCode: 255 }));
    expect(await stopped.instance.masterPid(null, PHONE)).toBeNull();

    const broken = runner(async () => {
      throw new Error("ENOENT");
    });
    expect(await broken.instance.masterPid(null, PHONE)).toBeNull();
  });

  it("spawns a tunnel as its own process and journals it", () => {
    const { instance, spawned, commands } = runner(async () => ({ stdout: Buffer.alloc(0), stderr: "", exitCode: 0 }));
    const { argv } = instance.spawnForward("ssh:t", PHONE, 40_000, { host: "127.0.0.1", port: 5555 });
    expect(spawned[0]!.args).toEqual(argv.slice(1));
    expect(argv).toContain("127.0.0.1:40000:127.0.0.1:5555");
    expect(commands[0]).toMatchObject({ exitCode: null, argv });
  });
});
