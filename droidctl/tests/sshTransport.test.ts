/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The ssh transport against a scripted phone. Every test names the stage of the
 * detection order it exercises and asserts both the reported prerequisite and
 * which later stages did not run.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOGIN_PROBE_SCRIPT, hostShellCommand } from "../src/transport/sshCommands.js";
import { ATTACH_REPROBE_MS, BLOCKED_REPROBE_MS, SshTransport, routeReports } from "../src/transport/ssh.js";
import type { HostDiagnosis } from "../src/transport/sshProbe.js";
import type { ResolvedTarget } from "../src/transport/types.js";
import { FakePhone, FakeSshSystem, usbPhone } from "./support/sshFakes.js";

const SERIAL = "defaultuser@192.168.2.15";
const TARGET: ResolvedTarget = { targetId: `ssh:${SERIAL}`, transport: "ssh", serial: SERIAL };
const ADB_PHONE = { listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "device" as const } };
const ATTACH_PHONE = {
  sudo: true,
  helpers: ["/usr/bin/container-attach"],
  attachResults: { "helper:/usr/bin/container-attach": { exitCode: 0, firstLine: "33" } },
};

async function rejectionOf(promise: Promise<unknown>): Promise<{ code: string; message: string; details: any }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; details: any };
  }
  throw new Error("expected a rejection");
}

function ids(target: { missingPrerequisites?: readonly { id: string }[] }): string[] {
  return (target.missingPrerequisites ?? []).map((entry) => entry.id);
}

