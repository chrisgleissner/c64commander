/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";
import type { AdbTransport, RawSpawnHandle } from "./adb.js";
import {
  type AttachCandidate,
  CONTAINER_FACTS_ARGV,
  type ContainerFacts,
  LOGIN_PROBE_SCRIPT,
  STDIN_PROBE,
  type LoginFacts,
  type SshEndpoint,
  attachProbeScript,
  containerCommand,
  hostShellCommand,
  parseAttachResults,
  parseContainerFacts,
  parseLoginFacts,
  sshSerial,
} from "./sshCommands.js";
import type { SshHostSettings } from "./sshConfig.js";
import type { SshSystem } from "./sshDiscovery.js";
import {
  adbClientMissing,
  androidContainer,
  attachCommandMissing,
  classifySshFailure,
  containerAdbConnect,
  containerAdbDisabled,
  containerAdbUnauthorized,
  developerMode,
  hostUnreachable,
  rootAccess,
  sshClientMissing,
  sshForwarding,
} from "./sshPrerequisites.js";
import type { SshCommandRunner, SshOutcome } from "./sshRunner.js";
import type { MissingPrerequisite, TargetInfo } from "./types.js";

export const TCP_PROBE_TIMEOUT_MS = 1_500;
export const SSH_PROBE_TIMEOUT_MS = 20_000;
export const ATTACH_PROBE_TIMEOUT_MS = 60_000;
export const FORWARD_READY_TIMEOUT_MS = 5_000;
export const FORWARD_POLL_MS = 100;
export const ADB_STATE_WAIT_MS = 4_000;
export const ADB_STATE_POLL_MS = 250;
export const DEFAULT_CONTAINER_ADB_PORT = 5555;

export type SshRouteKind = "container-adb" | "container-attach";

/** A local port forwarded over its own ssh process to the container's adbd, and the adb serial it gives. */
export interface Tunnel {
  readonly localPort: number;
  readonly serial: string;
  readonly endpoint: string;
  readonly handle: RawSpawnHandle;
  readonly argv: readonly string[];
  closed: boolean;
  stderr: string;
}

export interface AttachRoute {
  readonly session: SshEndpoint;
  readonly rootPrefix: readonly string[];
  readonly rootVia: "login-root" | "sudo" | "root-login";
  readonly attachCommand: readonly string[];
}

/** Everything one probe learned about a host. Blockers stop detection before either route is tried. */
export interface HostDiagnosis {
  readonly blockers: readonly MissingPrerequisite[];
  readonly hostOs: string | null;
  readonly tunnel: Tunnel | null;
  readonly tunnelState: "device" | "unauthorized" | null;
  readonly adbTarget: TargetInfo | null;
  readonly adbMissing: readonly MissingPrerequisite[];
  readonly attach: AttachRoute | null;
  readonly attachChecked: boolean;
  readonly attachMissing: readonly MissingPrerequisite[];
  readonly container: ContainerFacts | null;
  readonly apiLevel: number | null;
}

const NOTHING_LEARNED: HostDiagnosis = {
  blockers: [],
  hostOs: null,
  tunnel: null,
  tunnelState: null,
  adbTarget: null,
  adbMissing: [],
  attach: null,
  attachChecked: false,
  attachMissing: [],
  container: null,
  apiLevel: null,
};

