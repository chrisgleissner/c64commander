/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ToolExecutionError } from "../tools/errors.js";
import { quoteForRemoteShell } from "./adb.js";

export const SSH_CONNECT_TIMEOUT_SEC = 5;
export const SSH_CONTROL_PERSIST_SEC = 300;
export const DEFAULT_SSH_PORT = 22;
export const CONTAINER_SHELL = "/system/bin/sh";

export interface SshEndpoint {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly identityFile: string | null;
}

export function sshDestination(endpoint: SshEndpoint): string {
  return `${endpoint.user}@${endpoint.host}`;
}

/** The serial an ssh target is listed under; the port appears only when it is not 22. */
export function sshSerial(endpoint: SshEndpoint): string {
  const destination = sshDestination(endpoint);
  return endpoint.port === DEFAULT_SSH_PORT ? destination : `${destination}:${endpoint.port}`;
}

/** Options every ssh invocation carries. BatchMode means a missing key fails instead of prompting. */
function commonOptions(endpoint: SshEndpoint, controlPath: string | null): string[] {
  const multiplexing =
    controlPath === null
      ? ["-o", "ControlMaster=no", "-o", "ControlPath=none"]
      : [
          "-o",
          "ControlMaster=auto",
          "-o",
          `ControlPath=${controlPath}`,
          "-o",
          `ControlPersist=${SSH_CONTROL_PERSIST_SEC}`,
        ];
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=2",
    ...multiplexing,
    ...(endpoint.identityFile === null ? [] : ["-i", endpoint.identityFile, "-o", "IdentitiesOnly=yes"]),
    "-p",
    String(endpoint.port),
  ];
}

/**
 * The single builder for a command run over ssh. `--` precedes the destination so
 * a remote command starting with a dash cannot be read as an ssh option, and `-T`
 * keeps a binary payload such as a PNG free of terminal newline translation.
 */
export function sshRunArgs(
  endpoint: SshEndpoint,
  controlPath: string | null,
  remoteCommand: string,
  withStdin: boolean,
): string[] {
  if (remoteCommand.trim().length === 0) {
    throw new ToolExecutionError("An ssh invocation requires a non-empty remote command.", {
      details: { destination: sshDestination(endpoint) },
    });
  }
  return [
    ...commonOptions(endpoint, controlPath),
    "-T",
    ...(withStdin ? [] : ["-n"]),
    "--",
    sshDestination(endpoint),
    remoteCommand,
  ];
}

/** A dedicated connection per tunnel, so its lifetime is the lifetime of this one process. */
export function sshForwardArgs(
  endpoint: SshEndpoint,
  localPort: number,
  remote: { host: string; port: number },
): string[] {
  return [
    ...commonOptions(endpoint, null),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `127.0.0.1:${localPort}:${remote.host}:${remote.port}`,
    "--",
    sshDestination(endpoint),
  ];
}

export function sshControlCheckArgs(endpoint: SshEndpoint, controlPath: string): string[] {
  return [
    "-o",
    `ControlPath=${controlPath}`,
    "-O",
    "check",
    "-p",
    String(endpoint.port),
    "--",
    sshDestination(endpoint),
  ];
}

/** `ssh -O check` prints `Master running (pid=N)`; the pid identifies one connection. */
export function parseMasterPid(output: string): number | null {
  const match = /pid=(\d+)/.exec(output);
  return match ? Number(match[1]) : null;
}

/** A script for the phone's own shell, as one pre-quoted remote command line. */
export function hostShellCommand(script: string, rootPrefix: readonly string[] = []): string {
  return [...rootPrefix, "sh", "-c", script].map(quoteForRemoteShell).join(" ");
}

/*
 * An attach command that does not carry Android's boot environment leaves am, pm,
 * wm and input without ANDROID_DATA or BOOTCLASSPATH. Each variable the session
 * lacks is taken from init.environ.rc; one already set is kept as it is.
 */
export const CONTAINER_ENVIRONMENT =
  'for e in /init.environ.rc /system/etc/init/hw/init.environ.rc; do [ -r "$e" ] || continue; ' +
  'while read -r k n v; do if [ "$k" = export ] && [ -z "$(eval "echo \\${$n:-}")" ]; then export "$n=$v"; fi; ' +
  'done < "$e"; break; done;';

/**
 * Two shells re-split this line: the phone's login shell, then the container's.
 * The Android argv is quoted for the inner one exactly as `adb shell` quotes it,
 * and the whole attach invocation is quoted again for the outer one.
 */
