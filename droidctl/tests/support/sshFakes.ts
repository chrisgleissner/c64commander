/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A scripted Linux phone with an Android container: it answers the ssh, adb and
 * tunnel traffic the ssh transport generates, and records every command so a test
 * can assert on the order detection ran in.
 */

import type os from "node:os";
import {
  AdbTransport,
  type RawExecOutcome,
  type RawExecRequest,
  type RawSpawnHandle,
} from "../../src/transport/adb.js";
import {
  CONTAINER_FACTS_ARGV,
  CONTAINER_SHELL,
  LOGIN_PROBE_SCRIPT,
  hostShellCommand,
} from "../../src/transport/sshCommands.js";
import type { SshSystem, TcpOutcome } from "../../src/transport/sshDiscovery.js";
import { SshTransport, type SshTransportOptions } from "../../src/transport/ssh.js";
import type { CommandRecord } from "../../src/transport/types.js";

/** Undoes quoteForRemoteShell: single-quoted spans and backslash escapes, split on spaces. */
export function parseShellWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let index = 0;
  while (index < line.length) {
    const character = line[index]!;
    if (character === "'") {
      const end = line.indexOf("'", index + 1);
      current += line.slice(index + 1, end);
      index = end + 1;
      inWord = true;
    } else if (character === "\\") {
      current += line[index + 1] ?? "";
      index += 2;
      inWord = true;
    } else if (character === " ") {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
      index += 1;
    } else {
      current += character;
      inWord = true;
      index += 1;
    }
  }
  if (inWord) {
    words.push(current);
  }
  return words;
}

export class FakeSshSystem implements SshSystem {
  env: NodeJS.ProcessEnv = {};
  homeDir = "/home/tester";
  readonly files = new Map<string, string>();
  readonly links = new Map<string, string>();
  readonly dirs = new Map<string, string[]>();
  readonly existing = new Set<string>();
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {};
  privateDirOk = true;
  clock = 1_000_000;
  nextPort = 40_000;
  readonly tcpCalls: string[] = [];
  tcp: (host: string, port: number) => TcpOutcome = () => ({ kind: "refused" });

  readText(filePath: string): string | null {
    return this.files.get(filePath) ?? null;
  }
  realpath(filePath: string): string | null {
    return this.links.get(filePath) ?? null;
  }
  listDir(directory: string): string[] {
    return this.dirs.get(directory) ?? [];
  }
  fileExists(filePath: string): boolean {
    return this.existing.has(filePath);
  }
  ensurePrivateDir(): boolean {
    return this.privateDirOk;
  }
  networkInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
    return this.interfaces;
  }
  async tcpConnect(host: string, port: number): Promise<TcpOutcome> {
    this.tcpCalls.push(`${host}:${port}`);
    return this.tcp(host, port);
  }
  async allocatePort(): Promise<number> {
    const port = this.nextPort;
    this.nextPort += 1;
    return port;
  }
  now(): number {
    return this.clock;
  }
  async delay(ms: number): Promise<void> {
    this.clock += ms;
  }

  /** A USB network gadget interface as sysfs, os.networkInterfaces and /proc/net/arp show it. */
  addUsbInterface(
    name: string,
    options: {
      driver?: string;
      cidr?: string | null;
      operstate?: string;
      arp?: { address: string; mac: string }[];
      bus?: string;
    } = {},
  ): this {
    const driver = options.driver ?? "cdc_ncm";
    this.dirs.set("/sys/class/net", [...this.listDir("/sys/class/net"), name]);
    this.links.set(`/sys/class/net/${name}/device/subsystem`, `/sys/bus/${options.bus ?? "usb"}`);
    this.links.set(`/sys/class/net/${name}/device/driver`, `/sys/bus/usb/drivers/${driver}`);
    this.files.set(`/sys/class/net/${name}/operstate`, `${options.operstate ?? "up"}\n`);
    const cidr = options.cidr === undefined ? "192.168.2.14/24" : options.cidr;
    if (cidr !== null) {
      const [address, prefix] = cidr.split("/");
      this.interfaces[name] = [
        {
          address: address!,
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "02:00:00:00:00:01",
          internal: false,
          cidr,
        },
        {
          address: "fe80::1",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "02:00:00:00:00:01",
          internal: false,
          cidr: "fe80::1/64",
          scopeid: 3,
        },
      ];
      void prefix;
    }
    const arp =
      this.files.get("/proc/net/arp") ??
      "IP address       HW type     Flags       HW address            Mask     Device\n";
    this.files.set(
      "/proc/net/arp",
      arp + (options.arp ?? []).map((entry) => `${entry.address} 0x1 0x2 ${entry.mac} * ${name}`).join("\n") + "\n",
    );
    return this;
  }
}

