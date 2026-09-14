/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_SSH_PORT, type SshEndpoint, sshDestination } from "./sshCommands.js";
import type { MissingPrerequisite } from "./types.js";

export type PrerequisiteId =
  | "ssh-config"
  | "usb-network-address"
  | "usb-network-peer"
  | "ssh-client"
  | "developer-mode"
  | "host-unreachable"
  | "ssh-host-key"
  | "ssh-key"
  | "ssh-failed"
  | "android-container"
  | "adb-client"
  | "container-adb-disabled"
  | "container-adb-unauthorized"
  | "container-adb-connect"
  | "ssh-forwarding"
  | "root-access"
  | "attach-command";

/** One line per prerequisite, in detection order. Served as a resource and mirrored in the README. */
export const PREREQUISITE_SUMMARIES: Readonly<Record<PrerequisiteId, string>> = {
  "ssh-config": "The optional ssh configuration file or DROIDCTL_SSH_* variables are valid.",
  "usb-network-address": "The phone's USB network interface on this computer has an IPv4 address.",
  "usb-network-peer": "A phone address can be derived from that interface's subnet or neighbour table.",
  "ssh-client": "An ssh client is installed on this computer.",
  "developer-mode": "Developer mode and remote SSH login are enabled on the phone.",
  "host-unreachable": "The phone answers on its SSH port over the USB network.",
  "ssh-host-key": "The phone's SSH host key matches the one this computer recorded.",
  "ssh-key": "This computer's SSH public key is installed for the phone's login user.",
  "ssh-failed": "ssh completes a non-interactive login.",
  "android-container": "The Android compatibility container is running.",
  "adb-client": "adb is installed on this computer.",
  "container-adb-disabled": "An adb daemon is listening inside the container (Developer options, USB debugging).",
  "container-adb-unauthorized": "The container has authorised this computer's adb key.",
  "container-adb-connect": "adb completes a connection through the SSH tunnel.",
  "ssh-forwarding": "The phone's SSH server allows TCP port forwarding.",
  "root-access": "Root is available without a password: login as root, passwordless sudo, or root login by key.",
  "attach-command": "A command that runs a program inside the container is available and works.",
};

/** A target blocked only by one of these is listed as unauthorized rather than offline. */
export const AUTHORIZATION_PREREQUISITES: ReadonlySet<string> = new Set([
  "ssh-host-key",
  "ssh-key",
  "container-adb-unauthorized",
  "root-access",
]);

function sshPortFlag(endpoint: SshEndpoint): string {
  return endpoint.port === DEFAULT_SSH_PORT ? "" : ` -p ${endpoint.port}`;
}