describe("ssh discovery", () => {
  it("lists nothing and runs nothing when there is no USB network interface and no configured host", async () => {
    const phone = new FakePhone();
    const targets = await phone.transport().listTargets();

    expect(targets).toEqual([]);
    expect(phone.system.tcpCalls).toEqual([]);
    expect(phone.sshCalls).toEqual([]);
    expect(phone.adbCalls).toEqual([]);
  });

  it("reports an interface with no address as the missing prerequisite instead of an empty list", async () => {
    const system = new FakeSshSystem().addUsbInterface("usb0", { cidr: null, operstate: "down" });
    const phone = new FakePhone({}, system);

    const error = await rejectionOf(phone.transport().listTargets());

    expect(error.code).toBe("transport_unavailable");
    expect(error.details.prerequisites.map((entry: { id: string }) => entry.id)).toEqual(["usb-network-address"]);
    expect(error.message).toContain("nmcli connection add type ethernet ifname usb0");
    expect(phone.system.tcpCalls).toEqual([]);
  });

  it("probes a configured host even with discovery off, and adds interface problems to an unreachable host", async () => {
    const system = new FakeSshSystem().addUsbInterface("usb0", { cidr: null });
    system.env = { DROIDCTL_SSH_HOSTS: "root@10.0.0.9:2222" };
    const phone = new FakePhone({ host: "10.0.0.9" }, system);

    const [target] = await phone.transport().listTargets();
    expect(target).toMatchObject({ targetId: "ssh:root@10.0.0.9:2222", state: "offline", route: null });
    expect(ids(target!)).toEqual(["host-unreachable"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("usb0");

    system.env = { DROIDCTL_SSH_HOSTS: "10.0.0.9", DROIDCTL_SSH_DISCOVERY: "off" };
    const off = new FakePhone({ host: "10.0.0.9" }, system);
    expect((await off.transport().listTargets()).map((entry) => entry.targetId)).toEqual(["ssh:defaultuser@10.0.0.9"]);
  });

  it("applies a configured host's settings to the same address when it is discovered", async () => {
    const system = new FakeSshSystem().addUsbInterface("enx1");
    system.files.set(
      "/home/tester/.config/droidctl/ssh.json",
      JSON.stringify({ hosts: [{ host: "192.168.2.15", user: "phoneuser" }] }),
    );
    const phone = new FakePhone({ sshPort: { kind: "refused" } }, system);
    const ssh = phone.transport();

    const targets = await ssh.listTargets();

    expect(targets.map((entry) => entry.serial)).toEqual(["phoneuser@192.168.2.15"]);
    expect(ssh.describeConnection({ ...TARGET, serial: "phoneuser@192.168.2.15" })).toMatchObject({
      discoveredVia: "usb-network enx1 (cdc_ncm)",
      user: "phoneuser",
    });
  });

  it("leaves out a neighbour that does not answer SSH, such as a phone sharing its connection over USB", async () => {
    const system = new FakeSshSystem().addUsbInterface("enxtether", {
      cidr: "10.42.0.37/24",
      arp: [{ address: "10.42.0.1", mac: "0a:11:22:33:44:55" }],
    });
    const quiet = new FakePhone({ host: "10.42.0.1", sshPort: { kind: "refused" } }, system);
    expect(await quiet.transport().listTargets()).toEqual([]);
    expect(quiet.system.tcpCalls).toEqual(["10.42.0.1:22"]);

    const answering = new FakePhone(
      { host: "10.42.0.1", login: { exitCode: 255, stderr: "Permission denied (publickey).\n" } },
      system,
    );
    const [target] = await answering.transport().listTargets();
    expect(target).toMatchObject({ targetId: "ssh:defaultuser@10.42.0.1", state: "unauthorized" });

    system.env = { DROIDCTL_SSH_HOSTS: "10.42.0.1" };
    const configured = new FakePhone({ host: "10.42.0.1", sshPort: { kind: "refused" } }, system);
    expect((await configured.transport().listTargets()).map((entry) => ids(entry))).toEqual([["developer-mode"]]);
  });

  it("fails the listing with the configuration problem when the configuration is invalid", async () => {
    const system = new FakeSshSystem();
    system.env = { DROIDCTL_SSH_PORT: "nope" };
    const error = await rejectionOf(new FakePhone({}, system).transport().listTargets());
    expect(error.details.prerequisites[0].id).toBe("ssh-config");
  });
});

describe("ssh detection order, stage by stage", () => {
  it("stage 3: a refused SSH port means developer mode or remote login is off, and ssh never runs", async () => {
    const phone = usbPhone({ sshPort: { kind: "refused" } });
    const [target] = await phone.transport().listTargets();

    expect(target).toMatchObject({ state: "offline", route: null, model: null, apiLevel: null });
    expect(ids(target!)).toEqual(["developer-mode"]);
    expect(target!.missingPrerequisites![0]!.message).toMatch(/enable developer mode, turn on remote \(SSH\) login/);
    expect(phone.sshCalls).toEqual([]);
  });

  it("stage 3: silence or a routing error is host-unreachable, with the timeout or the error named", async () => {
    const timeout = usbPhone({ sshPort: { kind: "timeout" } });
    const [slow] = await timeout.transport().listTargets();
    expect(slow!.missingPrerequisites![0]!.message).toContain("no answer within 1500 ms");

    const unreachable = usbPhone({ sshPort: { kind: "unreachable", message: "EHOSTUNREACH" } });
    const [lost] = await unreachable.transport().listTargets();
    expect(ids(lost!)).toEqual(["host-unreachable"]);
    expect(lost!.missingPrerequisites![0]!.message).toContain("EHOSTUNREACH");
  });

  it("stage 4: a missing ssh client is reported with the package to install", async () => {
    const [target] = await usbPhone({ sshSpawnFails: true }).transport().listTargets();
    expect(ids(target!)).toEqual(["ssh-client"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("sudo apt install openssh-client");
  });

  it("stage 4: a refused key is unauthorized, with ssh-copy-id, and ssh-keygen when no key exists", async () => {
    const denied = { exitCode: 255, stderr: "defaultuser@192.168.2.15: Permission denied (publickey,password).\n" };
    const phone = usbPhone({ login: denied });
    const [target] = await phone.transport().listTargets();

    expect(target!.state).toBe("unauthorized");
    expect(ids(target!)).toEqual(["ssh-key"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("ssh-copy-id defaultuser@192.168.2.15");
    expect(target!.missingPrerequisites![0]!.message).toContain("ssh-keygen -t ed25519");

    const withKey = usbPhone({ login: denied });
    withKey.system.existing.add("/home/tester/.ssh/id_ed25519");
    const [keyed] = await withKey.transport().listTargets();
    expect(keyed!.missingPrerequisites![0]!.message).not.toContain("ssh-keygen");

    const withAgent = usbPhone({ login: denied });
    withAgent.system.env = { SSH_AUTH_SOCK: "/run/agent" };
    const [agent] = await withAgent.transport().listTargets();
    expect(agent!.missingPrerequisites![0]!.message).not.toContain("ssh-keygen");
  });

  it("stage 4: a changed host key and an ssh timeout each name their own remedy", async () => {
    const changed = usbPhone({ login: { exitCode: 255, stderr: "Host key verification failed.\n" } });
    const [key] = await changed.transport().listTargets();
    expect(ids(key!)).toEqual(["ssh-host-key"]);
    expect(key!.state).toBe("unauthorized");

    const slow = usbPhone({ login: { exitCode: -1, stderr: "", timedOut: true } });
    const [timedOut] = await slow.transport().listTargets();
    expect(ids(timedOut!)).toEqual(["host-unreachable"]);
    expect(timedOut!.missingPrerequisites![0]!.message).toContain("ssh did not finish within 20000 ms");
  });

  it("stage 5: a stopped container is reported, and neither route is tried", async () => {
    const phone = usbPhone({ android: "absent", listeners: ["00000000:15B3"] });
    const [target] = await phone.transport().listTargets();

    expect(ids(target!)).toEqual(["android-container"]);
    expect(target!.state).toBe("offline");
    expect(phone.adbCalls).toEqual([]);
    expect(phone.sshCalls).toHaveLength(1);
  });

  it("stage 6: the container adb route wins when adb lists the tunnel as a device, and root is never asked for", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();

    const targets = await ssh.listTargets();

    expect(targets).toEqual([
      {
        targetId: `ssh:${SERIAL}`,
        transport: "ssh",
        serial: SERIAL,
        model: "Container_Model",
        apiLevel: 33,
        state: "device",
        isEmulator: false,
        route: "container-adb",
        missingPrerequisites: [],
      },
    ]);
    expect(phone.sshCalls.map((call) => call.remote)).toEqual([hostShellCommand(LOGIN_PROBE_SCRIPT)]);
    const tunnel = phone.tunnels.get(40_000)!;
    expect(tunnel.endpoint).toBe("127.0.0.1:5555");
    expect(phone.adbCalls).toContainEqual(["connect", "127.0.0.1:40000"]);
    expect(ssh.ownsAdbSerial("127.0.0.1:40000")).toBe(true);
    expect(ssh.ownsAdbSerial("9B0EXAMPLE")).toBe(false);
    expect(await phone.mainAdb(ssh).listTargets()).toEqual([]);
    expect(
      routeReports(
        (ssh as unknown as { hosts: Map<string, { diagnosis: HostDiagnosis }> }).hosts.get(SERIAL)!.diagnosis,
      ),
    ).toEqual([
      { route: "container-adb", status: "usable", missing: [] },
      { route: "container-attach", status: "not-checked", missing: [] },
    ]);
  });

  it("stage 6: a configured endpoint is tried before a detected one", async () => {
    const phone = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "10.1.0.2:6000": "device" } });
    phone.system.env = { DROIDCTL_SSH_CONTAINER_ADB: "10.1.0.2:6000" };
    const [target] = await phone.transport().listTargets();

    expect(target!.route).toBe("container-adb");
    expect([...phone.tunnels.values()].map((tunnel) => tunnel.endpoint)).toEqual(["10.1.0.2:6000"]);
  });

  it("stage 6: a missing adb client is reported with the package, and the attach route is still tried", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, listeners: ["00000000:15B3"], adbInstalled: false });
    const [target] = await phone.transport().listTargets();

    expect(target!.route).toBe("container-attach");
    expect(ids(target!)).toEqual(["adb-client"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("sudo apt install adb");
    expect(phone.tunnels.size).toBe(0);
  });

  it("stage 7: an unauthorized tunnel is kept open and becomes the route once the prompt is accepted", async () => {
    const phone = usbPhone({ listeners: ["0100007F:15B3"], endpoints: { "127.0.0.1:5555": "unauthorized" } });
    const ssh = phone.transport();

    const [pending] = await ssh.listTargets();
    expect(pending).toMatchObject({ state: "unauthorized", route: null });
    expect(ids(pending!)).toEqual(["container-adb-unauthorized", "root-access"]);
    expect(pending!.missingPrerequisites![0]!.message).toContain("accept the Allow debugging prompt");
    const [stillPending] = await ssh.listTargets();
    expect(ids(stillPending!)).toEqual(["container-adb-unauthorized", "root-access"]);

    phone.connected.set("127.0.0.1:40000", "device");
    const [accepted] = await ssh.listTargets();

    expect(accepted).toMatchObject({ state: "device", route: "container-adb" });
    expect(phone.loginProbes()).toBe(1);
  });

  it("stage 7: a refused tunnel means adbd is not enabled, and names the endpoints that were tried", async () => {
    const phone = usbPhone({ listeners: ["00000000:15B3"] });
    const [target] = await phone.transport().listTargets();

    expect(ids(target!)).toEqual(["container-adb-disabled", "root-access"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("127.0.0.1:5555");
    expect(target!.missingPrerequisites![0]!.message).toContain("tap Build number seven times");
    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual(["SIGTERM"]);
    expect(phone.adbCalls).toContainEqual(["disconnect", "127.0.0.1:40000"]);
  });

  it("stage 7: with no endpoint at all the route is disabled without opening a tunnel", async () => {
    const phone = usbPhone();
    const [target] = await phone.transport().listTargets();
    expect(ids(target!)).toEqual(["container-adb-disabled", "root-access"]);
    expect(target!.missingPrerequisites![0]!.message).toContain("no adb port is listening on the phone");
    expect(phone.tunnels.size).toBe(0);
  });

  it("stage 7: a forward the phone refuses, one that never listens, and a failing adb connect each say so", async () => {
    const denied = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "forward-denied" } });
    const [forward] = await denied.transport().listTargets();
    expect(ids(forward!)[0]).toBe("ssh-forwarding");
    expect(forward!.missingPrerequisites![0]!.message).toContain("Could not request local forwarding");

    // The phone's sshd refusing each forwarded channel must not read as adbd being switched off.
    const prohibited = usbPhone({
      listeners: ["00000000:15B3"],
      endpoints: { "127.0.0.1:5555": "forward-prohibited" },
    });
    const [channel] = await prohibited.transport().listTargets();
    expect(ids(channel!)[0]).toBe("ssh-forwarding");
    expect(channel!.missingPrerequisites![0]!.message).toContain("administratively prohibited");
    expect(channel!.missingPrerequisites![0]!.message).toContain("AllowTcpForwarding yes");

    const quiet = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "never-listens" } });
    const [never] = await quiet.transport().listTargets();
    expect(never!.missingPrerequisites![0]!.message).toContain("nothing listened on 127.0.0.1:40000 within 5000 ms");

    const crashing = usbPhone({
      listeners: ["00000000:15B3"],
      endpoints: { "127.0.0.1:5555": "device" },
      adbConnectThrows: true,
    });
    const [crash] = await crashing.transport().listTargets();
    expect(ids(crash!)[0]).toBe("container-adb-connect");
    expect(crash!.missingPrerequisites![0]!.message).toContain("adb connect crashed");

    const silent = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "silent" } });
    const [offline] = await silent.transport().listTargets();
    expect(ids(offline!)[0]).toBe("container-adb-connect");
    expect(offline!.missingPrerequisites![0]!.message).toContain("wireless debugging with a pairing code");
  });

  it("stage 8: root comes from sudo -n, uid 0, or root login with the same key, in that order", async () => {
    const viaSudo = usbPhone(ATTACH_PHONE);
    const sudoSsh = viaSudo.transport();
    await sudoSsh.listTargets();
    expect(sudoSsh.describeConnection(TARGET)).toMatchObject({ rootVia: "sudo", attachSessionUser: "defaultuser" });
    expect(viaSudo.sshCalls.some((call) => call.remote === "true")).toBe(false);

    const asRoot = usbPhone({ ...ATTACH_PHONE, sudo: false, uid: 0 });
    const rootSsh = asRoot.transport();
    await rootSsh.listTargets();
    expect(rootSsh.describeConnection(TARGET)).toMatchObject({ rootVia: "login-root" });

    const rootLogin = usbPhone({ ...ATTACH_PHONE, sudo: false, rootLogin: true });
    const loginSsh = rootLogin.transport();
    await loginSsh.listTargets();
    expect(loginSsh.describeConnection(TARGET)).toMatchObject({ rootVia: "root-login", attachSessionUser: "root" });
    expect(rootLogin.sshCalls.at(-1)!.destination).toBe("root@192.168.2.15");
  });

  it("stage 8: no root is reported with the one-time key copy, naming the login user's home", async () => {
    const [target] = await usbPhone({ helpers: ["/usr/bin/container-attach"] })
      .transport()
      .listTargets();
    const message = target!.missingPrerequisites![1]!.message;
    expect(ids(target!)).toEqual(["container-adb-disabled", "root-access"]);
    expect(message).toContain("ssh -t defaultuser@192.168.2.15 devel-su");
    expect(message).toContain("cat /home/defaultuser/.ssh/authorized_keys >> /root/.ssh/authorized_keys");
  });

  it("stage 9: an attach helper counts only when getprop through it prints an SDK level", async () => {
    const phone = usbPhone({
      sudo: true,
      helpers: ["/usr/bin/broken-attach", "/usr/bin/container-attach"],
      attachResults: {
        "helper:/usr/bin/broken-attach": { exitCode: 0, firstLine: "" },
        "helper:/usr/bin/container-attach": { exitCode: 0, firstLine: "33" },
      },
    });
    const ssh = phone.transport();
    const [target] = await ssh.listTargets();

    expect(target).toMatchObject({ route: "container-attach", state: "device", apiLevel: 33, model: "Container" });
    expect(ids(target!)).toEqual(["container-adb-disabled"]);
    expect(ssh.describeConnection(TARGET)).toMatchObject({
      attachCommand: ["/usr/bin/container-attach"],
      hostOs: "Test Linux 1.0",
      routes: [
        { route: "container-adb", status: "unavailable" },
        { route: "container-attach", status: "usable", missing: [] },
      ],
    });
  });

  it("stage 9: a running LXC container is found when no helper is, and a configured command replaces detection", async () => {
    const lxc = usbPhone({
      sudo: true,
      lxc: true,
      lxcNames: ["android"],
      attachResults: { "lxc:android": { exitCode: 0, firstLine: "30" } },
    });
    const lxcSsh = lxc.transport();
    await lxcSsh.listTargets();
    expect(lxcSsh.describeConnection(TARGET)).toMatchObject({ attachCommand: ["lxc-attach", "-n", "android", "--"] });

    const configured = usbPhone({
      sudo: true,
      lxc: true,
      helpers: ["/usr/bin/container-attach"],
      attachResults: { configured: { exitCode: 0, firstLine: "33" } },
    });
    configured.system.env = { DROIDCTL_SSH_ATTACH_COMMAND: "my-attach --name 'android 1'" };
    const configuredSsh = configured.transport();
    await configuredSsh.listTargets();
    const probe = configured.sshCalls.find((call) => call.remote.includes("check"))!;
    expect(probe.remote).not.toContain("container-attach");
    expect(probe.remote).not.toContain("lxc-ls");
    expect(configuredSsh.describeConnection(TARGET)).toMatchObject({
      attachCommand: ["my-attach", "--name", "android 1"],
    });
  });

  it("stage 9: every failed candidate is listed with its output, and no candidate at all is said plainly", async () => {
    const failing = usbPhone({
      sudo: true,
      helpers: ["/usr/bin/container-attach"],
      attachResults: { "helper:/usr/bin/container-attach": { exitCode: 1, firstLine: "container is not running" } },
    });
    const [failed] = await failing.transport().listTargets();
    expect(ids(failed!)).toEqual(["container-adb-disabled", "attach-command"]);
    expect(failed!.missingPrerequisites![1]!.message).toContain(
      "/usr/bin/container-attach exited 1: container is not running",
    );

    const none = usbPhone({ sudo: true });
    const [empty] = await none.transport().listTargets();
    expect(empty!.missingPrerequisites![1]!.message).toContain("no candidate was found");
    expect(none.sshCalls).toHaveLength(1);

    const broken = usbPhone({ ...ATTACH_PHONE, attachProbeExit: 2 });
    const [probe] = await broken.transport().listTargets();
    expect(probe!.missingPrerequisites![1]!.message).toContain("probe exited 2: probe broke");
  });

  it("stage 10: adb ports the container announces are tried after the attach route finds them", async () => {
    const phone = usbPhone({
      ...ATTACH_PHONE,
      containerFacts: { exitCode: 0, stdout: "model=Container\nboot=1\nadbport=5556\nadbport=\ninet=10.0.3.2/24\n" },
      endpoints: { "10.0.3.2:5556": "device" },
    });
    const ssh = phone.transport();
    const [target] = await ssh.listTargets();

    expect(target).toMatchObject({ route: "container-adb", state: "device", missingPrerequisites: [] });
    expect(ssh.describeConnection(TARGET)).toMatchObject({
      containerAdbEndpoint: "10.0.3.2:5556",
      routes: [
        { route: "container-adb", status: "usable" },
        { route: "container-attach", status: "usable" },
      ],
    });
  });

  it("stage 10: an announced port the host shows listening on loopback is reached through 127.0.0.1", async () => {
    const phone = usbPhone({
      ...ATTACH_PHONE,
      listeners: ["0100007F:15B4"],
      containerFacts: { exitCode: 0, stdout: "boot=1\nadbport=5556\n" },
      endpoints: { "127.0.0.1:5556": "device" },
    });
    const [target] = await phone.transport().listTargets();
    expect(target!.route).toBe("container-adb");
    expect([...phone.tunnels.values()].map((tunnel) => tunnel.endpoint)).toEqual(["127.0.0.1:5556"]);
  });

  it("stage 10: an announced port with no listener and no container address is not tried", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, containerFacts: { exitCode: 0, stdout: "boot=1\nadbport=5556\n" } });
    const [target] = await phone.transport().listTargets();
    expect(target!.route).toBe("container-attach");
    expect(phone.tunnels.size).toBe(0);
  });

  it("stage 7: an adb listing that starts failing after connect is treated as a failed connection", async () => {
    const phone = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "silent" } });
    const adbExec = phone.adbExec;
    phone.adbExec = async (request) => {
      if (request.args[0] === "devices" && phone.connected.size > 0) {
        throw new Error("adb server died");
      }
      return adbExec(request);
    };
    const [target] = await phone.transport().listTargets();
    expect(ids(target!)[0]).toBe("container-adb-connect");
  });

  it("stage 5: a process table hidden from the login user does not block detection", async () => {
    const phone = usbPhone({ ...ADB_PHONE, android: "hidden" });
    const [target] = await phone.transport().listTargets();
    expect(target).toMatchObject({ state: "device", route: "container-adb" });
  });

  it("stage 9: an LXC container outside the default path is attached with its own lxcpath", async () => {
    const phone = usbPhone({
      sudo: true,
      lxc: true,
      lxcMonitors: [{ name: "defaultuser", path: "/srv/containers" }],
      attachResults: { "lxc:defaultuser@/srv/containers": { exitCode: 0, firstLine: "33" } },
    });
    const ssh = phone.transport();
    const [target] = await ssh.listTargets();
    expect(target!.route).toBe("container-attach");
    expect(ssh.describeConnection(TARGET)).toMatchObject({
      attachCommand: ["lxc-attach", "-P", "/srv/containers", "-n", "defaultuser", "--"],
    });
  });

  it("refuses stdin-fed tools on an attach command that dropped the stdin probe, and says why", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, attachStdin: false });
    const ssh = phone.transport();
    await ssh.listTargets();

    const capabilities = ssh.capabilities(TARGET);
    expect(capabilities.tools["droid_app.install_app"]).toBe("unsupported");
    expect(capabilities.tools["droid_app.write_app_file"]).toBe("unsupported");
    expect(capabilities.tools["droid_device.push_file"]).toBe("unsupported");
    expect(capabilities.tools["droid_app.read_app_file"]).toBe("supported");
    expect(capabilities.notes["droid_device.push_file"]).toContain("did not pass standard input into the container");

    const refused = await rejectionOf(ssh.exec(TARGET, ["run-as", "pkg", "sh", "-c", "cat > x"], { stdin: "data" }));
    expect(refused.code).toBe("unsupported_on_transport");
    expect(refused.message).toContain(
      "run-as was not run on ssh:defaultuser@192.168.2.15 because it needs standard input",
    );
    expect(phone.containerCalls.map((call) => call.argv[0])).not.toContain("run-as");
    expect((await ssh.exec(TARGET, ["true"])).exitCode).toBe(0);
  });

  it("reports a container that is still starting as booting on the attach route", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, containerFacts: { exitCode: 0, stdout: "boot=0\n" } });
    const [target] = await phone.transport().listTargets();
    expect(target).toMatchObject({ state: "booting", route: "container-attach", model: null });
  });

  it("keeps the attach route when the container facts cannot be read", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, containerFacts: { exitCode: 1, stdout: "" } });
    const [target] = await phone.transport().listTargets();
    expect(target).toMatchObject({ state: "device", route: "container-attach" });
  });
});

