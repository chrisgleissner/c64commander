/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolExecutionError, TransportUnavailableError, UnsupportedOnTransportError } from "../tools/errors.js";
import { ALL_TOOL_NAMES } from "../tools/toolNames.js";
import {
  AdbTransport,
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  type RawExecRunner,
  type RawSpawnRunner,
  installFlags,
  nodeExecRunner,
  nodeSpawnRunner,
  quoteForRemoteShell,
} from "./adb.js";
import { containerCommand, sshSerial } from "./sshCommands.js";
import { CONFIG_VARIABLES, type SshHostSettings, resolveSshConfig } from "./sshConfig.js";
import { type SshSystem, createNodeSshSystem, discoverUsbHosts, findUsbNetworkInterfaces } from "./sshDiscovery.js";
import {
  AUTHORIZATION_PREREQUISITES,
  PREREQUISITE_SUMMARIES,
  classifySshFailure,
  containerAdbUnauthorized,
  formatPrerequisites,
  isSshTransportFailure,
  sshClientMissing,
} from "./sshPrerequisites.js";
import { type AttachRoute, type HostDiagnosis, HostProber, type SshRouteKind, endpointOf } from "./sshProbe.js";
import { SshCommandRunner } from "./sshRunner.js";
import type {
  CapabilitySupport,
  CommandSink,
  DetachedHandle,
  ExecOptions,
  ExecResult,
  InstallOptions,
  InstallResult,
  MissingPrerequisite,
  RemoteEndpoint,
  ResolvedTarget,
  TargetInfo,
  TargetState,
  Transport,
  TransportCapabilities,
} from "./types.js";

export const SPEC_REFERENCE = "docs/plans/droidctl/spec.md";
/** A blocked host is probed again after this long, so a fixed prerequisite is noticed without a restart. */
export const BLOCKED_REPROBE_MS = 10_000;
/** The attach route has no tunnel to watch, so it is re-checked on this interval and on a lost connection. */
export const ATTACH_REPROBE_MS = 60_000;
export const TRANSFER_TIMEOUT_MS = 300_000;
export const PULL_MAX_BYTES = 512 * 1024 * 1024;

export const SSH_DETECTION_ORDER: readonly string[] = [
  "Configuration: DROIDCTL_SSH_* variables and the optional ssh.json file are read and validated.",
  "Discovery: each USB network interface bound to a USB-gadget driver contributes 192.168.2.15 when that address " +
    "is in its subnet, and neighbours with a locally administered MAC. Configured hosts are always included.",
  "SSH port: a TCP connection to the host's SSH port succeeds.",
  "SSH login: a non-interactive key login runs the host probe, which reports uid, passwordless sudo, whether " +
    "system_server is running, listening TCP sockets and candidate container attach helpers.",
  "Android container: a system_server process is running on the host. When /proc hides other users' processes " +
    "the state is unknown and detection continues.",
  "Container adb, first pass: adb runs on this computer, and a configured endpoint or port 5555 listening on the " +
    "host is forwarded over SSH and connected with adb connect until adb lists it as device or unauthorized.",
  "Root: the login user is uid 0, or sudo -n works, or root@host accepts the same key.",
  "Container attach: the configured attach command, or each *-attach helper, each LXC container found through " +
    "its [lxc monitor] process with its lxcpath, and each container lxc-ls lists, verified by running getprop " +
    "inside the container and reading an integer SDK level. A line sent on stdin is read back to check that the " +
    "command passes stdin through.",
  "Container adb, second pass: adb ports the container announces in its properties are tried the same way.",
  "Route: container-adb when adb lists the tunnel as device, otherwise container-attach when an attach command " +
    "was verified, otherwise none, with every missing prerequisite reported in this order.",
];

/** Tools the attach route refuses, each with the reason it cannot be trusted there. */
export const CONTAINER_ADB_ONLY: Readonly<Record<string, string>> = {
  "droid_input.tap":
    "Input injection run through the container attach command cannot be verified: a UI-session command there can exit 0 with no effect.",
  "droid_input.swipe":
    "Input injection run through the container attach command cannot be verified: a UI-session command there can exit 0 with no effect.",
  "droid_input.input_text":
    "Input injection run through the container attach command cannot be verified: a UI-session command there can exit 0 with no effect.",
  "droid_input.press_key":
    "Input injection run through the container attach command cannot be verified: a UI-session command there can exit 0 with no effect.",
  "droid_capture.ui_hierarchy":
    "uiautomator run through the container attach command has exited 0 without writing a dump.",
  "droid_assert.assert_visible": "Assertions read the uiautomator hierarchy, which the attach route cannot capture.",
  "droid_assert.assert_not_visible":
    "Assertions read the uiautomator hierarchy, which the attach route cannot capture.",
  "droid_capture.start_recording": "screenrecord needs a detached adb shell that can be stopped gracefully.",
  "droid_capture.stop_recording": "screenrecord needs a detached adb shell that can be stopped gracefully.",
  "droid_device.forward_webview":
    "The WebView DevTools socket is an abstract socket inside the container, which only adb forward reaches.",
};

