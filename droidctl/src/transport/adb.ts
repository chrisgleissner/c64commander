/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { ToolExecutionError } from "../tools/errors.js";
import { nowIso } from "../types.js";
import type {
  CommandSink,
  DetachedHandle,
  ExecOptions,
  ExecResult,
  InstallOptions,
  InstallResult,
  ResolvedTarget,
  TargetInfo,
  TargetState,
  Transport,
  TransportCapabilities,
} from "./types.js";

export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The single argument builder. Pure so a test can assert `-s <serial>` is always
 * first (spec §6.3 rule 6); every adb call in this file goes through it.
 */
export function adbArgs(serial: string, rest: readonly string[]): string[] {
  if (typeof serial !== "string" || serial.trim().length === 0) {
    throw new ToolExecutionError("An adb invocation requires a non-empty serial.", {
      details: { rest: [...rest] },
    });
  }
  return ["-s", serial, ...rest];
}

export interface RawExecOutcome {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface RawExecRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly stdin?: string;
}

export type RawExecRunner = (request: RawExecRequest) => Promise<RawExecOutcome>;

export interface RawSpawnRequest {
  readonly file: string;
  readonly args: readonly string[];
}

export interface RawSpawnHandle {
  kill(signal: NodeJS.Signals): void;
  onClose(listener: (code: number | null) => void): void;
  onStderr(listener: (chunk: string) => void): void;
}

export type RawSpawnRunner = (request: RawSpawnRequest) => RawSpawnHandle;

export const nodeExecRunner: RawExecRunner = (request) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      request.file,
      [...request.args],
      { timeout: request.timeoutMs, maxBuffer: request.maxBytes, encoding: "buffer" },
      (error, stdout, stderr) => {
        const stderrText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
        if (error && typeof (error as { code?: unknown }).code !== "number") {
          reject(error);
          return;
        }
        const exitCode = error ? Number((error as { code?: number }).code ?? 1) : 0;
        resolve({
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? "")),
          stderr: stderrText,
          exitCode,
        });
      },
    );
    if (request.stdin !== undefined) {
      child.stdin?.end(request.stdin);
    }
  });

export const nodeSpawnRunner: RawSpawnRunner = (request) => {
  const child = spawn(request.file, [...request.args], { stdio: ["ignore", "pipe", "pipe"] });
  return {
    kill(signal) {
      child.kill(signal);
    },
    onClose(listener) {
      child.once("close", (code) => listener(code));
    },
    onStderr(listener) {
      child.stderr?.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")));
    },
  };
};

export interface AdbTransportOptions {
  readonly adbPath?: string;
  readonly exec?: RawExecRunner;
  readonly spawn?: RawSpawnRunner;
  readonly onCommand?: CommandSink;
  readonly defaultTimeoutMs?: number;
}

const ADB_TOOL_SUPPORT: Readonly<Record<string, "supported">> = {
  "droid_target.list_targets": "supported",
  "droid_target.describe_target": "supported",
  "droid_app.install_app": "supported",
  "droid_app.uninstall_app": "supported",
  "droid_app.launch_app": "supported",
  "droid_app.stop_app": "supported",
  "droid_app.clear_app_data": "supported",
  "droid_app.write_app_file": "supported",
  "droid_app.read_app_file": "supported",
  "droid_input.tap": "supported",
  "droid_input.swipe": "supported",
  "droid_input.type_text": "supported",
  "droid_input.press_key": "supported",
  "droid_capture.screenshot": "supported",
  "droid_capture.ui_hierarchy": "supported",
  "droid_capture.start_recording": "supported",
  "droid_capture.stop_recording": "supported",
  "droid_capture.logcat": "supported",
  "droid_assert.assert_visible": "supported",
  "droid_assert.assert_not_visible": "supported",
  "droid_device.prepare_device": "supported",
  "droid_device.run_shell": "supported",
  "droid_device.forward_webview": "supported",
  "droid_device.push_file": "supported",
  "droid_device.pull_file": "supported",
};

export function parseAdbDevices(stdout: string): TargetInfo[] {
  const targets: TargetInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || /^List of devices/i.test(trimmed) || /^\*/.test(trimmed)) {
      continue;
    }
    const [serial, rawState, ...tail] = trimmed.split(/\s+/);
    if (!serial || !rawState) {
      continue;
    }
    const properties = new Map<string, string>();
    for (const entry of tail) {
      const separator = entry.indexOf(":");
      if (separator > 0) {
        properties.set(entry.slice(0, separator), entry.slice(separator + 1));
      }
    }
    targets.push({
      targetId: `adb:${serial}`,
      transport: "adb",
      serial,
      model: properties.get("model") ?? null,
      apiLevel: null,
      state: normalizeState(rawState),
      isEmulator: /^emulator-/.test(serial),
    });
  }
  return targets;
}

function normalizeState(raw: string): TargetState {
  switch (raw) {
    case "device":
      return "device";
    case "offline":
      return "offline";
    case "unauthorized":
      return "unauthorized";
    case "bootloader":
    case "recovery":
    case "sideload":
      return "booting";
    default:
      return "unknown";
  }
}

export class AdbTransport implements Transport {
  readonly kind = "adb" as const;
  private readonly adbPath: string;
  private readonly execRunner: RawExecRunner;
  private readonly spawnRunner: RawSpawnRunner;
  private readonly onCommand?: CommandSink;
  private readonly defaultTimeoutMs: number;

  constructor(options: AdbTransportOptions = {}) {
    this.adbPath = options.adbPath ?? "adb";
    this.execRunner = options.exec ?? nodeExecRunner;
    this.spawnRunner = options.spawn ?? nodeSpawnRunner;
    this.onCommand = options.onCommand;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  }