export function containerCommand(
  rootPrefix: readonly string[],
  attachCommand: readonly string[],
  argv: readonly string[],
): string {
  if (argv.length === 0) {
    throw new ToolExecutionError("A container command requires a non-empty argument vector.", {
      details: { attachCommand: [...attachCommand] },
    });
  }
  const androidLine = `${CONTAINER_ENVIRONMENT} ${argv.map(quoteForRemoteShell).join(" ")}`;
  return [...rootPrefix, ...attachCommand, CONTAINER_SHELL, "-c", androidLine].map(quoteForRemoteShell).join(" ");
}

/*
 * Runs as the login user and needs no root. system_server is looked for in the
 * host's process table, which shows the container's processes; a /proc mounted
 * with hidepid hides them, which is reported as hidden rather than as stopped.
 * Listening sockets come from /proc/net because `ss` is not guaranteed to exist.
 */
export const LOGIN_PROBE_SCRIPT = [
  'echo "uid=$(id -u)"',
  'echo "home=$HOME"',
  'if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then echo "sudo=1"; else echo "sudo=0"; fi',
  'if grep -qsx system_server /proc/[0-9]*/comm; then echo "android=running"; elif [ ! -r /proc/1/comm ]; then echo "android=hidden"; fi',
  'awk \'$4 == "0A" { print "listen=" $2 }\' /proc/net/tcp /proc/net/tcp6 2>/dev/null',
  'for f in /usr/bin/*-attach /usr/sbin/*-attach /bin/*-attach /sbin/*-attach; do [ -x "$f" ] && echo "helper=$f"; done',
  'if command -v lxc-attach >/dev/null 2>&1; then echo "lxc=1"; fi',
  '(. /etc/os-release 2>/dev/null && echo "os=$PRETTY_NAME")',
  "exit 0",
].join("\n");

export function parseKeyValueLines(stdout: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator);
    values.set(key, [...(values.get(key) ?? []), line.slice(separator + 1)]);
  }
  return values;
}

export interface TcpListener {
  readonly address: string;
  readonly port: number;
  /** Bound to every address or to loopback, so the phone's own 127.0.0.1 reaches it. */
  readonly local: boolean;
}

/**
 * /proc/net/tcp prints an IPv4 address as the host-order hex of the in_addr, which
 * on the little-endian CPUs phones and desktops use is the dotted quad reversed.
 * An IPv6 listener is kept only when it is the wildcard or loopback address.
 */
export function parseProcNetListener(entry: string): TcpListener | null {
  const match = /^([0-9A-Fa-f]{8}|[0-9A-Fa-f]{32}):([0-9A-Fa-f]{4})$/.exec(entry.trim());
  if (!match) {
    return null;
  }
  const hex = match[1]!.toUpperCase();
  const port = Number.parseInt(match[2]!, 16);
  if (hex.length === 32) {
    const local = hex === "0".repeat(32) || hex === "00000000000000000000000001000000";
    return local ? { address: "127.0.0.1", port, local: true } : null;
  }
  const octets = [6, 4, 2, 0].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const address = octets.join(".");
  return { address, port, local: address === "0.0.0.0" || octets[0] === 127 };
}

export interface LoginFacts {
  readonly uid: number | null;
  readonly home: string | null;
  readonly sudo: boolean;
  /** hidden: /proc does not show other users' processes, so the container state is unknown. */
  readonly android: "running" | "hidden" | "absent";
  readonly listeners: readonly TcpListener[];
  readonly attachHelpers: readonly string[];
  readonly lxc: boolean;
  readonly hostOs: string | null;
}

export function parseLoginFacts(stdout: string): LoginFacts {
  const values = parseKeyValueLines(stdout);
  const first = (key: string): string | null => values.get(key)?.[0] ?? null;
  const uid = first("uid");
  return {
    uid: uid !== null && /^\d+$/.test(uid) ? Number(uid) : null,
    home: first("home") || null,
    sudo: first("sudo") === "1",
    android: first("android") === "running" ? "running" : first("android") === "hidden" ? "hidden" : "absent",
    listeners: (values.get("listen") ?? [])
      .map(parseProcNetListener)
      .filter((listener): listener is TcpListener => listener !== null),
    attachHelpers: [...new Set(values.get("helper") ?? [])].filter((helper) => !/(^|\/)lxc-attach$/.test(helper)),
    lxc: first("lxc") === "1",
    hostOs: first("os") || null,
  };
}