const ATTACH_ROUTE_CAVEATS: Readonly<Record<string, string>> = {
  "droid_app.install_app":
    "Installed with pm install inside the container, which skips any launcher integration the platform's own installer adds.",
  "droid_capture.screenshot":
    "Captured with screencap inside the container. The PNG signature is checked; a blank frame is not detected.",
};

/** Tools that send data on stdin, refused where the attach command was not seen to pass stdin through. */
export const NEEDS_STDIN: Readonly<Record<string, string>> = {
  "droid_app.install_app": "The APK is streamed to pm install on stdin.",
  "droid_app.write_app_file": "The file content is sent to run-as on stdin.",
  "droid_device.push_file": "The file is streamed into the container on stdin.",
};

export const STDIN_NOT_PASSED =
  "The container attach command on this phone did not pass standard input into the container when probed, so " +
  "nothing can be sent that way. The container adb route does not have this limit.";

export const ATTACH_ROUTE_SUPPORT: Readonly<Record<string, CapabilitySupport>> = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [name, name in CONTAINER_ADB_ONLY ? "unsupported" : "supported"]),
);

const ALL_SUPPORTED: Readonly<Record<string, CapabilitySupport>> = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [name, "supported" as CapabilitySupport]),
);

const ALL_UNSUPPORTED: Readonly<Record<string, CapabilitySupport>> = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [name, "unsupported" as CapabilitySupport]),
);

/** What the transport-support and ssh-transport resources serve. */
export function sshTransportReference(): Record<string, unknown> {
  return {
    detectionOrder: SSH_DETECTION_ORDER,
    routes: {
      "container-adb": "Every tool, through the desktop adb client and an SSH port forward to the container's adbd.",
      "container-attach": {
        refused: CONTAINER_ADB_ONLY,
        refusedWithoutStdin: NEEDS_STDIN,
        caveats: ATTACH_ROUTE_CAVEATS,
      },
    },
    prerequisites: PREREQUISITE_SUMMARIES,
    configuration: CONFIG_VARIABLES,
    specification: `${SPEC_REFERENCE} §14`,
  };
}

export function routeOf(diagnosis: HostDiagnosis): SshRouteKind | null {
  if (diagnosis.tunnel !== null && diagnosis.tunnelState === "device") {
    return "container-adb";
  }
  return diagnosis.attach === null ? null : "container-attach";
}

export function missingOf(diagnosis: HostDiagnosis): MissingPrerequisite[] {
  return [
    ...diagnosis.blockers,
    ...(diagnosis.tunnelState === "device" ? [] : diagnosis.adbMissing),
    ...diagnosis.attachMissing,
  ];
}

export function stateOf(diagnosis: HostDiagnosis): TargetState {
  const route = routeOf(diagnosis);
  if (route !== null) {
    return route === "container-attach" && diagnosis.container?.bootCompleted === false ? "booting" : "device";
  }
  const first = missingOf(diagnosis)[0];
  return first !== undefined && AUTHORIZATION_PREREQUISITES.has(first.id) ? "unauthorized" : "offline";
}

export function routeReports(diagnosis: HostDiagnosis): Record<string, unknown>[] {
  const adbStatus =
    diagnosis.tunnelState === "device" ? "usable" : diagnosis.adbMissing.length > 0 ? "unavailable" : "not-checked";
  const attachStatus = diagnosis.attach !== null ? "usable" : diagnosis.attachChecked ? "unavailable" : "not-checked";
  return [
    { route: "container-adb", status: adbStatus, missing: adbStatus === "unavailable" ? diagnosis.adbMissing : [] },
    { route: "container-attach", status: attachStatus, missing: diagnosis.attachMissing },
  ];
}

