/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Each message must name what is missing and the step that supplies it; these
 * pin the remedy text a user would copy.
 */

import { describe, expect, it } from "vitest";
import type { SshEndpoint } from "../src/transport/sshCommands.js";
import {
  AUTHORIZATION_PREREQUISITES,
  PREREQUISITE_SUMMARIES,
  adbClientMissing,
  androidContainer,
  attachCommandMissing,
  classifySshFailure,
  containerAdbConnect,
  containerAdbDisabled,
  containerAdbUnauthorized,
  developerMode,
  formatPrerequisites,
  hostUnreachable,
  isSshTransportFailure,
  rootAccess,
  sshClientMissing,
  sshConfigInvalid,
  sshFailed,
  sshForwarding,
  sshHostKey,
  sshKey,
  usbNetworkAddress,
  usbNetworkPeer,
} from "../src/transport/sshPrerequisites.js";

const PHONE: SshEndpoint = { host: "192.168.2.15", port: 22, user: "defaultuser", identityFile: null };
const ALT: SshEndpoint = { host: "10.0.0.9", port: 2222, user: "phone", identityFile: "/keys/phone" };

describe("prerequisite messages", () => {
  it("gives each prerequisite its remedy", () => {
    const cases: [ReturnType<typeof developerMode>, string, string[]][] = [
      [sshConfigInvalid("/c.json", "bad port"), "ssh-config", ["/c.json", "bad port"]],
      [
        usbNetworkAddress({ name: "usb0", driver: "cdc_ncm", operstate: "down" }),
        "usb-network-address",
        ["nmcli connection add type ethernet ifname usb0"],
      ],
      [
        usbNetworkPeer({ name: "usb0", driver: "cdc_ncm" }, ["10.0.0.1/24"]),
        "usb-network-peer",
        ["DROIDCTL_SSH_HOSTS"],
      ],
      [sshClientMissing("ssh", "spawn ssh ENOENT"), "ssh-client", ["sudo apt install openssh-client", "ENOENT"]],
      [developerMode(PHONE), "developer-mode", ["192.168.2.15:22", "developer mode", "remote (SSH) login"]],
      [hostUnreachable(PHONE, "timeout"), "host-unreachable", ["ip -br addr", "USB mode provides networking"]],
      [sshHostKey(PHONE), "ssh-host-key", ["ssh-keygen -R 192.168.2.15"]],
      [sshHostKey(ALT), "ssh-host-key", ['ssh-keygen -R "[10.0.0.9]:2222"']],
      [sshKey(ALT, true), "ssh-key", ["ssh-copy-id -i /keys/phone.pub -p 2222 phone@10.0.0.9"]],
      [sshFailed(PHONE, 1, ""), "ssh-failed", ["exit code 1: no output"]],
      [androidContainer(PHONE), "android-container", ["system_server", "Start Android support"]],
      [adbClientMissing("spawn adb ENOENT"), "adb-client", ["sudo apt install adb"]],
      [
        containerAdbDisabled(PHONE, ["127.0.0.1:5555"]),
        "container-adb-disabled",
        ["USB debugging", "DROIDCTL_SSH_CONTAINER_ADB"],
      ],
      [containerAdbUnauthorized(PHONE, "127.0.0.1:40000"), "container-adb-unauthorized", ["Always allow"]],
      [containerAdbConnect(PHONE, "127.0.0.1:5555", ""), "container-adb-connect", ["no output", "pairing code"]],
      [
        sshForwarding(PHONE, "127.0.0.1:5555", ""),
        "ssh-forwarding",
        ["AllowTcpForwarding yes", "exited without output"],
      ],
      [
        rootAccess(ALT, null),
        "root-access",
        ["ssh -t -p 2222 phone@10.0.0.9 devel-su", "/home/phone/.ssh/authorized_keys"],
      ],
      [
        attachCommandMissing(PHONE, [{ command: "helper", exitCode: 2, output: "" }], "x".repeat(400)),
        "attach-command",
        ["helper exited 2: no output", "...)"],
      ],
    ];
    for (const [prerequisite, id, fragments] of cases) {
      expect(prerequisite.id).toBe(id);
      expect(Object.keys(PREREQUISITE_SUMMARIES)).toContain(id);
      for (const fragment of fragments) {
        expect(prerequisite.message, id).toContain(fragment);
      }
    }
    expect([...AUTHORIZATION_PREREQUISITES].every((id) => id in PREREQUISITE_SUMMARIES)).toBe(true);
  });

  it("classifies ssh's own diagnostics and reports anything else verbatim", () => {
    const classify = (stderr: string) => classifySshFailure(PHONE, { exitCode: 255, stderr }, true).id;
    expect(classify("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@")).toBe("ssh-host-key");
    expect(classify("defaultuser@192.168.2.15: Permission denied (publickey,password).")).toBe("ssh-key");
    expect(classify("Received disconnect: Too many authentication failures")).toBe("ssh-key");
    expect(classify("ssh: connect to host 192.168.2.15 port 22: Connection refused")).toBe("developer-mode");
    expect(classify("ssh: connect to host 192.168.2.15 port 22: Connection timed out")).toBe("host-unreachable");
    expect(classify("kex_exchange_identification: Connection closed by remote host")).toBe("host-unreachable");
    expect(classify("something new")).toBe("ssh-failed");
  });

  it("tells ssh failing apart from a remote command that exited 255", () => {
    expect(isSshTransportFailure("ssh: connect to host x port 22: No route to host\n")).toBe(true);
    expect(isSshTransportFailure("mux_client_request_session: read from master failed\n")).toBe(true);
    expect(isSshTransportFailure("client_loop: send disconnect: Broken pipe\n")).toBe(true);
    expect(isSshTransportFailure("app: fatal error 255\n")).toBe(false);
  });

  it("numbers prerequisites in detection order", () => {
    expect(formatPrerequisites([developerMode(PHONE), sshKey(PHONE, false)])).toMatch(
      /^1\. \[developer-mode\] .*\n2\. \[ssh-key\] /,
    );
    expect(
      hostUnreachable(PHONE, "t", [usbNetworkAddress({ name: "usb0", driver: "d", operstate: "up" })]).message,
    ).toContain("Also: USB network interface usb0");
  });
});