function excerpt(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

export function sshConfigInvalid(source: string, problem: string): MissingPrerequisite {
  return {
    id: "ssh-config",
    message: `The droidctl ssh configuration from ${source} is invalid: ${problem}. Fix or remove it; nothing was probed.`,
  };
}

export function usbNetworkAddress(iface: { name: string; driver: string; operstate: string }): MissingPrerequisite {
  return {
    id: "usb-network-address",
    message:
      `USB network interface ${iface.name} (driver ${iface.driver}, link ${iface.operstate}) has no IPv4 address, so the ` +
      "phone behind it cannot be reached. Select the developer USB mode on the phone, which hands out an address " +
      "over DHCP. If NetworkManager still leaves the interface unconfigured, which happens when the kernel names it " +
      `ww..., assign a static address in the phone's subnet: nmcli connection add type ethernet ifname ${iface.name} ` +
      "con-name phone-usb ipv4.method manual ipv4.addresses 192.168.2.100/24 ipv6.method disabled && nmcli " +
      "connection up phone-usb",
  };
}

export function usbNetworkPeer(iface: { name: string; driver: string }, cidrs: readonly string[]): MissingPrerequisite {
  return {
    id: "usb-network-peer",
    message:
      `USB network interface ${iface.name} (driver ${iface.driver}) has ${cidrs.join(", ")}, but no phone address was ` +
      "found on it: the conventional address 192.168.2.15 is outside that subnet and no USB-gadget neighbour has " +
      "answered. Set DROIDCTL_SSH_HOSTS to the phone's address.",
  };
}

export function sshClientMissing(sshPath: string, detail: string): MissingPrerequisite {
  return {
    id: "ssh-client",
    message: `The ssh client (${sshPath}) could not be started: ${excerpt(detail)}. Install it: sudo apt install openssh-client`,
  };
}

export function developerMode(endpoint: SshEndpoint): MissingPrerequisite {
  return {
    id: "developer-mode",
    message:
      `Nothing accepts SSH connections on ${endpoint.host}:${endpoint.port} (connection refused). On the phone, enable ` +
      "developer mode, turn on remote (SSH) login and set the developer password, keep the phone unlocked, then retry.",
  };
}

export function hostUnreachable(
  endpoint: SshEndpoint,
  detail: string,
  interfaceProblems: readonly MissingPrerequisite[] = [],
): MissingPrerequisite {
  const extra = interfaceProblems.length > 0 ? ` Also: ${interfaceProblems.map((p) => p.message).join(" ")}` : "";
  return {
    id: "host-unreachable",
    message:
      `${endpoint.host}:${endpoint.port} did not answer (${detail}). Check that the phone is unlocked, that the USB ` +
      "cable carries data, that the phone's USB mode provides networking, and that this computer's USB network " +
      "interface has an address in the phone's subnet (ip -br addr). If the phone's USB IP address setting was " +
      `changed, set DROIDCTL_SSH_HOSTS to that address.${extra}`,
  };
}

export function sshHostKey(endpoint: SshEndpoint): MissingPrerequisite {
  return {
    id: "ssh-host-key",
    message:
      `The SSH host key of ${endpoint.host} differs from the one recorded in ~/.ssh/known_hosts, which is expected ` +
      `after the phone was reset. If that is the case, forget the old key and retry: ssh-keygen -R ${endpoint.host}` +
      (endpoint.port === DEFAULT_SSH_PORT ? "" : ` && ssh-keygen -R "[${endpoint.host}]:${endpoint.port}"`),
  };
}

export function sshKey(endpoint: SshEndpoint, hasLocalKey: boolean): MissingPrerequisite {
  const identity = endpoint.identityFile === null ? "" : ` -i ${endpoint.identityFile}.pub`;
  const create = hasLocalKey ? "" : "No SSH key was found on this computer; create one first: ssh-keygen -t ed25519. ";
  return {
    id: "ssh-key",
    message:
      `${sshDestination(endpoint)} refused key authentication, and droidctl never types passwords. ${create}` +
      `Install the public key once, entering the developer password when asked: ssh-copy-id${identity}` +
      `${sshPortFlag(endpoint)} ${sshDestination(endpoint)}`,
  };
}

export function sshFailed(endpoint: SshEndpoint, exitCode: number, stderr: string): MissingPrerequisite {
  return {
    id: "ssh-failed",
    message: `ssh to ${sshDestination(endpoint)} failed with exit code ${exitCode}: ${excerpt(stderr) || "no output"}.`,
  };
}

/** Reads ssh's own diagnostics; anything unrecognised is reported verbatim rather than guessed at. */
export function classifySshFailure(
  endpoint: SshEndpoint,
  outcome: { exitCode: number; stderr: string },
  hasLocalKey: boolean,
): MissingPrerequisite {
  const { stderr } = outcome;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(stderr)) {
    return sshHostKey(endpoint);
  }
  if (/Permission denied|Too many authentication failures|No more authentication methods/i.test(stderr)) {
    return sshKey(endpoint, hasLocalKey);
  }
  if (/Connection refused/i.test(stderr)) {
    return developerMode(endpoint);
  }
  if (/timed out|No route to host|Network is unreachable|Connection closed|Connection reset/i.test(stderr)) {
    return hostUnreachable(endpoint, excerpt(stderr));
  }
  return sshFailed(endpoint, outcome.exitCode, stderr);
}