  capabilities(): TransportCapabilities {
    return { transport: "adb", tools: { ...ADB_TOOL_SUPPORT }, notes: {} };
  }

  async listTargets(): Promise<TargetInfo[]> {
    const outcome = await this.run(null, ["devices", "-l"], {});
    if (outcome.exitCode !== 0) {
      throw new ToolExecutionError(`adb devices failed with exit code ${outcome.exitCode}: ${outcome.stderr.trim()}`, {
        details: { exitCode: outcome.exitCode, stderr: outcome.stderr },
      });
    }
    return parseAdbDevices(outcome.stdout.toString("utf8"));
  }

  async exec(target: ResolvedTarget, argv: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    // `exec-out` keeps a binary payload byte-exact; `shell` would translate newlines
    // and corrupt a PNG (scripts/hil-screenshot-evidence.mjs:67-79).
    const channel = opts.encoding === "buffer" ? "exec-out" : "shell";
    const result = await this.invoke(target, [channel, ...argv], opts);
    if (opts.throwOnNonZeroExit && result.exitCode !== 0) {
      throw new ToolExecutionError(`Command failed on ${target.targetId}: ${argv.join(" ")}`, {
        details: { exitCode: result.exitCode, stderr: result.stderr, argv: [...argv] },
      });
    }
    return result;
  }

  spawnShell(target: ResolvedTarget, argv: readonly string[]): DetachedHandle {
    const args = adbArgs(target.serial, ["shell", ...argv]);
    const handle = this.spawnRunner({ file: this.adbPath, args });
    let stderr = "";
    handle.onStderr((chunk) => {
      stderr += chunk;
    });
    return {
      argv: [this.adbPath, ...args],
      stop: (signal) =>
        new Promise((resolve) => {
          handle.onClose((code) => resolve({ stderr, code }));
          handle.kill(signal);
        }),
    };
  }

  async pullBinary(target: ResolvedTarget, remotePath: string): Promise<Buffer> {
    const result = await this.invoke(target, ["exec-out", "cat", remotePath], { encoding: "buffer" });
    if (result.exitCode !== 0) {
      throw new ToolExecutionError(`Unable to read ${remotePath} from ${target.targetId}.`, {
        details: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }
    return result.stdoutBytes;
  }

  async pullFile(target: ResolvedTarget, remotePath: string, localPath: string): Promise<number> {
    const bytes = await this.pullBinary(target, remotePath);
    await writeFile(localPath, bytes);
    return bytes.length;
  }

  async pushFile(target: ResolvedTarget, localPath: string, remotePath: string): Promise<number> {
    const result = await this.invoke(target, ["push", localPath, remotePath], {});
    if (result.exitCode !== 0) {
      throw new ToolExecutionError(`adb push failed for ${localPath}: ${result.stderr.trim()}`, {
        details: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }
    const pushed = /(\d+) bytes/.exec(result.stdout);
    return pushed ? Number(pushed[1]) : 0;
  }

  async installPackage(target: ResolvedTarget, apkPath: string, opts: InstallOptions): Promise<InstallResult> {
    const flags: string[] = [];
    if (opts.reinstall !== false) flags.push("-r");
    if (opts.allowDowngrade) flags.push("-d");
    if (opts.grantPermissions) flags.push("-g");
    if (opts.allowTestPackages) flags.push("-t");
    const result = await this.invoke(target, ["install", ...flags, apkPath], {
      timeoutMs: opts.timeoutMs ?? 300_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, argv: result.argv };
  }

  async forwardPort(target: ResolvedTarget, localPort: number, remote: string): Promise<void> {
    const result = await this.invoke(target, ["forward", `tcp:${localPort}`, remote], {});
    if (result.exitCode !== 0) {
      throw new ToolExecutionError(`adb forward failed for tcp:${localPort}: ${result.stderr.trim()}`, {
        details: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }
  }

  async removeForward(target: ResolvedTarget, localPort: number): Promise<void> {
    await this.invoke(target, ["forward", "--remove", `tcp:${localPort}`], {});
  }

  private async invoke(target: ResolvedTarget | null, rest: readonly string[], opts: ExecOptions): Promise<ExecResult> {
    const outcome = await this.run(target, rest, opts);
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
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

  private async run(
    target: ResolvedTarget | null,
    rest: readonly string[],
    opts: ExecOptions,
  ): Promise<RawExecOutcome & { durationMs: number; argv: readonly string[] }> {
    const args = target ? adbArgs(target.serial, rest) : [...rest];
    const startedAt = Date.now();
    let outcome: RawExecOutcome;
    try {
      outcome = await this.execRunner({
        file: this.adbPath,
        args,
        timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
        maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
        ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
      });
    } catch (error) {
      this.record(target, args, null, Date.now() - startedAt, 0);
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolExecutionError(`adb ${rest.join(" ")} failed: ${message}`, {
        code: /timed out|ETIMEDOUT/i.test(message) ? "timeout" : "device_error",
        details: { argv: [this.adbPath, ...args] },
      });
    }
    const durationMs = Date.now() - startedAt;
    this.record(target, args, outcome.exitCode, durationMs, outcome.stdout.length);
    return { ...outcome, durationMs, argv: [this.adbPath, ...args] };
  }

  private record(
    target: ResolvedTarget | null,
    args: readonly string[],
    exitCode: number | null,
    durationMs: number,
    bytesOut: number,
  ): void {
    this.onCommand?.({
      timestamp: nowIso(),
      targetId: target?.targetId ?? null,
      transport: "adb",
      argv: [this.adbPath, ...args],
      exitCode,
      durationMs,
      bytesOut,
    });
  }
}