export type EndpointBehaviour = "device" | "unauthorized" | "refused" | "silent" | "forward-denied" | "never-listens";

export interface ShellReply {
  readonly stdout?: string | Buffer;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export interface PhoneScenario {
  host: string;
  sshPort: TcpOutcome;
  sshSpawnFails: boolean;
  login: { exitCode: number; stderr: string; timedOut?: boolean } | null;
  uid: number;
  home: string;
  sudo: boolean;
  android: "running" | "hidden" | "absent";
  attachStdin: boolean;
  listeners: string[];
  helpers: string[];
  lxc: boolean;
  lxcNames: string[];
  lxcMonitors: { name: string; path: string }[];
  rootLogin: boolean;
  attachResults: Record<string, { exitCode: number; firstLine: string }>;
  attachProbeExit: number;
  containerFacts: { exitCode: number; stdout: string };
  masterRunning: boolean;
  adbInstalled: boolean;
  adbConnectThrows: boolean;
  endpoints: Record<string, EndpointBehaviour>;
  model: string;
  shell: (argv: readonly string[], stdin: Buffer | undefined, via: "adb" | "attach") => ShellReply;
}

export function defaultScenario(overrides: Partial<PhoneScenario> = {}): PhoneScenario {
  return {
    host: "192.168.2.15",
    sshPort: { kind: "open" },
    sshSpawnFails: false,
    login: null,
    uid: 100000,
    home: "/home/defaultuser",
    sudo: false,
    android: "running",
    attachStdin: true,
    listeners: [],
    helpers: [],
    lxc: false,
    lxcNames: [],
    lxcMonitors: [],
    rootLogin: false,
    attachResults: {},
    attachProbeExit: 0,
    containerFacts: { exitCode: 0, stdout: "model=Container\nboot=1\n" },
    masterRunning: true,
    adbInstalled: true,
    adbConnectThrows: false,
    endpoints: {},
    model: "Container_Model",
    shell: () => ({ stdout: "" }),
    ...overrides,
  };
}

interface FakeTunnel {
  readonly localPort: number;
  readonly endpoint: string;
  readonly behaviour: EndpointBehaviour;
  readonly handle: ReplayingHandle;
}

export class ReplayingHandle implements RawSpawnHandle {
  readonly signals: NodeJS.Signals[] = [];
  stderr = "";
  code: number | null | undefined = undefined;
  private readonly stderrListeners: ((chunk: string) => void)[] = [];
  private readonly closeListeners: ((code: number | null) => void)[] = [];

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    this.close(null);
  }
  onClose(listener: (code: number | null) => void): void {
    if (this.code !== undefined) {
      listener(this.code);
      return;
    }
    this.closeListeners.push(listener);
  }
  onStderr(listener: (chunk: string) => void): void {
    if (this.stderr) {
      listener(this.stderr);
    }
    this.stderrListeners.push(listener);
  }
  emitStderr(chunk: string): void {
    this.stderr += chunk;
    for (const listener of this.stderrListeners) {
      listener(chunk);
    }
  }
  close(code: number | null): void {
    if (this.code !== undefined) {
      return;
    }
    this.code = code;
    for (const listener of this.closeListeners.splice(0)) {
      listener(code);
    }
  }
}

const EMPTY = Buffer.alloc(0);

function reply(stdout: string | Buffer = "", stderr = "", exitCode = 0): RawExecOutcome {
  return { stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), stderr, exitCode };
}

function enoent(file: string): Error {
  return Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
}

export interface SshCall {
  readonly destination: string;
  readonly remote: string;
  readonly args: readonly string[];
  readonly stdin: Buffer | undefined;
}

export class FakePhone {
  readonly scenario: PhoneScenario;
  readonly system: FakeSshSystem;
  readonly sshCalls: SshCall[] = [];
  readonly masterChecks: string[] = [];
  readonly adbCalls: string[][] = [];
  readonly containerCalls: { prefix: string[]; argv: string[]; stdin: Buffer | undefined; destination: string }[] = [];
  readonly deviceShellCalls: { argv: string[]; via: "adb" | "attach" }[] = [];
  readonly tunnels = new Map<number, FakeTunnel>();
  readonly connected = new Map<string, "device" | "unauthorized" | "offline">();
  readonly commands: CommandRecord[] = [];

