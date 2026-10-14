/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Whether the container's window is the one the phone shows. The container can report an
 * activity resumed while the host compositor keeps its own home screen in front: the app then
 * receives no keys, and an Android screenshot still shows it. Only the host can tell, and only
 * the host can bring the container's window forward again.
 */

import type { HostWindowSettings } from "./sshConfig.js";
import { hostShellCommand, parseKeyValueLines } from "./sshCommands.js";

const RAISE_SETTLE_SEC = 1;

export interface HostWindowState {
  /** Whether the host was asked at all. When false, `reason` says why not. */
  readonly checked: boolean;
  /** Why the window could not be checked or told apart; null when it was. */
  readonly reason: string | null;
  /** False when the host's answer does not tell which window is in front. */
  readonly known: boolean;
  readonly containerInFront: boolean | null;
  /** True when the container's window was not in front and a raise was requested. */
  readonly raised: boolean;
  /** The topmost window's process, as the host reports it: pid and executable. */
  readonly topmost: string | null;
}

export function uncheckedHostWindow(reason: string): HostWindowState {
  return { checked: false, reason, known: false, containerInFront: null, raised: false, topmost: null };
}

/**
 * The container runtime's window bridge lives in the libexec directory named after its attach
 * helper, so `/usr/sbin/<stem>-attach` gives `<stem>`. A generic helper such as lxc-attach names
 * no runtime and gives nothing.
 */
export function runtimeStem(attachHelpers: readonly string[]): string | null {
  for (const helper of attachHelpers) {
    const stem = /([A-Za-z0-9_.]+)-attach$/.exec(helper)?.[1];
    if (stem !== undefined && stem !== "lxc") {
      return stem;
    }
  }
  return null;
}

/**
 * Runs as root on the login user's session bus, because a compositor typically raises a window only for
 * a privileged caller. A raise is asked for only when the bridge is known, its window is not in front,
 * and a raise method is configured. The bridge is found in /proc rather than with ps, whose output
 * depends on the implementation and, without a tty, can leave out other users' processes.
 */
export function hostWindowScript(loginUser: string, stem: string, window: HostWindowSettings, raise: boolean): string {
  const quotedUser = `'${loginUser.replace(/'/g, `'\\''`)}'`;
  const raiseCall = raise ? window.raise : null;
  return [
    `bus="unix:path=/run/user/$(id -u ${quotedUser})/dbus/user_bus_socket"`,
    `send() { DBUS_SESSION_BUS_ADDRESS="$bus" dbus-send --session --print-reply --dest=${window.bus} "$@" 2>/dev/null; }`,
    `top() { pid=$(send ${window.topmost.path} ${window.topmost.method} | awk '/int32/ { print $2 }'); [ -n "$pid" ] || return 1; ` +
      `exe=""; [ "$pid" -gt 0 ] && exe=$(tr '\\0' '\\n' < /proc/$pid/cmdline 2>/dev/null | head -n 1); ` +
      `echo "$1=$pid|$exe"; }`,
    `bridge=$(for f in /proc/[0-9]*/cmdline; do tr '\\0' '\\n' < "$f" 2>/dev/null | head -n 1; done | ` +
      `grep -E '^/usr/libexec/${stem}/[^/]+-bridge$' | sort -u | head -n 1)`,
    `[ -n "$bridge" ] && echo "bridge=$bridge"`,
    'top before || { echo "compositor=absent"; exit 0; }',
    ...(raiseCall === null
      ? []
      : [
          'if [ -n "$bridge" ] && [ "$exe" != "$bridge" ]; then',
          `  if send ${raiseCall.path} ${raiseCall.method} string:"$bridge" >/dev/null; then echo "raised=1"; else echo "raised=0"; fi`,
          `  sleep ${RAISE_SETTLE_SEC}`,
          "  top after",
          "fi",
        ]),
    "exit 0",
  ].join("\n");
}

export function hostWindowCommand(
  rootPrefix: readonly string[],
  loginUser: string,
  stem: string,
  window: HostWindowSettings,
  raise: boolean,
): string {
  return hostShellCommand(hostWindowScript(loginUser, stem, window, raise), rootPrefix);
}

export function parseHostWindow(stdout: string): HostWindowState {
  const values = parseKeyValueLines(stdout);
  const first = (key: string): string | null => values.get(key)?.[0] ?? null;
  const bridge = first("bridge");
  const topmost = first("after") ?? first("before");
  if (topmost === null) {
    return { ...uncheckedHostWindow("the compositor did not answer the topmost-window query"), checked: true };
  }
  if (bridge === null) {
    return {
      ...uncheckedHostWindow("no running window bridge of the container runtime was found"),
      checked: true,
      topmost,
    };
  }
  const executable = topmost.slice(topmost.indexOf("|") + 1);
  return {
    checked: true,
    reason: null,
    known: true,
    containerInFront: executable === bridge,
    raised: first("raised") === "1",
    topmost,
  };
}
