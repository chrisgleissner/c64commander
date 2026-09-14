/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EventEmitter } from "node:events";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ConnectableSocket,
  createNodeSshSystem,
  discoverUsbHosts,
  findUsbNetworkInterfaces,
  inSubnet,
  isLocallyAdministered,
  nodeAllocatePort,
  nodeEnsurePrivateDir,
  nodeTcpConnect,
  parseArpTable,
} from "../src/transport/sshDiscovery.js";
import { FakeSshSystem } from "./support/sshFakes.js";

describe("USB network interface discovery", () => {
  it("keeps only USB interfaces bound to a gadget driver, with their addresses and neighbours", () => {
    const system = new FakeSshSystem()
      .addUsbInterface("enx020000000001", {
        driver: "rndis_host",
        arp: [{ address: "192.168.2.15", mac: "02:AA:BB:CC:DD:EE" }],
      })
      .addUsbInterface("enxdongle", { driver: "r8152", cidr: "192.168.1.20/24" })
      .addUsbInterface("eno1", { driver: "e1000e", bus: "pci", cidr: "192.168.1.21/24" });
    system.dirs.set("/sys/class/net", [...system.listDir("/sys/class/net"), "lo"]);
    system.files.set(
      "/proc/net/arp",
      `${system.files.get("/proc/net/arp")}192.168.2.16 0x1 0x0 00:00:00:00:00:00 * enx020000000001\n`,
    );

    expect(findUsbNetworkInterfaces(system)).toEqual([
      {
        name: "enx020000000001",
        driver: "rndis_host",
        operstate: "up",
        ipv4: [{ address: "192.168.2.14", prefixLength: 24 }],
        neighbours: [{ address: "192.168.2.15", mac: "02:aa:bb:cc:dd:ee" }],
      },
    ]);
  });

  it("reports unknown operstate and a missing /proc/net/arp without failing", () => {
    const system = new FakeSshSystem().addUsbInterface("usb0");
    system.files.delete("/sys/class/net/usb0/operstate");
    system.files.delete("/proc/net/arp");
    system.interfaces["usb0"] = [
      { address: "10.1.1.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: false, cidr: null },
    ];
    expect(findUsbNetworkInterfaces(system)).toEqual([
      {
        name: "usb0",
        driver: "cdc_ncm",
        operstate: "unknown",
        ipv4: [{ address: "10.1.1.1", prefixLength: 32 }],
        neighbours: [],
      },
    ]);
  });

  it("derives the conventional address and gadget neighbours, never the computer's own address", () => {
    const { hosts, problems } = discoverUsbHosts([
      {
        name: "usb0",
        driver: "cdc_ether",
        operstate: "up",
        ipv4: [{ address: "192.168.2.14", prefixLength: 24 }],
        neighbours: [
          { address: "192.168.2.15", mac: "02:00:00:00:00:02" },
          { address: "192.168.2.20", mac: "06:00:00:00:00:03" },
          { address: "192.168.2.30", mac: "00:1a:2b:3c:4d:5e" },
        ],
      },
      {
        name: "usb1",
        driver: "cdc_ncm",
        operstate: "up",
        ipv4: [{ address: "192.168.2.15", prefixLength: 24 }],
        neighbours: [],
      },
      { name: "usb2", driver: "cdc_ncm", operstate: "down", ipv4: [], neighbours: [] },
      {
        name: "usb3",
        driver: "rndis_host",
        operstate: "up",
        ipv4: [{ address: "10.42.0.1", prefixLength: 24 }],
        neighbours: [{ address: "10.42.0.2", mac: "00:1a:2b:3c:4d:5e" }],
      },
    ]);

    expect(hosts).toEqual([
      { host: "192.168.2.15", interfaceName: "usb0", driver: "cdc_ether", neighbourOnly: false },
      { host: "192.168.2.20", interfaceName: "usb0", driver: "cdc_ether", neighbourOnly: true },
    ]);
    expect(problems.map((problem) => problem.id)).toEqual([
      "usb-network-peer",
      "usb-network-address",
      "usb-network-peer",
    ]);
    expect(problems[0]!.message).toContain("usb1 (driver cdc_ncm) has 192.168.2.15/24");
    expect(problems[1]!.message).toContain("usb2 (driver cdc_ncm, link down) has no IPv4 address");
    expect(problems[2]!.message).toContain("Set DROIDCTL_SSH_HOSTS");
  });

  it("parses complete ARP entries only, and reads subnets and MAC bits defensively", () => {
    expect(
      parseArpTable(
        "header\n10.0.0.1 0x1 0x2 02:00:00:00:00:01 * usb0\n10.0.0.2 0x1 0x0 00:00:00:00:00:00 * usb0\nshort line\n",
      ),
    ).toEqual(new Map([["usb0", [{ address: "10.0.0.1", mac: "02:00:00:00:00:01" }]]]));
    expect(isLocallyAdministered("02:00:00:00:00:00")).toBe(true);
    expect(isLocallyAdministered("00:1a:2b:3c:4d:5e")).toBe(false);
    expect(isLocallyAdministered("zz")).toBe(false);
    expect(inSubnet("192.168.2.15", "192.168.2.1", 24)).toBe(true);
    expect(inSubnet("192.168.3.15", "192.168.2.1", 24)).toBe(false);
    expect(inSubnet("8.8.8.8", "192.168.2.1", 0)).toBe(true);
    expect(inSubnet("192.168.2.15", "192.168.2.15", 32)).toBe(true);
    expect(inSubnet("192.168.2.256", "192.168.2.1", 24)).toBe(false);
    expect(inSubnet("192.168.2.15", "not-an-address", 24)).toBe(false);
    expect(inSubnet("192.168.2.15", "192.168.2.1", 33)).toBe(false);
  });
});

describe("the node system implementation", () => {
  it("connects to a local listener, and reports a closed port as refused", async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    expect(await nodeTcpConnect("127.0.0.1", port, 2_000)).toEqual({ kind: "open" });
    await new Promise((resolve) => server.close(resolve));

    const closed = await nodeAllocatePort();
    expect(await nodeTcpConnect("127.0.0.1", closed, 2_000)).toEqual({ kind: "refused" });
  });

  it("reports silence as a timeout and any other socket error by its code or message", async () => {
    const socket = (emit?: (emitter: EventEmitter) => void) => () => {
      const emitter = Object.assign(new EventEmitter(), { destroy: () => undefined });
      if (emit) {
        setImmediate(() => emit(emitter));
      }
      return emitter as unknown as ConnectableSocket;
    };
    expect(await nodeTcpConnect("h", 1, 5, socket())).toEqual({ kind: "timeout" });
    expect(
      await nodeTcpConnect(
        "h",
        1,
        1_000,
        socket((e) => e.emit("error", Object.assign(new Error("x"), { code: "EHOSTUNREACH" }))),
      ),
    ).toEqual({ kind: "unreachable", message: "EHOSTUNREACH" });
    expect(
      await nodeTcpConnect(
        "h",
        1,
        1_000,
        socket((e) => e.emit("error", new Error("odd failure"))),
      ),
    ).toEqual({
      kind: "unreachable",
      message: "odd failure",
    });
    expect(
      await nodeTcpConnect(
        "h",
        1,
        1_000,
        socket((e) => {
          e.emit("connect");
          e.emit("error", new Error("late"));
        }),
      ),
    ).toEqual({ kind: "open" });
  });

  it("accepts only a private directory it owns for multiplexing sockets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "droidctl-ctl-"));
    expect(nodeEnsurePrivateDir(path.join(root, "private"))).toBe(true);

    const open = path.join(root, "open");
    expect(nodeEnsurePrivateDir(open)).toBe(true);
    await chmod(open, 0o755);
    expect(nodeEnsurePrivateDir(open)).toBe(false);

    const file = path.join(root, "file");
    await writeFile(file, "x");
    expect(nodeEnsurePrivateDir(path.join(file, "below"))).toBe(false);
  });

  it("reads files, links and directories, returning empty answers for what is absent", async () => {
    const system = createNodeSshSystem();
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-sys-"));
    await writeFile(path.join(dir, "a"), "text");

    expect(system.readText(path.join(dir, "a"))).toBe("text");
    expect(system.readText(path.join(dir, "missing"))).toBeNull();
    expect(system.realpath(path.join(dir, "a"))).toBe(
      path.join(await import("node:fs").then((fs) => fs.realpathSync(dir)), "a"),
    );
    expect(system.realpath(path.join(dir, "missing"))).toBeNull();
    expect(system.listDir(dir)).toEqual(["a"]);
    expect(system.listDir(path.join(dir, "missing"))).toEqual([]);
    expect(system.fileExists(path.join(dir, "a"))).toBe(true);
    expect(system.ensurePrivateDir(path.join(dir, "ctl"))).toBe(true);
    expect(typeof system.networkInterfaces()).toBe("object");
    expect(system.homeDir).toBe(os.homedir());
    const before = system.now();
    await system.delay(1);
    expect(system.now()).toBeGreaterThanOrEqual(before);
    expect(await system.allocatePort()).toBeGreaterThan(0);
    expect(await system.tcpConnect("127.0.0.1", await system.allocatePort(), 1_000)).toEqual({ kind: "refused" });
  });
});