  constructor(scenario: Partial<PhoneScenario> = {}, system: FakeSshSystem = new FakeSshSystem()) {
    this.scenario = defaultScenario(scenario);
    this.system = system;
    system.tcp = (host, port) => {
      if (host === "127.0.0.1") {
        const tunnel = this.tunnels.get(port);
        const listening = tunnel && tunnel.handle.code === undefined && tunnel.behaviour !== "never-listens";
        return listening ? { kind: "open" } : { kind: "refused" };
      }
      return host === this.scenario.host && port === 22 ? this.scenario.sshPort : { kind: "timeout" };
    };
  }

  /** The login probes that ran, which is how a test tells a re-probe from a cached listing. */
  loginProbes(): number {
    return this.sshCalls.filter((call) => call.remote === hostShellCommand(LOGIN_PROBE_SCRIPT)).length;
  }

  /** Answers an ssh call before the scripted phone does, for failures the phone itself cannot produce. */
  interceptSsh: ((request: RawExecRequest) => RawExecOutcome) | null = null;

  sshExec = async (request: RawExecRequest): Promise<RawExecOutcome> => {
    const s = this.scenario;
    if (s.sshSpawnFails) {
      throw enoent(request.file);
    }
    if (this.interceptSsh !== null) {
      return this.interceptSsh(request);
    }
    const args = request.args;
    if (args.includes("-O")) {
      this.masterChecks.push(args[args.length - 1]!);
      return s.masterRunning
        ? reply("", "Master running (pid=4242)\r\n")
        : reply("", "Control socket connect: No such file", 255);
    }
    const separator = args.indexOf("--");
    const destination = args[separator + 1]!;
    const remote = args[separator + 2]!;
    const stdin = request.stdin === undefined ? undefined : Buffer.from(request.stdin);
    this.sshCalls.push({ destination, remote, args, stdin });

    if (remote === hostShellCommand(LOGIN_PROBE_SCRIPT)) {
      if (s.login !== null) {
        return { ...reply("", s.login.stderr, s.login.exitCode), ...(s.login.timedOut ? { timedOut: true } : {}) };
      }
      return reply(
        [
          `uid=${s.uid}`,
          `home=${s.home}`,
          `sudo=${s.sudo ? 1 : 0}`,
          ...(s.android === "absent" ? [] : [`android=${s.android}`]),
          ...s.listeners.map((entry) => `listen=${entry}`),
          ...s.helpers.map((helper) => `helper=${helper}`),
          ...(s.lxc ? ["lxc=1"] : []),
          "os=Test Linux 1.0",
        ].join("\n") + "\n",
      );
    }
    if (remote === "true") {
      return s.rootLogin ? reply() : reply("", "root@192.168.2.15: Permission denied (publickey).\n", 255);
    }

    const words = parseShellWords(remote);
    const script = words[words.indexOf("-c") + 1] ?? "";
    if (words[words.indexOf("-c") - 1] === "sh" && script.includes("check() {")) {
      const lines: string[] = [];
      for (const line of script.split("\n").filter((entry) => entry.startsWith("check "))) {
        const id = parseShellWords(line)[1]!;
        const result = s.attachResults[id] ?? { exitCode: 127, firstLine: "not found" };
        lines.push(`candidate=${id}|${result.exitCode}|${result.firstLine}`);
      }
      if (script.includes("lxc monitor")) {
        for (const monitor of s.lxcMonitors) {
          const id = `lxc:${monitor.name}@${monitor.path}`;
          const result = s.attachResults[id] ?? { exitCode: 1, firstLine: "lxc-attach: failed" };
          lines.push(`candidate=${id}|${result.exitCode}|${result.firstLine}`);
        }
      }
      if (script.includes("lxc-ls")) {
        for (const name of s.lxcNames) {
          const result = s.attachResults[`lxc:${name}`] ?? { exitCode: 1, firstLine: "lxc-attach: failed" };
          lines.push(`candidate=lxc:${name}|${result.exitCode}|${result.firstLine}`);
        }
      }
      return reply(lines.join("\n") + "\n", s.attachProbeExit === 0 ? "" : "probe broke", s.attachProbeExit);
    }

    const shellIndex = words.indexOf(CONTAINER_SHELL);
    if (shellIndex >= 0) {
      const argv = parseShellWords(words[shellIndex + 2]!);
      this.containerCalls.push({ prefix: words.slice(0, shellIndex), argv, stdin, destination });
      if (JSON.stringify(argv) === JSON.stringify(CONTAINER_FACTS_ARGV)) {
        const echoed = s.attachStdin && stdin !== undefined ? `stdin=${stdin.toString().trim()}\n` : "stdin=\n";
        return reply(echoed + s.containerFacts.stdout, "", s.containerFacts.exitCode);
      }
      return this.device(argv, stdin, "attach");
    }
    return reply("", `unexpected remote command: ${remote}`, 127);
  };