describe("ssh listing cost and liveness", () => {
  it("reuses a device tunnel without probing again, and probes again once the tunnel dies", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(1);

    phone.tunnels.get(40_000)!.handle.close(255);
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(2);
  });

  it("probes again when adb no longer lists the tunnel", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    phone.connected.clear();
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(2);
  });

  it("retries a blocked host only after the retry interval", async () => {
    const phone = usbPhone({ sshPort: { kind: "refused" } });
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.listTargets();
    expect(phone.system.tcpCalls).toHaveLength(1);

    phone.system.clock += BLOCKED_REPROBE_MS;
    await ssh.listTargets();
    expect(phone.system.tcpCalls).toHaveLength(2);
  });

  it("keeps the attach route while its ssh master runs, and re-probes when it stops or the interval passes", async () => {
    const phone = usbPhone(ATTACH_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(1);
    expect(phone.masterChecks).toEqual([SERIAL]);

    phone.scenario.masterRunning = false;
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(2);

    phone.scenario.masterRunning = true;
    phone.system.clock += ATTACH_REPROBE_MS;
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(3);
  });

  it("trusts the interval alone when multiplexing is unavailable", async () => {
    const phone = usbPhone(ATTACH_PHONE);
    phone.system.privateDirOk = false;
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.listTargets();
    expect(phone.masterChecks).toEqual([]);
    expect(phone.loginProbes()).toBe(1);
    expect(phone.sshCalls[0]!.args).toContain("ControlPath=none");
  });

  it("drops a host whose interface went away, closing its tunnel", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();

    phone.system.dirs.set("/sys/class/net", []);
    expect(await ssh.listTargets()).toEqual([]);
    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual(["SIGTERM"]);
    expect(phone.connected.has("127.0.0.1:40000")).toBe(false);
    expect(ssh.ownsAdbSerial("127.0.0.1:40000")).toBe(false);
  });

  it("runs one probe for concurrent listings", async () => {
    const phone = usbPhone(ATTACH_PHONE);
    const ssh = phone.transport();
    const [first, second] = await Promise.all([ssh.listTargets(), ssh.listTargets()]);
    expect(first).toEqual(second);
    expect(phone.loginProbes()).toBe(1);
  });

  it("joins a probe already running when the cached state has gone stale", async () => {
    const phone = usbPhone({ sshPort: { kind: "refused" } });
    const ssh = phone.transport();
    await ssh.listTargets();
    phone.system.clock += BLOCKED_REPROBE_MS;
    await Promise.all([ssh.listTargets(), ssh.listTargets()]);
    expect(phone.system.tcpCalls).toHaveLength(2);
  });

  it("tolerates an adb failure while checking tunnels by probing again", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    phone.scenario.adbInstalled = false;
    const [target] = await ssh.listTargets();
    expect(ids(target!)).toContain("adb-client");
  });

  it("closes every tunnel on dispose", async () => {
    const phone = usbPhone(ADB_PHONE);
    const ssh = phone.transport();
    await ssh.listTargets();
    await ssh.dispose();
    expect(phone.tunnels.get(40_000)!.handle.signals).toEqual(["SIGTERM"]);
    expect(ssh.ownsAdbSerial("127.0.0.1:40000")).toBe(false);
  });

  it("journals probes, tunnels and adb calls with the ssh target id", async () => {
    const phone = usbPhone(ADB_PHONE);
    await phone.transport().listTargets();
    const ssh = phone.commands.filter((record) => record.transport === "ssh");
    expect(ssh.map((record) => record.argv.includes("-N"))).toEqual([false, true]);
    expect(ssh.every((record) => record.targetId === `ssh:${SERIAL}`)).toBe(true);
    expect(phone.commands.some((record) => record.transport === "adb" && record.argv.includes("connect"))).toBe(true);
  });
});

