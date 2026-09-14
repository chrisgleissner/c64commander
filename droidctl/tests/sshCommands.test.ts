/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The command builders, and the scripts they produce run through a real local
 * shell with stand-ins for the phone's commands, so quoting is checked by a shell
 * rather than by reading strings.
 */

import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CONTAINER_ENVIRONMENT,
  CONTAINER_FACTS_ARGV,
  LOGIN_PROBE_SCRIPT,
  STDIN_PROBE,
  type SshEndpoint,
  attachProbeScript,
  containerCommand,
  hostShellCommand,
  parseAttachResults,
  parseContainerFacts,
  parseKeyValueLines,
  parseLoginFacts,
  parseMasterPid,
  parseProcNetListener,
  sshControlCheckArgs,
  sshDestination,
  sshForwardArgs,
  sshRunArgs,
  sshSerial,
} from "../src/transport/sshCommands.js";
import { parseShellWords } from "./support/sshFakes.js";

const run = promisify(execFile);
const PHONE: SshEndpoint = { host: "192.168.2.15", port: 22, user: "defaultuser", identityFile: null };

async function stubDirectory(stubs: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-stubs-"));
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(dir, name);
    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o755);
  }
  return dir;
}

describe("ssh argument builders", () => {
  it("puts the options first, -- before the destination, and the remote command last", () => {
    expect(sshRunArgs(PHONE, "/tmp/droidctl-ssh/%C", "sh -c true", false)).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ServerAliveInterval=5",
      "-o",
      "ServerAliveCountMax=2",
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPath=/tmp/droidctl-ssh/%C",
      "-o",
      "ControlPersist=300",
      "-p",
      "22",
      "-T",
      "-n",
      "--",
      "defaultuser@192.168.2.15",
      "sh -c true",
    ]);
  });

  it("forwards stdin only when there is some, pins an identity, and can run without multiplexing", () => {
    const keyed = { ...PHONE, port: 2222, identityFile: "/home/me/.ssh/phone" };
    const args = sshRunArgs(keyed, null, "cat", true);
    expect(args).not.toContain("-n");
    expect(args).toEqual(
      expect.arrayContaining([
        "ControlMaster=no",
        "ControlPath=none",
        "-i",
        "/home/me/.ssh/phone",
        "IdentitiesOnly=yes",
      ]),
    );
    expect(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2)).toEqual(["-p", "2222"]);
    expect(() => sshRunArgs(PHONE, null, "   ", false)).toThrow(/non-empty remote command/);
  });

  it("builds a dedicated tunnel process bound to loopback, and a master check", () => {
    const forward = sshForwardArgs(PHONE, 40123, { host: "127.0.0.1", port: 5555 });
    expect(forward.slice(-8)).toEqual([
      "22",
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      "127.0.0.1:40123:127.0.0.1:5555",
      "--",
      "defaultuser@192.168.2.15",
    ]);
    expect(forward).toContain("ControlPath=none");
    expect(sshControlCheckArgs(PHONE, "/tmp/c/%C")).toEqual([
      "-o",
      "ControlPath=/tmp/c/%C",
      "-O",
      "check",
      "-p",
      "22",
      "--",
      "defaultuser@192.168.2.15",
    ]);
    expect(parseMasterPid("Master running (pid=4242)\r\n")).toBe(4242);
    expect(parseMasterPid("Control socket connect: No such file")).toBeNull();
  });

  it("lists a target by user@host, adding the port only when it is not 22", () => {
    expect(sshDestination(PHONE)).toBe("defaultuser@192.168.2.15");
    expect(sshSerial(PHONE)).toBe("defaultuser@192.168.2.15");
    expect(sshSerial({ ...PHONE, port: 2222 })).toBe("defaultuser@192.168.2.15:2222");
  });
});