  adbExec = async (request: RawExecRequest): Promise<RawExecOutcome> => {
    const s = this.scenario;
    this.adbCalls.push([...request.args]);
    if (!s.adbInstalled) {
      throw enoent(request.file);
    }
    const [first, second, channel, ...rest] = request.args;
    if (first === "devices") {
      const lines = [...this.connected].map(
        ([serial, state], index) => `${serial} ${state} product:c model:${s.model} device:c transport_id:${index + 1}`,
      );
      return reply(`List of devices attached\n${lines.join("\n")}\n`);
    }
    if (first === "connect") {
      if (s.adbConnectThrows) {
        throw new Error("adb connect crashed");
      }
      const tunnel = this.tunnels.get(Number(second!.split(":")[1]));
      const behaviour = tunnel?.behaviour ?? "refused";
      if (behaviour === "device" || behaviour === "unauthorized") {
        this.connected.set(second!, behaviour);
      } else {
        this.connected.set(second!, "offline");
        if (behaviour === "refused") {
          tunnel?.handle.emitStderr("channel 2: open failed: connect failed: Connection refused\n");
        }
      }
      return reply(`connected to ${second}\n`);
    }
    if (first === "disconnect") {
      this.connected.delete(second!);
      return reply(`disconnected ${second}\n`);
    }
    if (first === "-s") {
      if (channel === "shell" || channel === "exec-out") {
        const argv = parseShellWords(rest.join(" "));
        if (argv.join(" ") === "getprop ro.build.version.sdk") {
          return reply("33\n");
        }
        const outcome = this.device(argv, request.stdin === undefined ? undefined : Buffer.from(request.stdin), "adb");
        return outcome;
      }
      if (channel === "install") {
        return reply("Performing Streamed Install\nSuccess\n");
      }
      return reply("");
    }
    return reply("", `unexpected adb call ${request.args.join(" ")}`, 1);
  };

  spawn = (request: { file: string; args: readonly string[] }): RawSpawnHandle => {
    const handle = new ReplayingHandle();
    const spec = request.args[request.args.indexOf("-L") + 1];
    if (spec === undefined) {
      return handle;
    }
    const [, localPort, host, port] = spec.split(":");
    const endpoint = `${host}:${port}`;
    const behaviour = this.scenario.endpoints[endpoint] ?? "refused";
    this.tunnels.set(Number(localPort), { localPort: Number(localPort), endpoint, behaviour, handle });
    if (behaviour === "forward-denied") {
      handle.emitStderr("bind [127.0.0.1]:40000: Permission denied\nCould not request local forwarding.\n");
      handle.close(255);
    }
    return handle;
  };

  private device(argv: string[], stdin: Buffer | undefined, via: "adb" | "attach"): RawExecOutcome {
    this.deviceShellCalls.push({ argv, via });
    const answer = this.scenario.shell(argv, stdin, via);
    return reply(answer.stdout ?? EMPTY, answer.stderr ?? "", answer.exitCode ?? 0);
  }

  transport(options: Partial<SshTransportOptions> = {}): SshTransport {
    return new SshTransport({
      exec: this.sshExec,
      spawn: this.spawn,
      adb: new AdbTransport({ exec: this.adbExec, onCommand: (record) => this.commands.push(record) }),
      system: this.system,
      controlDir: "/tmp/droidctl-ssh-test",
      onCommand: (record) => this.commands.push(record),
      ...options,
    });
  }

  /** The adb client that lists ordinary targets, wired the way the server wires it. */
  mainAdb(ssh: SshTransport): AdbTransport {
    return new AdbTransport({ exec: this.adbExec, ignoreSerial: (serial) => ssh.ownsAdbSerial(serial) });
  }
}

/** A phone on USB networking with the default address, discovered rather than configured. */
export function usbPhone(scenario: Partial<PhoneScenario> = {}): FakePhone {
  const system = new FakeSshSystem().addUsbInterface("enx020000000001");
  return new FakePhone(scenario, system);
}