describe("ssh capabilities and connection facts", () => {
  it("describes the attach route's floor when asked without a target", () => {
    const capabilities = new SshTransport({ system: new FakeSshSystem() }).capabilities();
    expect(capabilities.tools["droid_device.run_shell"]).toBe("supported");
    expect(capabilities.tools["droid_input.tap"]).toBe("supported");
    expect(capabilities.notes["droid_input.tap"]).toContain("checked against wm size inside the container");
    expect(capabilities.tools["droid_capture.ui_hierarchy"]).toBe("unsupported");
    expect(capabilities.notes["droid_capture.screenshot"]).toContain("blank frame is not detected");
  });

  it("refuses a target it never probed, and one with no route, with the prerequisites attached", async () => {
    const unprobed = new SshTransport({ system: new FakeSshSystem() }).capabilities(TARGET);
    expect(unprobed.unavailable?.message).toContain("has not been probed");

    const phone = usbPhone({ sshPort: { kind: "refused" } });
    const ssh = phone.transport();
    await ssh.listTargets();
    const blocked = ssh.capabilities(TARGET);
    expect(blocked.unavailable?.message).toContain("1. [developer-mode]");
    expect(blocked.unavailable?.details).toEqual({
      prerequisites: [expect.objectContaining({ id: "developer-mode" })],
    });
    expect(ssh.describeConnection(TARGET)).toMatchObject({
      route: null,
      routes: [
        { route: "container-adb", status: "not-checked" },
        { route: "container-attach", status: "not-checked" },
      ],
    });
    expect(ssh.describeConnection({ ...TARGET, serial: "other@host" })).toEqual({ route: null, probed: false });
  });

  it("supports every tool on the container adb route and explains each attach refusal with the adb blocker", async () => {
    const adbPhone = usbPhone(ADB_PHONE);
    const adbSsh = adbPhone.transport();
    await adbSsh.listTargets();
    expect(Object.values(adbSsh.capabilities(TARGET).tools).every((support) => support === "supported")).toBe(true);
    expect(adbSsh.describeConnection(TARGET)).toMatchObject({ adbSerial: "127.0.0.1:40000", route: "container-adb" });

    const attachPhone = usbPhone(ATTACH_PHONE);
    const attachSsh = attachPhone.transport();
    await attachSsh.listTargets();
    const capabilities = attachSsh.capabilities(TARGET);
    expect(capabilities.tools["droid_input.press_key"]).toBe("supported");
    expect(capabilities.tools["droid_capture.ui_hierarchy"]).toBe("unsupported");
    expect(capabilities.notes["droid_capture.ui_hierarchy"]).toContain(
      "It needs the container adb route, which is unavailable: [container-adb-disabled]",
    );
  });
});

