/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";
import { nowIso } from "../types.js";
import { DEFAULT_MAX_BYTES, type RawExecRunner, type RawSpawnHandle, type RawSpawnRunner } from "./adb.js";
import { type SshEndpoint, parseMasterPid, sshControlCheckArgs, sshForwardArgs, sshRunArgs } from "./sshCommands.js";
import type { SshSystem } from "./sshDiscovery.js";
import type { CommandSink } from "./types.js";

/*
 * A Unix socket path is limited to 108 bytes. `%C` expands to 40 hex characters,
 * and ssh first binds a temporary name with 17 more before renaming it.
 */
export const MAX_CONTROL_DIR_LENGTH = 48;
export const CONTROL_CHECK_TIMEOUT_MS = 5_000;

export type SshOutcome =
  | {
      readonly kind: "ran";
      readonly stdout: Buffer;
      readonly stderr: string;
      readonly exitCode: number;
      readonly timedOut: boolean;
      readonly durationMs: number;
      readonly argv: readonly string[];
    }
  | { readonly kind: "spawn-failed"; readonly message: string; readonly argv: readonly string[] };

export interface SshRunOptions {
  readonly timeoutMs: number;
  readonly maxBytes?: number;
  readonly stdin?: string | Buffer;
}

export interface SshRunnerOptions {
  readonly sshPath: string;
  readonly exec: RawExecRunner;
  readonly spawn: RawSpawnRunner;
  readonly system: SshSystem;
  /** Where multiplexing sockets live; null turns multiplexing off. */
  readonly controlDir: string | null;
  readonly onCommand?: CommandSink;
}

/**
 * Every ssh invocation goes through here, so each one is journalled and carries
 * the same options. A multiplexed master keeps a repeated call to a few ms, which
 * matters because every tool call lists targets again.
 */
export class SshCommandRunner {
  readonly sshPath: string;
  private readonly options: SshRunnerOptions;
  private controlPathDecision: { value: string | null } | null = null;

  constructor(options: SshRunnerOptions) {
    this.options = options;
    this.sshPath = options.sshPath;
  }

  /** Decided once: a directory another user could write to would let them join the session. */
  controlPath(): string | null {
    if (this.controlPathDecision === null) {
      const directory = this.options.controlDir;
      const usable =
        directory !== null &&
        directory.length <= MAX_CONTROL_DIR_LENGTH &&
        this.options.system.ensurePrivateDir(directory);
      this.controlPathDecision = { value: usable ? path.join(directory, "%C") : null };
    }
    return this.controlPathDecision.value;
  }

  async run(
    targetId: string | null,
    endpoint: SshEndpoint,
    remoteCommand: string,
    opts: SshRunOptions,
  ): Promise<SshOutcome> {
    const args = sshRunArgs(endpoint, this.controlPath(), remoteCommand, opts.stdin !== undefined);
    const argv = [this.sshPath, ...args];
    const startedAt = Date.now();
    try {
      const outcome = await this.options.exec({
        file: this.sshPath,
        args,
        timeoutMs: opts.timeoutMs,
        maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
        ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
      });
      const durationMs = Date.now() - startedAt;
      this.record(targetId, argv, outcome.exitCode, durationMs, outcome.stdout.length);
      return {
        kind: "ran",
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut === true,
        durationMs,
        argv,
      };
    } catch (error) {
      this.record(targetId, argv, null, Date.now() - startedAt, 0);
      return { kind: "spawn-failed", message: error instanceof Error ? error.message : String(error), argv };
    }
  }

  /** The pid of the live multiplexing master for this destination, or null when there is none. */
  async masterPid(targetId: string | null, endpoint: SshEndpoint): Promise<number | null> {
    const controlPath = this.controlPath();
    if (controlPath === null) {
      return null;
    }
    const args = sshControlCheckArgs(endpoint, controlPath);
    try {
      const outcome = await this.options.exec({
        file: this.sshPath,
        args,
        timeoutMs: CONTROL_CHECK_TIMEOUT_MS,
        maxBytes: 64 * 1024,
      });
      this.record(targetId, [this.sshPath, ...args], outcome.exitCode, 0, outcome.stdout.length);
      return outcome.exitCode === 0 ? parseMasterPid(`${outcome.stdout.toString("utf8")}${outcome.stderr}`) : null;
    } catch {
      return null;
    }
  }

  spawnForward(
    targetId: string | null,
    endpoint: SshEndpoint,
    localPort: number,
    remote: { host: string; port: number },
  ): { handle: RawSpawnHandle; argv: readonly string[] } {
    const args = sshForwardArgs(endpoint, localPort, remote);
    const argv = [this.sshPath, ...args];
    this.record(targetId, argv, null, 0, 0);
    return { handle: this.options.spawn({ file: this.sshPath, args }), argv };
  }

  private record(
    targetId: string | null,
    argv: readonly string[],
    exitCode: number | null,
    durationMs: number,
    bytesOut: number,
  ): void {
    this.options.onCommand?.({ timestamp: nowIso(), targetId, transport: "ssh", argv, exitCode, durationMs, bytesOut });
  }
}