export interface SshTransportOptions {
  readonly sshPath?: string;
  readonly exec?: RawExecRunner;
  readonly spawn?: RawSpawnRunner;
  /** The adb client used for the container adb route. Never the one that lists ordinary adb targets. */
  readonly adb?: AdbTransport;
  readonly system?: SshSystem;
  readonly onCommand?: CommandSink;
  /** Directory for ssh multiplexing sockets; null disables multiplexing. */
  readonly controlDir?: string | null;
  /** Largest file the attach route reads into memory. Default PULL_MAX_BYTES. */
  readonly pullMaxBytes?: number;
}

interface WantedHost {
  readonly settings: SshHostSettings;
  readonly via: string;
}

interface HostState {
  readonly serial: string;
  readonly settings: SshHostSettings;
  readonly via: string;
  diagnosis: HostDiagnosis;
  probedAt: number;
}

type Route =
  | { readonly kind: "container-adb"; readonly delegate: ResolvedTarget }
  | { readonly kind: "container-attach"; readonly attach: AttachRoute; readonly state: HostState };

/**
 * A Linux phone whose Android apps run in a compatibility container, reached over
 * SSH. The container adb route hands every operation to the adb backend through a
 * tunnel, so its results match an ordinary phone's; the attach route runs commands
 * inside the container and refuses what it cannot verify.
 */
export class SshTransport implements Transport {
  readonly kind = "ssh" as const;
  private readonly system: SshSystem;
  private readonly runner: SshCommandRunner;
  private readonly adb: AdbTransport;
  private readonly prober: HostProber;
  private readonly hosts = new Map<string, HostState>();
  private readonly inflight = new Map<string, Promise<HostState>>();
  private readonly pullMaxBytes: number;

  constructor(options: SshTransportOptions = {}) {
    this.pullMaxBytes = options.pullMaxBytes ?? PULL_MAX_BYTES;
    this.system = options.system ?? createNodeSshSystem();
    this.adb = options.adb ?? new AdbTransport(options.onCommand === undefined ? {} : { onCommand: options.onCommand });
    this.runner = new SshCommandRunner({
      sshPath: options.sshPath ?? "ssh",
      exec: options.exec ?? nodeExecRunner,
      spawn: options.spawn ?? nodeSpawnRunner,
      system: this.system,
      controlDir: options.controlDir === undefined ? path.join(os.tmpdir(), "droidctl-ssh") : options.controlDir,
      ...(options.onCommand === undefined ? {} : { onCommand: options.onCommand }),
    });
    this.prober = new HostProber({ runner: this.runner, adb: this.adb, system: this.system });
  }

  /** True for the adb serial of a tunnel this transport opened, which the adb transport then leaves unlisted. */
  ownsAdbSerial(serial: string): boolean {
    return [...this.hosts.values()].some((state) => state.diagnosis.tunnel?.serial === serial);
  }

  capabilities(target?: ResolvedTarget): TransportCapabilities {
    if (target === undefined) {
      return {
        transport: "ssh",
        tools: { ...ATTACH_ROUTE_SUPPORT },
        notes: { ...CONTAINER_ADB_ONLY, ...ATTACH_ROUTE_CAVEATS },
      };
    }
    const state = this.hosts.get(target.serial);
    const route = state === undefined ? null : routeOf(state.diagnosis);
    if (state === undefined || route === null) {
      const missing = state === undefined ? [] : missingOf(state.diagnosis);
      const message =
        missing.length === 0
          ? `${target.serial} has not been probed by the ssh transport; call droid_target.list_targets first.`
          : `No route into the Android container of ${target.serial} works. Missing, in detection order:\n${formatPrerequisites(missing)}`;
      return {
        transport: "ssh",
        tools: { ...ALL_UNSUPPORTED },
        notes: {},
        unavailable: { message, details: { prerequisites: missing } },
      };
    }
    if (route === "container-adb") {
      return { transport: "ssh", tools: { ...ALL_SUPPORTED }, notes: {} };
    }
    const reason = state.diagnosis.adbMissing.map((entry) => `[${entry.id}] ${entry.message}`).join(" ");
    const tools: Record<string, CapabilitySupport> = { ...ATTACH_ROUTE_SUPPORT };
    const notes: Record<string, string> = { ...ATTACH_ROUTE_CAVEATS };
    for (const [tool, note] of Object.entries(CONTAINER_ADB_ONLY)) {
      notes[tool] = `${note} It needs the container adb route, which is unavailable: ${reason}`;
    }
    if (state.diagnosis.container?.stdinPassthrough !== true) {
      for (const [tool, note] of Object.entries(NEEDS_STDIN)) {
        tools[tool] = "unsupported";
        notes[tool] = `${note} ${STDIN_NOT_PASSED} Unavailable there: ${reason}`;
      }
    }
    return { transport: "ssh", tools, notes };
  }

