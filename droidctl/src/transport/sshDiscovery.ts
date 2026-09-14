/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DEFAULT_USB_HOST } from "./sshConfig.js";
import { usbNetworkAddress, usbNetworkPeer } from "./sshPrerequisites.js";
import type { MissingPrerequisite } from "./types.js";

export type TcpOutcome =
  | { readonly kind: "open" }
  | { readonly kind: "refused" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unreachable"; readonly message: string };

/** Everything the ssh transport reads from this computer, so a test can replace all of it. */
export interface SshSystem {
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: string;
  readText(filePath: string): string | null;
  realpath(filePath: string): string | null;
  listDir(directory: string): string[];
  fileExists(filePath: string): boolean;
  /** True only for a directory that exists, is owned by this user and is closed to everyone else. */
  ensurePrivateDir(directory: string): boolean;
  networkInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  tcpConnect(host: string, port: number, timeoutMs: number): Promise<TcpOutcome>;
  allocatePort(): Promise<number>;
  now(): number;
  delay(ms: number): Promise<void>;
}

export interface ConnectableSocket {
  once(event: "connect", listener: () => void): unknown;
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  destroy(): void;
}

export function nodeTcpConnect(
  host: string,
  port: number,
  timeoutMs: number,
  connect: (options: { host: string; port: number }) => ConnectableSocket = (options) => net.connect(options),
): Promise<TcpOutcome> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (outcome: TcpOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    socket.once("connect", () => finish({ kind: "open" }));
    socket.once("error", (error) =>
      finish(
        error.code === "ECONNREFUSED"
          ? { kind: "refused" }
          : { kind: "unreachable", message: error.code ?? error.message },
      ),
    );
  });
}

export function nodeAllocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export function nodeEnsurePrivateDir(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = statSync(directory);
    return info.isDirectory() && info.uid === os.userInfo().uid && (info.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

export function createNodeSshSystem(): SshSystem {
  return {
    env: process.env,
    homeDir: os.homedir(),
    readText: (filePath) => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return null;
      }
    },
    realpath: (filePath) => {
      try {
        return realpathSync(filePath);
      } catch {
        return null;
      }
    },
    listDir: (directory) => {
      try {
        return readdirSync(directory);
      } catch {
        return [];
      }
    },
    fileExists: (filePath) => existsSync(filePath),
    ensurePrivateDir: nodeEnsurePrivateDir,
    networkInterfaces: () => os.networkInterfaces(),
    tcpConnect: (host, port, timeoutMs) => nodeTcpConnect(host, port, timeoutMs),
    allocatePort: nodeAllocatePort,
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/*
 * The kernel drivers a phone's USB network gadget binds to on a Linux desktop. A
 * USB Ethernet adapter binds to its own chipset driver, so a LAN reached through
 * one is never probed.
 */
export const USB_GADGET_NETWORK_DRIVERS: ReadonlySet<string> = new Set([
  "rndis_host",
  "cdc_ether",
  "cdc_ncm",
  "cdc_eem",
  "cdc_subset",
]);

export const SYSFS_NET = "/sys/class/net";
export const PROC_ARP = "/proc/net/arp";

export interface UsbNetworkInterface {
  readonly name: string;
  readonly driver: string;
  readonly operstate: string;
  readonly ipv4: readonly { readonly address: string; readonly prefixLength: number }[];
  readonly neighbours: readonly { readonly address: string; readonly mac: string }[];
}

/** Complete entries (flags 0x2) of /proc/net/arp, grouped by device. */
export function parseArpTable(text: string): Map<string, { address: string; mac: string }[]> {
  const byDevice = new Map<string, { address: string; mac: string }[]>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [address, , flags, mac, , device] = line.trim().split(/\s+/);
    if (!address || !device || !mac || (Number.parseInt(flags ?? "0", 16) & 0x2) === 0) {
      continue;
    }
    byDevice.set(device, [...(byDevice.get(device) ?? []), { address, mac: mac.toLowerCase() }]);
  }
  return byDevice;
}

/** USB gadgets use random, locally administered MAC addresses; vendor-assigned ones do not have this bit. */
export function isLocallyAdministered(mac: string): boolean {
  const first = Number.parseInt(mac.split(":")[0] ?? "", 16);
  return Number.isInteger(first) && (first & 0x02) === 0x02;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

export function inSubnet(address: string, network: string, prefixLength: number): boolean {
  const a = ipv4ToNumber(address);
  const b = ipv4ToNumber(network);
  if (a === null || b === null || prefixLength < 0 || prefixLength > 32) {
    return false;
  }
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export function findUsbNetworkInterfaces(system: SshSystem): UsbNetworkInterface[] {
  const addresses = system.networkInterfaces();
  const arp = parseArpTable(system.readText(PROC_ARP) ?? "");
  const found: UsbNetworkInterface[] = [];
  for (const name of system.listDir(SYSFS_NET).sort()) {
    const subsystem = system.realpath(path.join(SYSFS_NET, name, "device", "subsystem"));
    const driverPath = system.realpath(path.join(SYSFS_NET, name, "device", "driver"));
    const driver = driverPath === null ? "" : path.basename(driverPath);
    if (subsystem === null || path.basename(subsystem) !== "usb" || !USB_GADGET_NETWORK_DRIVERS.has(driver)) {
      continue;
    }
    found.push({
      name,
      driver,
      operstate: (system.readText(path.join(SYSFS_NET, name, "operstate")) ?? "unknown").trim(),
      ipv4: (addresses[name] ?? [])
        .filter((entry) => entry.family === "IPv4")
        .map((entry) => ({ address: entry.address, prefixLength: Number(entry.cidr?.split("/")[1] ?? 32) })),
      neighbours: arp.get(name) ?? [],
    });
  }
  return found;
}

export interface DiscoveredHost {
  readonly host: string;
  readonly interfaceName: string;
  readonly driver: string;
}

/**
 * Candidates are the conventional phone address when it lies in the interface's
 * subnet, and neighbours whose MAC is locally administered. Nothing else on an
 * interface is contacted.
 */
export function discoverUsbHosts(interfaces: readonly UsbNetworkInterface[]): {
  hosts: DiscoveredHost[];
  problems: MissingPrerequisite[];
} {
  const hosts: DiscoveredHost[] = [];
  const problems: MissingPrerequisite[] = [];
  for (const iface of interfaces) {
    if (iface.ipv4.length === 0) {
      problems.push(usbNetworkAddress(iface));
      continue;
    }
    const own = new Set(iface.ipv4.map((entry) => entry.address));
    const candidates = new Set<string>();
    if (iface.ipv4.some((entry) => inSubnet(DEFAULT_USB_HOST, entry.address, entry.prefixLength))) {
      candidates.add(DEFAULT_USB_HOST);
    }
    for (const neighbour of iface.neighbours) {
      if (isLocallyAdministered(neighbour.mac)) {
        candidates.add(neighbour.address);
      }
    }
    const peers = [...candidates].filter((address) => !own.has(address));
    if (peers.length === 0) {
      problems.push(
        usbNetworkPeer(
          iface,
          iface.ipv4.map((entry) => `${entry.address}/${entry.prefixLength}`),
        ),
      );
      continue;
    }
    hosts.push(...peers.map((host) => ({ host, interfaceName: iface.name, driver: iface.driver })));
  }
  return { hosts, problems };
}