/** Tells ssh's own failure apart from a remote command that happened to exit 255. */
export function isSshTransportFailure(stderr: string): boolean {
  return /^(ssh: |mux_client|Control socket|ControlSocket|kex_exchange_identification|client_loop: |Connection (closed|reset|timed out)|Host key verification failed|Permission denied \()/m.test(
    stderr,
  );
}

export function androidContainer(endpoint: SshEndpoint): MissingPrerequisite {
  return {
    id: "android-container",
    message:
      `SSH to ${sshDestination(endpoint)} works, but the Android compatibility container is not running (no ` +
      "system_server process). Start Android support in the phone's settings, or open any Android app once, wait " +
      "until it has started, and retry.",
  };
}

export function adbClientMissing(detail: string): MissingPrerequisite {
  return {
    id: "adb-client",
    message: `adb could not be run on this computer: ${excerpt(detail)}. Install it: sudo apt install adb`,
  };
}

export function containerAdbDisabled(endpoint: SshEndpoint, tried: readonly string[]): MissingPrerequisite {
  const where =
    tried.length === 0
      ? "no adb port is listening on the phone"
      : `nothing accepted a connection at ${tried.join(", ")} as seen from the phone`;
  return {
    id: "container-adb-disabled",
    message:
      `The container adb route to ${endpoint.host} is unavailable: ${where}. Inside the container, open Android ` +
      "Settings > About phone, tap Build number seven times, then enable Developer options > USB debugging and " +
      "Wireless debugging. If adbd listens on another address or port, set DROIDCTL_SSH_CONTAINER_ADB to that " +
      "address:port as seen from the phone.",
  };
}

export function containerAdbUnauthorized(endpoint: SshEndpoint, serial: string): MissingPrerequisite {
  return {
    id: "container-adb-unauthorized",
    message:
      `adb reached the container on ${endpoint.host} through the SSH tunnel (${serial}), but the connection is ` +
      "unauthorized. Unlock the phone and accept the Allow debugging prompt for this computer, ticking Always allow. " +
      "If no prompt appears, append this computer's ~/.android/adbkey.pub to /data/misc/adb/adb_keys inside the " +
      "container. The next droidctl call picks up the change.",
  };
}

export function containerAdbConnect(
  endpoint: SshEndpoint,
  containerEndpoint: string,
  output: string,
): MissingPrerequisite {
  return {
    id: "container-adb-connect",
    message:
      `adb could not complete a connection to ${containerEndpoint} on ${endpoint.host} through the SSH tunnel: ` +
      `${excerpt(output) || "no output"}. If the container only offers wireless debugging with a pairing code, pair ` +
      "once as described in droidctl/README.md and set DROIDCTL_SSH_CONTAINER_ADB to the connect port.",
  };
}

export function sshForwarding(endpoint: SshEndpoint, containerEndpoint: string, stderr: string): MissingPrerequisite {
  return {
    id: "ssh-forwarding",
    message:
      `ssh could not forward a local port to ${containerEndpoint} on ${endpoint.host}: ` +
      `${excerpt(stderr) || "the tunnel process exited without output"}. The phone's SSH server must allow TCP ` +
      "forwarding (AllowTcpForwarding yes in its sshd configuration).",
  };
}

export function rootAccess(endpoint: SshEndpoint, home: string | null): MissingPrerequisite {
  const keys = `${home ?? `/home/${endpoint.user}`}/.ssh/authorized_keys`;
  return {
    id: "root-access",
    message:
      `The container attach route needs root on ${endpoint.host}, and none is available without a password: ` +
      `${endpoint.user} is not uid 0, has no passwordless sudo, and root@${endpoint.host} refused the key. Install ` +
      `the same key for root once, from a root shell opened with ssh -t${sshPortFlag(endpoint)} ` +
      `${sshDestination(endpoint)} devel-su: mkdir -p /root/.ssh && cat ${keys} >> /root/.ssh/authorized_keys && ` +
      "chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys. If the phone refuses root login over SSH, use " +
      "the container adb route instead.",
  };
}

export function attachCommandMissing(
  endpoint: SshEndpoint,
  tried: readonly { command: string; exitCode: number; output: string }[],
  detail: string | null = null,
): MissingPrerequisite {
  const attempts =
    tried.length === 0
      ? "no candidate was found (no *-attach helper on the phone's PATH directories and no running LXC container)"
      : tried
          .map((attempt) => `${attempt.command} exited ${attempt.exitCode}: ${excerpt(attempt.output) || "no output"}`)
          .join("; ");
  return {
    id: "attach-command",
    message:
      `Root works on ${endpoint.host}, but no command ran getprop inside the Android container: ${attempts}` +
      `${detail ? ` (${excerpt(detail)})` : ""}. Set DROIDCTL_SSH_ATTACH_COMMAND to the platform's container attach ` +
      "command, for example lxc-attach -n <container> --.",
  };
}

export function formatPrerequisites(missing: readonly MissingPrerequisite[]): string {
  return missing.map((entry, index) => `${index + 1}. [${entry.id}] ${entry.message}`).join("\n");
}
