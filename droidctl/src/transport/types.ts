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
  /** Decided by the backend, not by the caller regexing its stdout. */
  readonly installed: boolean;
  /** Set when the backend recognised a signature mismatch on reinstall. */
  readonly signatureMismatch?: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly argv: readonly string[];
}

/**
 * What to forward to, described rather than spelled in one transport's grammar.
 * adb renders this as `localabstract:<name>`; another backend tunnels it its own way.
 */
export type RemoteEndpoint =
  { readonly kind: "abstractSocket"; readonly name: string } | { readonly kind: "tcp"; readonly port: number };

export interface DetachedHandle {
  readonly argv: readonly string[];
  /**
   * Ends the detached command. "graceful" must let the tool flush its output;
   * how that is delivered is the backend's business.
   */
  stop(mode: "graceful" | "immediate"): Promise<{ stderr: string; code: number | null; timedOut?: boolean }>;
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
  forwardPort(target: ResolvedTarget, localPort: number, remote: RemoteEndpoint): Promise<void>;
  removeForward(target: ResolvedTarget, localPort: number): Promise<void>;
  capabilities(): TransportCapabilities;
}