export interface AttachCandidate {
  readonly id: string;
  readonly argv: readonly string[];
}

/**
 * Verifies each candidate by what it prints, not by its exit code: a candidate
 * counts only when getprop run through it returns an integer SDK level.
 */
export function attachProbeScript(candidates: readonly AttachCandidate[], probeLxc: boolean): string {
  const lines = [
    'T=""; if command -v timeout >/dev/null 2>&1; then T="timeout 15"; fi',
    "check() {",
    '  id=$1; shift; out=$($T "$@" /system/bin/getprop ro.build.version.sdk </dev/null 2>&1); code=$?',
    '  printf "candidate=%s|%s|%s\\n" "$id" "$code" "$(printf "%s\\n" "$out" | head -n 1)"',
    "}",
    ...candidates.map((candidate) => ["check", candidate.id, ...candidate.argv].map(quoteForRemoteShell).join(" ")),
  ];
  if (probeLxc) {
    // "[lxc monitor] <lxcpath> <name>" is a monitor's title; it finds a container outside the default path.
    lines.push(
      'for f in $(grep -ls "^\\[lxc monitor\\]" /proc/[0-9]*/cmdline); do',
      '  set -f; set -- $(tr "\\000" " " < "$f"); set +f; check "lxc:$4@$3" lxc-attach -P "$3" -n "$4" --',
      "done",
      'if command -v lxc-ls >/dev/null 2>&1; then for n in $(lxc-ls -1 --running 2>/dev/null); do check "lxc:$n" lxc-attach -n "$n" --; done; fi',
    );
  }
  lines.push("exit 0");
  return lines.join("\n");
}

export interface AttachResult {
  readonly candidate: AttachCandidate;
  readonly exitCode: number;
  readonly firstLine: string;
}

export function parseAttachResults(stdout: string, candidates: readonly AttachCandidate[]): AttachResult[] {
  const results: AttachResult[] = [];
  for (const value of parseKeyValueLines(stdout).get("candidate") ?? []) {
    const match = /^([^|]+)\|(\d+)\|(.*)$/.exec(value);
    if (!match) {
      continue;
    }
    const id = match[1]!;
    const known = candidates.find((candidate) => candidate.id === id);
    const lxc = /^lxc:([^@]+)(?:@(.+))?$/.exec(id);
    const lxcArgv = lxc ? ["lxc-attach", ...(lxc[2] ? ["-P", lxc[2]] : []), "-n", lxc[1]!, "--"] : null;
    const candidate = known ?? (lxcArgv ? { id, argv: lxcArgv } : null);
    if (candidate) {
      results.push({ candidate, exitCode: Number(match[2]), firstLine: match[3]!.trim() });
    }
  }
  return results;
}

/** Sent on stdin with the facts command; reading it back proves the attach command passes stdin through. */
export const STDIN_PROBE = "droidctl-stdin-check";

/** Run inside the container once the attach route works, to find adb ports it announces. */
export const CONTAINER_FACTS_ARGV: readonly string[] = [
  "sh",
  "-c",
  [
    'read -r probe; echo "stdin=$probe"',
    'echo "model=$(getprop ro.product.model)"',
    'echo "boot=$(getprop sys.boot_completed)"',
    'echo "adbport=$(getprop service.adb.tcp.port)"',
    'echo "adbport=$(getprop persist.adb.tcp.port)"',
    "ip -4 -o addr show scope global 2>/dev/null | awk '{ print \"inet=\" $4 }'",
  ].join("; "),
];

export interface ContainerFacts {
  readonly model: string | null;
  readonly bootCompleted: boolean;
  readonly adbPorts: readonly number[];
  readonly ipv4: readonly string[];
  readonly stdinPassthrough: boolean;
}

export function parseContainerFacts(stdout: string): ContainerFacts {
  const values = parseKeyValueLines(stdout);
  const ports = (values.get("adbport") ?? [])
    .map((value) => Number.parseInt(value, 10))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  return {
    model: values.get("model")?.[0] || null,
    bootCompleted: values.get("boot")?.[0] === "1",
    adbPorts: [...new Set(ports)],
    ipv4: (values.get("inet") ?? []).map((cidr) => cidr.split("/")[0]!).filter((address) => address.length > 0),
    stdinPassthrough: values.get("stdin")?.[0] === STDIN_PROBE,
  };
}
