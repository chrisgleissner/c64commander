/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ToolExecutionError } from "../tools/errors.js";
import { ALL_TOOL_NAMES } from "../tools/toolNames.js";
import type {
  CapabilitySupport,
  DetachedHandle,
  ExecOptions,
  ExecResult,
  InstallOptions,
  InstallResult,
  RemoteEndpoint,
  ResolvedTarget,
  TargetInfo,
  Transport,
  TransportCapabilities,
  TransportKind,
} from "./types.js";

export interface FakeExecReply {
  readonly stdout?: string;
  readonly stdoutBytes?: Buffer;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly throws?: Error;
}

export type FakeExecResponder = (argv: readonly string[], target: ResolvedTarget) => FakeExecReply | undefined;

export interface FakeCall {
  readonly kind: "exec" | "spawn" | "pull" | "push" | "install" | "forward" | "removeForward" | "listTargets";
  readonly targetId: string | null;
  readonly argv: readonly string[];
}

/**
 * Scripted transport used by every tool-module test. It records each call so a
 * test asserts on the sequence of device operations, not only on the result.
 */
export class FakeTransport implements Transport {
  readonly calls: FakeCall[] = [];
  readonly pushed: { localPath: string; remotePath: string }[] = [];
  readonly pulled: { remotePath: string; localPath: string }[] = [];
  readonly forwards: { localPort: number; remote: string }[] = [];
  readonly spawned: { argv: readonly string[]; stopSignals: ("graceful" | "immediate")[] }[] = [];

  kind: TransportKind = "adb";
  toolSupport: Record<string, CapabilitySupport> = Object.fromEntries(
    ALL_TOOL_NAMES.map((name) => [name, "supported" as CapabilitySupport]),
  );
  notes: Record<string, string> = {};
  targets: TargetInfo[];
  installResult: InstallResult = {
    installed: true,
    stdout: "Success\n",
    stderr: "",
    exitCode: 0,
    argv: ["adb", "install"],
  };
  spawnStopStderr = "";
  pullPayloads = new Map<string, Buffer>();
  listTargetsError: Error | null = null;
  private readonly responders: FakeExecResponder[] = [];

  constructor(targets: TargetInfo[] = [defaultTarget()]) {
    this.targets = targets;
  }

  /** Later responders win, so a test can override an earlier default. */
  respond(responder: FakeExecResponder): this {
    this.responders.unshift(responder);
    return this;
  }

  respondTo(match: string | RegExp, reply: FakeExecReply): this {
    const test = (line: string) => (typeof match === "string" ? line.includes(match) : match.test(line));
    return this.respond((argv) => (test(argv.join(" ")) ? reply : undefined));
  }

  execArgvLines(): string[] {
    return this.calls.filter((call) => call.kind === "exec").map((call) => call.argv.join(" "));
  }

  /** Mirrors a real backend: every tool it can serve is listed explicitly. */
  capabilities(): TransportCapabilities {
    return { transport: this.kind, tools: { ...this.toolSupport }, notes: { ...this.notes } };
  }

  async listTargets(): Promise<TargetInfo[]> {
    this.calls.push({ kind: "listTargets", targetId: null, argv: ["devices", "-l"] });
    if (this.listTargetsError) {
      throw this.listTargetsError;
    }
    return this.targets;
  }

  async exec(target: ResolvedTarget, argv: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    this.calls.push({ kind: "exec", targetId: target.targetId, argv });
    const reply =
      this.responders.map((responder) => responder(argv, target)).find((value) => value !== undefined) ?? {};
    if (reply.throws) {
      throw reply.throws;
    }
    const raw = reply.stdoutBytes ?? Buffer.from(reply.stdout ?? "", "utf8");
    const truncated = opts.maxBytes !== undefined && raw.length > opts.maxBytes;
    const stdoutBytes = truncated ? raw.subarray(0, opts.maxBytes) : raw;
    const exitCode = reply.exitCode ?? 0;
    if (opts.throwOnNonZeroExit && exitCode !== 0) {
      throw new ToolExecutionError(`Command failed on ${target.targetId}: ${argv.join(" ")}`, {
        details: { exitCode, stderr: reply.stderr ?? "", argv: [...argv] },
      });
    }
    return {
      stdout: opts.encoding === "buffer" ? "" : stdoutBytes.toString("utf8"),
      stderr: reply.stderr ?? "",
      exitCode,
      stdoutBytes,
      truncated,
      durationMs: 1,
      argv: ["adb", "-s", target.serial, ...argv],
    };
  }

  spawnShell(target: ResolvedTarget, argv: readonly string[]): DetachedHandle {
    this.calls.push({ kind: "spawn", targetId: target.targetId, argv });
    const entry = { argv, stopSignals: [] as ("graceful" | "immediate")[] };
    this.spawned.push(entry);
    return {
      argv: ["adb", "-s", target.serial, "shell", ...argv],
      stop: async (mode) => {
        entry.stopSignals.push(mode);
        return { stderr: this.spawnStopStderr, code: 0 };
      },
    };
  }

  async pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer> {
    this.calls.push({ kind: "pull", targetId: target.targetId, argv: ["pull", remotePath] });
    const payload = this.pullPayloads.get(remotePath);
    if (!payload) {
      throw new ToolExecutionError(`Nothing to pull at ${remotePath}.`, { details: { remotePath } });
    }
    return payload;
  }

  async pullFile(target: ResolvedTarget, remotePath: string, localPath: string): Promise<number> {
    const payload = await this.pullBinary(target, remotePath);
    this.pulled.push({ remotePath, localPath });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(localPath, payload);
    return payload.length;
  }

  async pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<number> {
    this.calls.push({ kind: "push", targetId: target.targetId, argv: ["push", localPath, remotePath] });
    this.pushed.push({ localPath, remotePath });
    const { stat } = await import("node:fs/promises");
    const info = await stat(localPath);
    return info.size;
  }

  async installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<InstallResult> {
    const flags: string[] = [];
    if (opts.reinstall !== false) flags.push("-r");
    if (opts.allowDowngrade) flags.push("-d");
    if (opts.grantPermissions) flags.push("-g");
    if (opts.allowTestPackages) flags.push("-t");
    this.calls.push({ kind: "install", targetId: target.targetId, argv: ["install", ...flags, apkPath] });
    return this.installResult;
  }

  async forwardPort(target: ResolvedTarget, localPort: number, remote: RemoteEndpoint): Promise<void> {
    const spec = remote.kind === "abstractSocket" ? `localabstract:${remote.name}` : `tcp:${remote.port}`;
    this.calls.push({ kind: "forward", targetId: target.targetId, argv: ["forward", `tcp:${localPort}`, spec] });
    this.forwards.push({ localPort, remote: spec });
  }

  async removeForward(target: ResolvedTarget, localPort: number): Promise<void> {
    this.calls.push({
      kind: "removeForward",
      targetId: target.targetId,
      argv: ["forward", "--remove", `tcp:${localPort}`],
    });
  }
}

export function defaultTarget(overrides: Partial<TargetInfo> = {}): TargetInfo {
  return {
    targetId: "adb:TESTSERIAL01",
    transport: "adb",
    serial: "TESTSERIAL01",
    model: "Pixel_4",
    apiLevel: 33,
    state: "device",
    isEmulator: false,
    ...overrides,
  };
}