  describeConnection(target: ResolvedTarget): Record<string, unknown> {
    const state = this.hosts.get(target.serial);
    if (state === undefined) {
      return { route: null, probed: false };
    }
    const { diagnosis, settings } = state;
    const { tunnel, attach } = diagnosis;
    return {
      host: settings.host,
      port: settings.port,
      user: settings.user,
      discoveredVia: state.via,
      hostOs: diagnosis.hostOs,
      route: routeOf(diagnosis),
      ...(tunnel === null ? {} : { adbSerial: tunnel.serial, containerAdbEndpoint: tunnel.endpoint }),
      ...(attach === null
        ? {}
        : { attachCommand: attach.attachCommand, rootVia: attach.rootVia, attachSessionUser: attach.session.user }),
      routes: routeReports(diagnosis),
    };
  }

  async listTargets(): Promise<TargetInfo[]> {
    const config = resolveSshConfig(this.system);
    const discovered = config.discovery
      ? discoverUsbHosts(findUsbNetworkInterfaces(this.system))
      : { hosts: [], problems: [] };

    const wanted = new Map<string, WantedHost>();
    for (const configured of config.hosts) {
      wanted.set(sshSerial(configured.settings), { settings: configured.settings, via: configured.source });
    }
    for (const found of discovered.hosts) {
      const configured = config.hosts.find((entry) => entry.settings.host === found.host);
      const settings = configured?.settings ?? { ...config.defaults, host: found.host };
      wanted.set(sshSerial(settings), { settings, via: `usb-network ${found.interfaceName} (${found.driver})` });
    }

    for (const [serial, state] of [...this.hosts]) {
      if (!wanted.has(serial)) {
        this.hosts.delete(serial);
        await this.release(state);
      }
    }

    if (wanted.size === 0) {
      if (discovered.problems.length > 0) {
        throw new TransportUnavailableError(
          "ssh",
          `A USB network interface is present, but no phone on it can be probed:\n${formatPrerequisites(discovered.problems)}`,
          { prerequisites: discovered.problems },
        );
      }
      return [];
    }

    const tunnelTargets = await this.listTunnelTargets();
    const states = await Promise.all(
      [...wanted.values()].map((host) => this.refresh(host, tunnelTargets, discovered.problems)),
    );
    return states.map((state) => this.toTargetInfo(state));
  }