describe("container command quoting, checked by a real shell", () => {
  it("delivers an argument vector with spaces, quotes and metacharacters through both shells intact", async () => {
    // The attach stand-in drops the container shell path and runs the rest with the local sh.
    const argv = ["sh", "-c", `printf '%s|' "$@"`, "argv0", "two words", "it's", "$HOME;rm -rf /", ""];
    const line = containerCommand([], ["sh", "-c", 'shift; exec sh "$@"', "attach"], argv);

    const { stdout } = await run("sh", ["-c", line]);

    expect(stdout).toBe("two words|it's|$HOME;rm -rf /||");
    const androidLine = parseShellWords(line).at(-1)!;
    expect(androidLine.startsWith(`${CONTAINER_ENVIRONMENT} `)).toBe(true);
    expect(parseShellWords(androidLine.slice(CONTAINER_ENVIRONMENT.length + 1))).toEqual(argv);
  });

  it("fills Android's boot environment from init.environ.rc without overriding what the session has", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-environ-"));
    const environ = path.join(dir, "init.environ.rc");
    await writeFile(
      environ,
      [
        "on early-init",
        "    export ANDROID_DATA /data",
        "    export BOOTCLASSPATH /apex/a.jar:/apex/b.jar",
        "    export KEPT /from/file",
        "",
      ].join("\n"),
    );
    const argv = ["sh", "-c", 'echo "$ANDROID_DATA|$BOOTCLASSPATH|$KEPT"'];
    const line = containerCommand([], ["sh", "-c", 'shift; exec sh "$@"', "attach"], argv).replace(
      "/init.environ.rc /system/etc/init/hw/init.environ.rc",
      `${path.join(dir, "missing.rc")} ${environ}`,
    );

    const { stdout } = await run("sh", ["-c", line], { env: { PATH: "/usr/bin:/bin", KEPT: "from-session" } });

    expect(stdout).toBe("/data|/apex/a.jar:/apex/b.jar|from-session\n");
  });

  it("puts the root prefix and attach command ahead of the container shell", () => {
    const words = parseShellWords(containerCommand(["sudo", "-n"], ["lxc-attach", "-n", "android", "--"], ["id"]));
    expect(words).toEqual([
      "sudo",
      "-n",
      "lxc-attach",
      "-n",
      "android",
      "--",
      "/system/bin/sh",
      "-c",
      `${CONTAINER_ENVIRONMENT} id`,
    ]);
    expect(() => containerCommand([], ["x"], [])).toThrow(/non-empty argument vector/);
  });

  it("runs a host script under a prefix as one quoted command line", async () => {
    const line = hostShellCommand("echo \"$0 'quoted'\"", ["env", "LC_ALL=C"]);
    const { stdout } = await run("sh", ["-c", line]);
    expect(stdout).toBe("sh 'quoted'\n");
  });
});

describe("the host probe script", () => {
  it("is valid sh and reports the facts the transport reads, with sudo and the helpers stubbed", async () => {
    const stubs = await stubDirectory({ sudo: "exit 1" });
    const { stdout } = await run("sh", ["-c", LOGIN_PROBE_SCRIPT], {
      env: { PATH: `${stubs}:/usr/bin:/bin`, HOME: "/home/probe" },
    });
    const facts = parseLoginFacts(stdout);

    expect(stdout).toMatch(/^uid=\d+\nhome=\/home\/probe\nsudo=0\n/);
    expect(facts.uid).toBe(os.userInfo().uid);
    expect(facts.home).toBe("/home/probe");
    expect(facts.sudo).toBe(false);
    expect(
      stdout
        .split("\n")
        .filter((line) => line.length > 0 && !/^(uid|home|sudo|android|listen|helper|lxc|os)=/.test(line)),
    ).toEqual([]);
  });

  it("reads uid, sudo, the container, listeners, helpers and LXC from probe output", () => {
    const facts = parseLoginFacts(
      [
        "uid=0",
        "home=/root",
        "sudo=1",
        "android=running",
        "listen=00000000:15B3",
        "listen=0100007F:15B3",
        "listen=017AA8C0:0035",
        "listen=00000000000000000000000000000000:15B3",
        "listen=00000000000000000000000001000000:1F90",
        "listen=20010DB8000000000000000000000001:15B3",
        "listen=garbage",
        "helper=/usr/bin/container-attach",
        "helper=/usr/bin/container-attach",
        "helper=/usr/bin/lxc-attach",
        "lxc=1",
        "os=Some Linux 5",
        "not a key value line",
      ].join("\n"),
    );
    expect(facts).toEqual({
      uid: 0,
      home: "/root",
      sudo: true,
      android: "running",
      listeners: [
        { address: "0.0.0.0", port: 5555, local: true },
        { address: "127.0.0.1", port: 5555, local: true },
        { address: "192.168.122.1", port: 53, local: false },
        { address: "127.0.0.1", port: 5555, local: true },
        { address: "127.0.0.1", port: 8080, local: true },
      ],
      attachHelpers: ["/usr/bin/container-attach"],
      lxc: true,
      hostOs: "Some Linux 5",
    });
    expect(parseLoginFacts("uid=abc\nhome=\n")).toMatchObject({ uid: null, home: null, sudo: false, hostOs: null });
    expect(parseProcNetListener("0100007F:zz")).toBeNull();
  });

  it("groups repeated keys and keeps text after the first equals sign", () => {
    expect(parseKeyValueLines("a=1\na=2=3\n=skipped\n")).toEqual(new Map([["a", ["1", "2=3"]]]));
  });
});