describe("ssh operations on the container adb route", () => {
  it("hands every operation to adb with the tunnel's serial", async () => {
    const phone = usbPhone({ ...ADB_PHONE, shell: () => ({ stdout: "ok\n" }) });
    const ssh = phone.transport();
    await ssh.listTargets();
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-ssh-adb-"));
    const local = path.join(dir, "f.bin");
    await writeFile(local, "abc");
    phone.adbCalls.length = 0;

    expect((await ssh.exec(TARGET, ["input", "tap", "1", "2"])).stdout).toBe("ok\n");
    await ssh.pullBinary(TARGET, "/sdcard/x");
    await ssh.pushFile(TARGET, local, "/sdcard/f.bin");
    await ssh.installPackage(TARGET, "/tmp/app.apk", { allowDowngrade: true });
    await ssh.forwardPort(TARGET, 9222, { kind: "abstractSocket", name: "webview_devtools_remote_7" });
    await ssh.removeForward(TARGET, 9222);
    ssh.spawnShell(TARGET, ["screenrecord", "/sdcard/x.mp4"]);

    expect(phone.adbCalls.map((args) => args.slice(0, 3))).toEqual([
      ["-s", "127.0.0.1:40000", "shell"],
      ["-s", "127.0.0.1:40000", "exec-out"],
      ["-s", "127.0.0.1:40000", "push"],
      ["-s", "127.0.0.1:40000", "install"],
      ["-s", "127.0.0.1:40000", "forward"],
      ["-s", "127.0.0.1:40000", "forward"],
    ]);
    await expect(ssh.pullFile(TARGET, "/sdcard/x", path.join(dir, "pulled"))).rejects.toThrow(/wrote nothing/);
  });
});

