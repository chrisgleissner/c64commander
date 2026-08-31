/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type TransportKind = "adb" | "ssh";

export type TargetState = "device" | "offline" | "unauthorized" | "booting" | "unknown";

export interface TargetInfo {
  /** Opaque id issued by list_targets. Encodes the transport (spec §6.3 rule 2). */
  readonly targetId: string;
  readonly transport: TransportKind;
  readonly serial: string;
  readonly model: string | null;
  readonly apiLevel: number | null;
  readonly state: TargetState;
  readonly isEmulator: boolean;
}

export interface ResolvedTarget {
  readonly targetId: string;
  readonly transport: TransportKind;
  readonly serial: string;
}

export type ExecEncoding = "utf8" | "buffer";

export interface ExecOptions {
  readonly timeoutMs?: number;
  readonly stdin?: string;
  readonly maxBytes?: number;
  readonly encoding?: ExecEncoding;
  /** Fail the call when the command exits non-zero, instead of returning the result. */
  readonly throwOnNonZeroExit?: boolean;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly stdoutBytes: Buffer;
  readonly truncated: boolean;
  readonly durationMs: number;
  /** The transport-level argument vector actually run, for the command journal. */
  readonly argv: readonly string[];
}

export interface InstallOptions {
  readonly reinstall?: boolean;
  readonly allowDowngrade?: boolean;
  readonly grantPermissions?: boolean;
  readonly allowTestPackages?: boolean;
  readonly timeoutMs?: number;
}

export interface InstallResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly argv: readonly string[];
}

export interface DetachedHandle {
  readonly argv: readonly string[];
  /** Signals the local child, waits for it to close, and returns what it wrote to stderr. */
  stop(signal: NodeJS.Signals): Promise<{ stderr: string; code: number | null }>;
}

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export interface TransportCapabilities {
  readonly transport: TransportKind;
  readonly tools: Readonly<Record<string, CapabilitySupport>>;
  /** Free text naming the check that would settle an "unknown" entry. */
  readonly notes: Readonly<Record<string, string>>;
}

export interface CommandRecord {
  readonly timestamp: string;
  readonly targetId: string | null;
  readonly transport: TransportKind;
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly bytesOut: number;
}

export type CommandSink = (record: CommandRecord) => void;

export interface Transport {
  readonly kind: TransportKind;
  listTargets(): Promise<TargetInfo[]>;
  exec(target: ResolvedTarget, argv: readonly string[], opts?: ExecOptions): Promise<ExecResult>;
  spawnShell(target: ResolvedTarget, argv: readonly string[]): DetachedHandle;
  pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer>;
  pullFile(target: ResolvedTarget, remotePath: string, localPath: string): Promise<number>;
  pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<number>;
  installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<InstallResult>;
  forwardPort(target: ResolvedTarget, localPort: number, remote: string): Promise<void>;
  removeForward(target: ResolvedTarget, localPort: number): Promise<void>;
  capabilities(): TransportCapabilities;
}