describe("the attach probe script", () => {
  it("counts a candidate by the SDK level it prints, and finds running LXC containers", async () => {
    const stubs = await stubDirectory({
      "good-attach": 'if [ "$1" = --flag ] && [ "$2" = /system/bin/getprop ]; then echo 33; fi',
      "bad-attach": "echo 'container is not running' >&2; exit 1",
      "lxc-ls": 'if [ "$1" = -1 ] && [ "$2" = --running ]; then echo android; fi',
      "lxc-attach": [
        'if [ "$1 $2 $3 $4" = "-n android -- /system/bin/getprop" ]; then echo 30; exit 0; fi',
        'if [ "$1 $2 $3 $4 $5 $6" = "-P /srv/lxc-custom -n user1 -- /system/bin/getprop" ]; then echo 33; exit 0; fi',
        "exit 9",
      ].join("\n"),
    });
    // A stand-in process table: one LXC monitor, titled the way LXC titles it, and one unrelated process.
    const proc = await mkdtemp(path.join(os.tmpdir(), "droidctl-proc-"));
    await mkdir(path.join(proc, "101"));
    await mkdir(path.join(proc, "202"));
    await writeFile(path.join(proc, "101", "cmdline"), "[lxc monitor] /srv/lxc-custom user1\0\0\0");
    await writeFile(path.join(proc, "202", "cmdline"), "sshd\0-D\0");
    const candidates = [
      { id: "helper:bad", argv: [path.join(stubs, "bad-attach")] },
      { id: "configured", argv: [path.join(stubs, "good-attach"), "--flag"] },
    ];

    const script = attachProbeScript(candidates, true).replace("/proc/[0-9]*/cmdline", `${proc}/[0-9]*/cmdline`);
    const { stdout } = await run("sh", ["-c", script], {
      env: { PATH: `${stubs}:/usr/bin:/bin` },
    });
    const results = parseAttachResults(stdout, candidates);

    expect(results.map((result) => [result.candidate.id, result.exitCode, result.firstLine])).toEqual([
      ["helper:bad", 1, "container is not running"],
      ["configured", 0, "33"],
      ["lxc:user1@/srv/lxc-custom", 0, "33"],
      ["lxc:android", 0, "30"],
    ]);
    expect(results[2]!.candidate.argv).toEqual(["lxc-attach", "-P", "/srv/lxc-custom", "-n", "user1", "--"]);
    expect(results[3]!.candidate.argv).toEqual(["lxc-attach", "-n", "android", "--"]);
    expect(attachProbeScript(candidates, false)).not.toContain("lxc-ls");
  });

  it("attaches to an LXC container found through its monitor with that container's lxcpath", () => {
    const results = parseAttachResults("candidate=lxc:user1@/var/lib/custom-lxc|0|33\n", []);
    expect(results).toEqual([
      {
        candidate: {
          id: "lxc:user1@/var/lib/custom-lxc",
          argv: ["lxc-attach", "-P", "/var/lib/custom-lxc", "-n", "user1", "--"],
        },
        exitCode: 0,
        firstLine: "33",
      },
    ]);
    const script = attachProbeScript([], true);
    expect(script).toContain('grep -ls "^\\[lxc monitor\\]" /proc/[0-9]*/cmdline');
    expect(script).toContain('check "lxc:$4@$3" lxc-attach -P "$3" -n "$4" --');
  });

  it("ignores result lines it cannot attribute", () => {
    const candidates = [{ id: "configured", argv: ["x"] }];
    expect(
      parseAttachResults("candidate=unknown|0|33\ncandidate=broken\ncandidate=configured|0|33\n", candidates),
    ).toEqual([{ candidate: candidates[0], exitCode: 0, firstLine: "33" }]);
  });
});

describe("the container facts command", () => {
  it("is valid sh and reports model, boot state, adb ports and addresses", async () => {
    const stubs = await stubDirectory({
      getprop:
        'case "$1" in ro.product.model) echo Model X;; sys.boot_completed) echo 1;; service.adb.tcp.port) echo 5555;; persist.adb.tcp.port) echo 5555;; esac',
      ip: 'echo "4: eth0    inet 10.0.3.2/24 brd 10.0.3.255 scope global eth0"',
    });
    const factsWith = (input: string) =>
      spawnSync(CONTAINER_FACTS_ARGV[0]!, CONTAINER_FACTS_ARGV.slice(1), {
        env: { PATH: `${stubs}:/usr/bin:/bin` },
        input,
        encoding: "utf8",
        timeout: 10_000,
      }).stdout;

    expect(parseContainerFacts(factsWith(`${STDIN_PROBE}\n`))).toEqual({
      model: "Model X",
      bootCompleted: true,
      adbPorts: [5555],
      ipv4: ["10.0.3.2"],
      stdinPassthrough: true,
    });
    // An attach command that drops stdin leaves the read empty, and the probe says so.
    expect(parseContainerFacts(factsWith("")).stdinPassthrough).toBe(false);
    expect(parseContainerFacts("adbport=0\nadbport=70000\nadbport=x\n")).toEqual({
      model: null,
      bootCompleted: false,
      adbPorts: [],
      ipv4: [],
      stdinPassthrough: false,
    });
  });
});