describe("ssh operations on the container attach route", () => {
  async function attachTransport(shell: FakePhone["scenario"]["shell"]) {
    const phone = usbPhone({ ...ATTACH_PHONE, shell });
    const ssh = phone.transport();
    await ssh.listTargets();
    phone.sshCalls.length = 0;
    return { phone, ssh };
  }

  it("runs the Android argv inside the container through sudo and the verified attach command", async () => {
    const { phone, ssh } = await attachTransport((argv, stdin) => ({ stdout: `${argv.join("|")}:${stdin ?? ""}` }));

    const result = await ssh.exec(TARGET, ["run-as", "pkg", "sh", "-c", "cat > 'files/a b'"], { stdin: "payload" });

    expect(result.stdout).toBe("run-as|pkg|sh|-c|cat > 'files/a b':payload");
    expect(phone.containerCalls.at(-1)).toMatchObject({
      prefix: ["sudo", "-n", "/usr/bin/container-attach"],
      argv: ["run-as", "pkg", "sh", "-c", "cat > 'files/a b'"],
      destination: SERIAL,
    });
    expect(phone.sshCalls.at(-1)!.args).not.toContain("-n");
    await ssh.exec(TARGET, ["true"]);
    expect(phone.sshCalls.at(-1)!.args).toContain("-n");
  });

  it("returns bytes untouched for a buffer read, truncates at maxBytes, and throws on request for a failure", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { ssh } = await attachTransport((argv) =>
      argv[0] === "screencap"
        ? { stdout: png }
        : argv[0] === "false"
          ? { exitCode: 3, stderr: "no" }
          : { stdout: "0123456789" },
    );

    const shot = await ssh.exec(TARGET, ["screencap", "-p"], { encoding: "buffer" });
    expect(shot.stdout).toBe("");
    expect(shot.stdoutBytes.equals(png)).toBe(true);

    const clipped = await ssh.exec(TARGET, ["cat", "x"], { maxBytes: 4 });
    expect(clipped).toMatchObject({ stdout: "0123", truncated: true });

    expect((await ssh.exec(TARGET, ["false"])).exitCode).toBe(3);
    await expect(ssh.exec(TARGET, ["false"], { throwOnNonZeroExit: true })).rejects.toThrow(/Command failed on ssh:/);
  });

  it("reports a timeout as timeout, a lost connection as transport_unavailable, and a remote 255 as a result", async () => {
    const { phone, ssh } = await attachTransport(() => ({ exitCode: 255, stderr: "the app itself exited 255" }));
    expect((await ssh.exec(TARGET, ["exit-255"])).exitCode).toBe(255);

    phone.interceptSsh = () => ({ stdout: Buffer.alloc(0), stderr: "", exitCode: -1, timedOut: true });
    await expect(ssh.exec(TARGET, ["sleep", "99"], { timeoutMs: 10 })).rejects.toMatchObject({ code: "timeout" });

    phone.interceptSsh = () => ({
      stdout: Buffer.alloc(0),
      stderr: "client_loop: send disconnect: Broken pipe\n",
      exitCode: 255,
    });
    const lost = await rejectionOf(ssh.exec(TARGET, ["true"]));
    expect(lost.code).toBe("transport_unavailable");
    expect(lost.message).toContain(`The connection to ssh:${SERIAL} failed.`);
    expect(lost.details.prerequisites[0].id).toBe("ssh-failed");

    // A lost connection invalidates the diagnosis, so the next listing probes from the start.
    phone.interceptSsh = null;
    await ssh.listTargets();
    expect(phone.loginProbes()).toBe(1);

    phone.scenario.sshSpawnFails = true;
    const missing = await rejectionOf(ssh.exec(TARGET, ["true"]));
    expect(missing.code).toBe("transport_unavailable");
    expect(missing.details.prerequisites[0].id).toBe("ssh-client");
  });

  it("refuses a pull larger than the cap instead of returning part of the file", async () => {
    const phone = usbPhone({ ...ATTACH_PHONE, shell: () => ({ stdout: "0123456789" }) });
    const ssh = phone.transport({ pullMaxBytes: 4 });
    await ssh.listTargets();
    await expect(ssh.pullBinary(TARGET, "/sdcard/big")).rejects.toThrow(/larger than 4 bytes/);
  });

  it("reads, writes and installs through the container and verifies the byte count", async () => {
    const files = new Map<string, Buffer>();
    const { phone, ssh } = await attachTransport((argv, stdin) => {
      if (argv[0] === "cat" && argv[1] === "/sdcard/in.bin") return { stdout: Buffer.from("device-bytes") };
      if (argv[0] === "cat") return { exitCode: 1, stderr: "No such file" };
      if (argv[0] === "sh" && argv[2]!.startsWith("cat > /sdcard/short")) return { stdout: "1\n" };
      if (argv[0] === "sh" && argv[2]!.startsWith("cat > /sdcard/readonly"))
        return { exitCode: 1, stderr: "Read-only file system" };
      if (argv[0] === "sh") {
        files.set("pushed", stdin!);
        return { stdout: `${stdin!.length}\n` };
      }
      if (argv[0] === "pm") return { stdout: `Success ${argv.join(" ")} ${stdin!.length}\n` };
      return {};
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-ssh-attach-"));
    const local = path.join(dir, "local.bin");
    await writeFile(local, Buffer.from([0, 1, 2, 255]));

    expect((await ssh.pullBinary(TARGET, "/sdcard/in.bin")).toString()).toBe("device-bytes");
    await expect(ssh.pullBinary(TARGET, "/sdcard/missing")).rejects.toThrow(/Unable to read \/sdcard\/missing/);
    const pulledTo = path.join(dir, "nested", "out.bin");
    expect(await ssh.pullFile(TARGET, "/sdcard/in.bin", pulledTo)).toBe(12);
    expect((await readFile(pulledTo)).toString()).toBe("device-bytes");

    expect(await ssh.pushFile(TARGET, local, "/sdcard/local.bin")).toBe(4);
    expect(files.get("pushed")).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(phone.containerCalls.at(-1)!.argv).toEqual([
      "sh",
      "-c",
      "cat > /sdcard/local.bin && wc -c < /sdcard/local.bin",
    ]);
    await expect(ssh.pushFile(TARGET, local, "/sdcard/short")).rejects.toThrow(/reports 1 of 4 bytes/);
    await expect(ssh.pushFile(TARGET, local, "/sdcard/readonly")).rejects.toThrow(
      /reports no of 4 bytes\. Read-only file system/,
    );

    const install = await ssh.installPackage(TARGET, local, { grantPermissions: true });
    expect(install).toMatchObject({ installed: true, signatureMismatch: false });
    expect(install.stdout).toContain("Success pm install -r -g -S 4 4");
  });

  it("refuses detached commands and port forwards with the container adb blocker", async () => {
    const { ssh } = await attachTransport(() => ({}));
    expect(() => ssh.spawnShell(TARGET, ["screenrecord", "x"])).toThrow(
      /A detached command needs the container adb route/,
    );
    const forward = await rejectionOf(ssh.forwardPort(TARGET, 9222, { kind: "tcp", port: 1 }));
    expect(forward.code).toBe("unsupported_on_transport");
    expect(forward.message).toContain("[container-adb-disabled]");
    await expect(ssh.removeForward(TARGET, 9222)).rejects.toMatchObject({ code: "unsupported_on_transport" });
  });

  it("refuses every operation on a target with no route", async () => {
    const phone = usbPhone({ sshPort: { kind: "refused" } });
    const ssh = phone.transport();
    await ssh.listTargets();
    const error = await rejectionOf(ssh.exec(TARGET, ["true"]));
    expect(error.code).toBe("transport_unavailable");
    expect(error.details.prerequisites[0].id).toBe("developer-mode");
  });
});