export function endpointOf(settings: SshHostSettings): SshEndpoint {
  return { host: settings.host, port: settings.port, user: settings.user, identityFile: settings.identityFile };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Endpoints visible without root: the configured one, then an adb port listening in the host's namespace. */
export function loginEndpoints(settings: SshHostSettings, facts: LoginFacts): string[] {
  return unique([
    ...(settings.containerAdb === null ? [] : [settings.containerAdb]),
    ...facts.listeners
      .filter((listener) => listener.port === DEFAULT_CONTAINER_ADB_PORT)
      .map((listener) => (listener.local ? "127.0.0.1" : listener.address) + `:${listener.port}`),
  ]);
}

/** Ports the container announces in its own properties, reached on loopback when the host shows them listening. */
export function containerEndpoints(container: ContainerFacts, facts: LoginFacts): string[] {
  const endpoints: string[] = [];
  for (const port of container.adbPorts) {
    if (facts.listeners.some((listener) => listener.port === port && listener.local)) {
      endpoints.push(`127.0.0.1:${port}`);
    } else if (container.ipv4.length > 0) {
      endpoints.push(`${container.ipv4[0]}:${port}`);
    }
  }
  return unique(endpoints);
}

export function hasLocalKey(system: SshSystem, endpoint: SshEndpoint): boolean {
  if (system.env["SSH_AUTH_SOCK"]) {
    return true;
  }
  const candidates = ["id_ed25519", "id_ecdsa", "id_rsa"].map((name) => path.join(system.homeDir, ".ssh", name));
  return [...(endpoint.identityFile === null ? [] : [endpoint.identityFile]), ...candidates].some((file) =>
    system.fileExists(file),
  );
}

type TunnelAttempt =
  | { readonly kind: "device" | "unauthorized"; readonly tunnel: Tunnel; readonly listed: TargetInfo }
  | { readonly kind: "refused" }
  | { readonly kind: "failed"; readonly missing: MissingPrerequisite };

interface AdbAttempt {
  readonly state: "device" | "unauthorized" | null;
  readonly tunnel: Tunnel | null;
  readonly listed: TargetInfo | null;
  readonly missing: readonly MissingPrerequisite[];
}

interface AttachAttempt {
  readonly route: AttachRoute | null;
  readonly container: ContainerFacts | null;
  readonly apiLevel: number | null;
  readonly missing: readonly MissingPrerequisite[];
}

export interface HostProberDeps {
  readonly runner: SshCommandRunner;
  readonly adb: AdbTransport;
  readonly system: SshSystem;
}

/**
 * Runs the detection order for one host. Each step gates the next, and a step
 * that fails records the prerequisite it found missing instead of throwing, so
 * a listing can report every host it saw.
 */
export class HostProber {
  private readonly deps: HostProberDeps;

  constructor(deps: HostProberDeps) {
    this.deps = deps;
  }

  async probe(settings: SshHostSettings, interfaceProblems: readonly MissingPrerequisite[]): Promise<HostDiagnosis> {
    const { runner, system } = this.deps;
    const endpoint = endpointOf(settings);
    const targetId = `ssh:${sshSerial(endpoint)}`;

    const tcp = await system.tcpConnect(endpoint.host, endpoint.port, TCP_PROBE_TIMEOUT_MS);
    if (tcp.kind === "refused") {
      return { ...NOTHING_LEARNED, blockers: [developerMode(endpoint)] };
    }
    if (tcp.kind !== "open") {
      const detail = tcp.kind === "timeout" ? `no answer within ${TCP_PROBE_TIMEOUT_MS} ms` : tcp.message;
      return { ...NOTHING_LEARNED, blockers: [hostUnreachable(endpoint, detail, interfaceProblems)] };
    }

    const login = await runner.run(targetId, endpoint, hostShellCommand(LOGIN_PROBE_SCRIPT), {
      timeoutMs: SSH_PROBE_TIMEOUT_MS,
    });
    if (login.kind !== "ran" || login.timedOut || login.exitCode !== 0) {
      return { ...NOTHING_LEARNED, blockers: [this.loginFailure(endpoint, login)] };
    }
    const facts = parseLoginFacts(login.stdout.toString("utf8"));
    if (facts.android === "absent") {
      return { ...NOTHING_LEARNED, hostOs: facts.hostOs, blockers: [androidContainer(endpoint)] };
    }

    const tried = new Set<string>();
    let adb = await this.tryContainerAdb(targetId, endpoint, loginEndpoints(settings, facts), tried);
    if (adb.state === "device") {
      return {
        ...NOTHING_LEARNED,
        hostOs: facts.hostOs,
        tunnel: adb.tunnel,
        tunnelState: "device",
        adbTarget: adb.listed,
      };
    }

    const attach = await this.probeAttach(targetId, endpoint, settings, facts);
    if (adb.state === null && adb.missing[0]?.id !== "adb-client" && attach.container !== null) {
      const announced = containerEndpoints(attach.container, facts).filter((entry) => !tried.has(entry));
      if (announced.length > 0) {
        adb = await this.tryContainerAdb(targetId, endpoint, announced, tried);
      }
    }

    return {
      blockers: [],
      hostOs: facts.hostOs,
      tunnel: adb.tunnel,
      tunnelState: adb.state,
      adbTarget: adb.listed,
      adbMissing: adb.missing,
      attach: attach.route,
      attachChecked: true,
      attachMissing: attach.missing,
      container: attach.container,
      apiLevel: attach.apiLevel,
    };
  }

  /** Stops a tunnel's ssh process and removes its serial from the adb server. */
  async closeTunnel(tunnel: Tunnel): Promise<void> {
    if (!tunnel.closed) {
      tunnel.handle.kill("SIGTERM");
    }
    await this.deps.adb.disconnectTcp(tunnel.serial).catch(() => undefined);
  }

  private loginFailure(endpoint: SshEndpoint, outcome: SshOutcome): MissingPrerequisite {
    if (outcome.kind === "spawn-failed") {
      return sshClientMissing(this.deps.runner.sshPath, outcome.message);
    }
    if (outcome.timedOut) {
      return hostUnreachable(endpoint, `ssh did not finish within ${SSH_PROBE_TIMEOUT_MS} ms`);
    }
    return classifySshFailure(endpoint, outcome, hasLocalKey(this.deps.system, endpoint));
  }

  private async tryContainerAdb(
    targetId: string,
    endpoint: SshEndpoint,
    endpoints: readonly string[],
    tried: Set<string>,
  ): Promise<AdbAttempt> {
    const failed = (missing: MissingPrerequisite): AdbAttempt => ({
      state: null,
      tunnel: null,
      listed: null,
      missing: [missing],
    });
    if (endpoints.length === 0) {
      return failed(containerAdbDisabled(endpoint, [...tried]));
    }
    try {
      await this.deps.adb.listTargets();
    } catch (error) {
      return failed(adbClientMissing((error as Error).message));
    }

    let last: MissingPrerequisite | null = null;
    for (const containerEndpoint of endpoints) {
      tried.add(containerEndpoint);
      const attempt = await this.openTunnel(targetId, endpoint, containerEndpoint);
      if (attempt.kind === "device" || attempt.kind === "unauthorized") {
        return {
          state: attempt.kind,
          tunnel: attempt.tunnel,
          listed: attempt.listed,
          missing: attempt.kind === "device" ? [] : [containerAdbUnauthorized(endpoint, attempt.tunnel.serial)],
        };
      }
      last = attempt.kind === "failed" ? attempt.missing : null;
    }
    return failed(last ?? containerAdbDisabled(endpoint, [...tried]));
  }

  private async openTunnel(targetId: string, endpoint: SshEndpoint, containerEndpoint: string): Promise<TunnelAttempt> {
    const { adb, runner, system } = this.deps;
    const separator = containerEndpoint.lastIndexOf(":");
    const remote = {
      host: containerEndpoint.slice(0, separator),
      port: Number(containerEndpoint.slice(separator + 1)),
    };
    const localPort = await system.allocatePort();
    const { handle, argv } = runner.spawnForward(targetId, endpoint, localPort, remote);
    const tunnel: Tunnel = {
      localPort,
      serial: `127.0.0.1:${localPort}`,
      endpoint: containerEndpoint,
      handle,
      argv,
      closed: false,
      stderr: "",
    };
    handle.onStderr((chunk) => {
      tunnel.stderr += chunk;
    });
    handle.onClose(() => {
      tunnel.closed = true;
    });

    const readyBy = system.now() + FORWARD_READY_TIMEOUT_MS;
    for (;;) {
      if (tunnel.closed) {
        await this.closeTunnel(tunnel);
        return { kind: "failed", missing: sshForwarding(endpoint, containerEndpoint, tunnel.stderr) };
      }
      if ((await system.tcpConnect("127.0.0.1", localPort, FORWARD_POLL_MS)).kind === "open") {
        break;
      }
      if (system.now() >= readyBy) {
        await this.closeTunnel(tunnel);
        const detail =
          tunnel.stderr || `nothing listened on 127.0.0.1:${localPort} within ${FORWARD_READY_TIMEOUT_MS} ms`;
        return { kind: "failed", missing: sshForwarding(endpoint, containerEndpoint, detail) };
      }
      await system.delay(FORWARD_POLL_MS);
    }

    let output: string;
    try {
      output = (await adb.connectTcp(tunnel.serial)).output;
    } catch (error) {
      await this.closeTunnel(tunnel);
      return { kind: "failed", missing: containerAdbConnect(endpoint, containerEndpoint, (error as Error).message) };
    }

    // adb lists a fresh TCP device as offline until its handshake finishes, so the state is polled.
    const settleBy = system.now() + ADB_STATE_WAIT_MS;
    for (;;) {
      const listed = await this.listedTunnel(tunnel.serial);
      if (listed !== null && (listed.state === "device" || listed.state === "unauthorized")) {
        return { kind: listed.state, tunnel, listed };
      }
      if (tunnel.closed || system.now() >= settleBy) {
        break;
      }
      await system.delay(ADB_STATE_POLL_MS);
    }
    await this.closeTunnel(tunnel);
    // A server that forbids forwarding still lets the local listener open, then refuses each channel.
    if (/administratively prohibited/i.test(tunnel.stderr)) {
      return { kind: "failed", missing: sshForwarding(endpoint, containerEndpoint, tunnel.stderr) };
    }
    if (/connect failed|Connection refused/i.test(tunnel.stderr)) {
      return { kind: "refused" };
    }
    return { kind: "failed", missing: containerAdbConnect(endpoint, containerEndpoint, `${output} ${tunnel.stderr}`) };
  }

  private async listedTunnel(serial: string): Promise<TargetInfo | null> {
    try {
      return (await this.deps.adb.listTargets()).find((target) => target.serial === serial) ?? null;
    } catch {
      return null;
    }
  }

  private async probeAttach(
    targetId: string,
    endpoint: SshEndpoint,
    settings: SshHostSettings,
    facts: LoginFacts,
  ): Promise<AttachAttempt> {
    const { runner } = this.deps;
    const unavailable = (missing: MissingPrerequisite): AttachAttempt => ({
      route: null,
      container: null,
      apiLevel: null,
      missing: [missing],
    });

    let session = endpoint;
    let rootPrefix: readonly string[] = [];
    let rootVia: AttachRoute["rootVia"] = "login-root";
    if (facts.uid !== 0 && facts.sudo) {
      rootPrefix = ["sudo", "-n"];
      rootVia = "sudo";
    } else if (facts.uid !== 0) {
      const rootEndpoint = { ...endpoint, user: "root" };
      const probe = await runner.run(targetId, rootEndpoint, "true", { timeoutMs: SSH_PROBE_TIMEOUT_MS });
      if (probe.kind !== "ran" || probe.timedOut || probe.exitCode !== 0) {
        return unavailable(rootAccess(endpoint, facts.home));
      }
      session = rootEndpoint;
      rootVia = "root-login";
    }

    // A configured command replaces detection rather than joining it.
    const candidates: AttachCandidate[] =
      settings.attachCommand === null
        ? facts.attachHelpers.map((helper) => ({ id: `helper:${helper}`, argv: [helper] }))
        : [{ id: "configured", argv: settings.attachCommand }];
    const probeLxc = settings.attachCommand === null && facts.lxc;
    if (candidates.length === 0 && !probeLxc) {
      return unavailable(attachCommandMissing(endpoint, []));
    }

    const run = await runner.run(
      targetId,
      session,
      hostShellCommand(attachProbeScript(candidates, probeLxc), rootPrefix),
      {
        timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
      },
    );
    if (run.kind !== "ran" || run.timedOut || run.exitCode !== 0) {
      const detail = run.kind === "ran" ? `probe exited ${run.exitCode}: ${run.stderr}` : run.message;
      return unavailable(attachCommandMissing(endpoint, [], detail));
    }
    const results = parseAttachResults(run.stdout.toString("utf8"), candidates);
    const verified = results.find((result) => result.exitCode === 0 && /^\d+$/.test(result.firstLine));
    if (verified === undefined) {
      return unavailable(
        attachCommandMissing(
          endpoint,
          results.map((result) => ({
            command: result.candidate.argv.join(" "),
            exitCode: result.exitCode,
            output: result.firstLine,
          })),
        ),
      );
    }

    const route: AttachRoute = { session, rootPrefix, rootVia, attachCommand: verified.candidate.argv };
    const factsRun = await runner.run(
      targetId,
      session,
      containerCommand(rootPrefix, route.attachCommand, CONTAINER_FACTS_ARGV),
      { timeoutMs: SSH_PROBE_TIMEOUT_MS, stdin: `${STDIN_PROBE}\n` },
    );
    const container =
      factsRun.kind === "ran" && factsRun.exitCode === 0 ? parseContainerFacts(factsRun.stdout.toString("utf8")) : null;
    return { route, container, apiLevel: Number(verified.firstLine), missing: [] };
  }
}