  async exec(target: ResolvedTarget, argv: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.exec(route.delegate, argv, opts);
    }
    const result = await this.runInContainer(target, route, argv, opts);
    if (opts.throwOnNonZeroExit && result.exitCode !== 0) {
      throw new ToolExecutionError(`Command failed on ${target.targetId}: ${argv.join(" ")}`, {
        details: { exitCode: result.exitCode, stderr: result.stderr, argv: [...argv] },
      });
    }
    return result;
  }

  spawnShell(target: ResolvedTarget, argv: readonly string[]): DetachedHandle {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.spawnShell(route.delegate, argv);
    }
    throw this.needsContainerAdb(target, route, "A detached command");
  }

  async pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.pullBinary(route.delegate, remotePath);
    }
    const result = await this.runInContainer(target, route, ["cat", remotePath], {
      encoding: "buffer",
      timeoutMs: TRANSFER_TIMEOUT_MS,
      maxBytes: this.pullMaxBytes,
    });
    if (result.exitCode !== 0 || result.truncated) {
      throw new ToolExecutionError(
        `Unable to read ${remotePath} from ${target.targetId}${result.truncated ? `: larger than ${this.pullMaxBytes} bytes` : ""}.`,
        { details: { exitCode: result.exitCode, stderr: result.stderr, truncated: result.truncated } },
      );
    }
    return result.stdoutBytes;
  }

  async pullFile(target: ResolvedTarget, remotePath: string, localPath: string): Promise<number> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.pullFile(route.delegate, remotePath, localPath);
    }
    const bytes = await this.pullBinary(target, remotePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    return bytes.length;
  }

  /** Verified by the byte count the container reports back, not by the exit code. */
  async pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<number> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.pushFile(route.delegate, localPath, remotePath);
    }
    const payload = await readFile(localPath);
    const quoted = quoteForRemoteShell(remotePath);
    const result = await this.runInContainer(target, route, ["sh", "-c", `cat > ${quoted} && wc -c < ${quoted}`], {
      stdin: payload,
      timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    const written = Number.parseInt(result.stdout.trim(), 10);
    if (result.exitCode !== 0 || written !== payload.length) {
      throw new ToolExecutionError(
        `Push of ${localPath} to ${remotePath} on ${target.targetId} failed: the container reports ` +
          `${Number.isNaN(written) ? "no" : written} of ${payload.length} bytes. ${result.stderr.trim()}`.trim(),
        { details: { exitCode: result.exitCode, stderr: result.stderr, expected: payload.length } },
      );
    }
    return written;
  }

  async installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<InstallResult> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.installPackage(route.delegate, apkPath, opts);
    }
    const apk = await readFile(apkPath);
    const result = await this.runInContainer(
      target,
      route,
      ["pm", "install", ...installFlags(opts), "-S", String(apk.length)],
      { stdin: apk, timeoutMs: opts.timeoutMs ?? TRANSFER_TIMEOUT_MS },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    return {
      installed: result.exitCode === 0 && /Success/.test(output),
      signatureMismatch: /INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(output),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      argv: result.argv,
    };
  }

  async forwardPort(target: ResolvedTarget, localPort: number, remote: RemoteEndpoint): Promise<void> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.forwardPort(route.delegate, localPort, remote);
    }
    throw this.needsContainerAdb(target, route, "A port forward into the container");
  }

  async removeForward(target: ResolvedTarget, localPort: number): Promise<void> {
    const route = this.route(target);
    if (route.kind === "container-adb") {
      return this.adb.removeForward(route.delegate, localPort);
    }
    throw this.needsContainerAdb(target, route, "A port forward into the container");
  }

  async dispose(): Promise<void> {
    const states = [...this.hosts.values()];
    this.hosts.clear();
    await Promise.all(states.map((state) => this.release(state)));
  }

  private toTargetInfo(state: HostState): TargetInfo {
    const { diagnosis } = state;
    return {
      targetId: `ssh:${state.serial}`,
      transport: "ssh",
      serial: state.serial,
      model: diagnosis.adbTarget?.model ?? diagnosis.container?.model ?? null,
      apiLevel: diagnosis.adbTarget?.apiLevel ?? diagnosis.apiLevel,
      state: stateOf(diagnosis),
      isEmulator: false,
      route: routeOf(diagnosis),
      missingPrerequisites: missingOf(diagnosis),
    };
  }

  private async listTunnelTargets(): Promise<Map<string, TargetInfo>> {
    if (![...this.hosts.values()].some((state) => state.diagnosis.tunnel !== null)) {
      return new Map();
    }
    try {
      return new Map((await this.adb.listTargets()).map((target) => [target.serial, target]));
    } catch {
      return new Map();
    }
  }

  private async refresh(
    host: WantedHost,
    tunnelTargets: ReadonlyMap<string, TargetInfo>,
    problems: readonly MissingPrerequisite[],
  ): Promise<HostState> {
    const serial = sshSerial(host.settings);
    const existing = this.hosts.get(serial);
    if (existing !== undefined && (await this.isCurrent(existing, tunnelTargets))) {
      return existing;
    }
    const pending = this.inflight.get(serial);
    if (pending !== undefined) {
      return pending;
    }
    const started = this.reprobe(serial, host, existing, problems).finally(() => this.inflight.delete(serial));
    this.inflight.set(serial, started);
    return started;
  }

  /**
   * A live tunnel is its own liveness check: adb lists it, or the host is probed
   * again. Without one, the attach route needs its ssh master to still be running,
   * and a blocked host is retried after a short interval.
   */
  private async isCurrent(state: HostState, tunnelTargets: ReadonlyMap<string, TargetInfo>): Promise<boolean> {
    const { diagnosis } = state;
    if (diagnosis.tunnel !== null) {
      const listed = tunnelTargets.get(diagnosis.tunnel.serial);
      if (diagnosis.tunnel.closed || (listed?.state !== "device" && listed?.state !== "unauthorized")) {
        return false;
      }
      const endpoint = endpointOf(state.settings);
      state.diagnosis = {
        ...diagnosis,
        tunnelState: listed.state,
        adbTarget: listed,
        adbMissing: listed.state === "device" ? [] : [containerAdbUnauthorized(endpoint, diagnosis.tunnel.serial)],
      };
      return true;
    }
    const age = this.system.now() - state.probedAt;
    if (diagnosis.attach === null) {
      return age < BLOCKED_REPROBE_MS;
    }
    if (age >= ATTACH_REPROBE_MS) {
      return false;
    }
    return this.runner.controlPath() === null || (await this.runner.masterPid(null, diagnosis.attach.session)) !== null;
  }

  private async reprobe(
    serial: string,
    host: WantedHost,
    existing: HostState | undefined,
    problems: readonly MissingPrerequisite[],
  ): Promise<HostState> {
    if (existing !== undefined) {
      await this.release(existing);
    }
    const diagnosis = await this.prober.probe(host.settings, problems);
    const state: HostState = { serial, settings: host.settings, via: host.via, diagnosis, probedAt: this.system.now() };
    this.hosts.set(serial, state);
    return state;
  }

  private async release(state: HostState): Promise<void> {
    if (state.diagnosis.tunnel !== null) {
      await this.prober.closeTunnel(state.diagnosis.tunnel);
    }
  }

  private route(target: ResolvedTarget): Route {
    const state = this.hosts.get(target.serial);
    const diagnosis = state?.diagnosis;
    if (diagnosis?.tunnel && diagnosis.tunnelState === "device") {
      return {
        kind: "container-adb",
        delegate: { targetId: target.targetId, transport: "ssh", serial: diagnosis.tunnel.serial },
      };
    }
    if (state !== undefined && diagnosis?.attach) {
      return { kind: "container-attach", attach: diagnosis.attach, state };
    }
    const { unavailable } = this.capabilities(target);
    throw new TransportUnavailableError("ssh", unavailable!.message, unavailable!.details);
  }

  private needsContainerAdb(
    target: ResolvedTarget,
    route: Extract<Route, { kind: "container-attach" }>,
    what: string,
  ): UnsupportedOnTransportError {
    return new UnsupportedOnTransportError(
      "ssh",
      "container-adb",
      `${what} needs the container adb route on ${target.targetId}, which is unavailable: ` +
        formatPrerequisites(route.state.diagnosis.adbMissing),
    );
  }

  private async runInContainer(
    target: ResolvedTarget,
    route: Extract<Route, { kind: "container-attach" }>,
    argv: readonly string[],
    opts: Omit<ExecOptions, "stdin"> & { stdin?: string | Buffer },
  ): Promise<ExecResult> {
    const { attach, state } = route;
    if (opts.stdin !== undefined && state.diagnosis.container?.stdinPassthrough !== true) {
      throw new UnsupportedOnTransportError(
        "ssh",
        "stdin",
        `${argv[0]} was not run on ${target.targetId} because it needs standard input. ${STDIN_NOT_PASSED} ` +
          `Missing for the container adb route:\n${formatPrerequisites(state.diagnosis.adbMissing)}`,
      );
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const outcome = await this.runner.run(
      target.targetId,
      attach.session,
      containerCommand(attach.rootPrefix, attach.attachCommand, argv),
      { timeoutMs, maxBytes, ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }) },
    );
    if (outcome.kind === "spawn-failed") {
      const missing = sshClientMissing(this.runner.sshPath, outcome.message);
      throw new TransportUnavailableError("ssh", missing.message, { prerequisites: [missing] });
    }
    if (outcome.timedOut) {
      throw new ToolExecutionError(`${argv.join(" ")} timed out after ${timeoutMs} ms on ${target.targetId}.`, {
        code: "timeout",
        details: { argv: outcome.argv },
      });
    }
    if (outcome.exitCode === 255 && isSshTransportFailure(outcome.stderr)) {
      // The next listing probes this host from the start instead of trusting the old diagnosis.
      state.probedAt = Number.NEGATIVE_INFINITY;
      const missing = classifySshFailure(attach.session, outcome, true);
      throw new TransportUnavailableError("ssh", `The connection to ${target.targetId} failed. ${missing.message}`, {
        prerequisites: [missing],
      });
    }
    const truncated = outcome.stdout.length > maxBytes;
    const stdoutBytes = truncated ? outcome.stdout.subarray(0, maxBytes) : outcome.stdout;
    return {
      stdout: opts.encoding === "buffer" ? "" : stdoutBytes.toString("utf8"),
      stderr: outcome.stderr,
      exitCode: outcome.exitCode,
      stdoutBytes,
      truncated,
      durationMs: outcome.durationMs,
      argv: outcome.argv,
    };
  }
}
