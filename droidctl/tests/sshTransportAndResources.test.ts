/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Nothing here needs a device of that kind, and nothing here is a claim about one.
 * The stub is expected to refuse; the test checks it refuses usefully.
 */

import { describe, expect, it } from "vitest";
import { KEYCODES } from "../src/keycodes.js";
import { listResources, readResource, resources } from "../src/resources.js";
import { listToolDescriptors } from "../src/tools/registry.js";
import { SSH_TRANSPORT_PROBES, SshTransport, sshTransportProbeProcedure } from "../src/transport/ssh.js";
import type { ResolvedTarget } from "../src/transport/types.js";

const TARGET: ResolvedTarget = { targetId: "ssh:device", transport: "ssh", serial: "device" };

describe("the ssh transport stub", () => {
  const transport = new SshTransport();

  it("refuses every operation with transport_unavailable", async () => {
    const operations: [string, () => unknown][] = [
      ["listTargets", () => transport.listTargets()],
      ["exec", () => transport.exec()],
      ["pullBinary", () => transport.pullBinary()],
      ["pullFile", () => transport.pullFile()],
      ["pushFile", () => transport.pushFile()],
      ["installPackage", () => transport.installPackage()],
      ["forwardPort", () => transport.forwardPort()],
      ["removeForward", () => transport.removeForward()],
    ];

    for (const [name, run] of operations) {
      await expect(Promise.resolve().then(run), name).rejects.toMatchObject({ code: "transport_unavailable" });
    }
    expect(() => transport.spawnShell(TARGET, ["screenrecord"])).toThrow(/not implemented/);
  });

  it("names the check that would settle each open question in the refusal", async () => {
    const error = await transport.listTargets().catch((caught: Error) => caught);
    for (const probe of SSH_TRANSPORT_PROBES) {
      expect(error.message).toContain(probe.id);
      expect(error.message).toContain(probe.check);
    }
    expect(sshTransportProbeProcedure()).toContain("Q4");
  });

  it("reports every tool it cannot do as unknown or unsupported, never as supported by guess", () => {
    const capabilities = transport.capabilities();
    const registered = listToolDescriptors().map((descriptor) => descriptor.name);

    expect(Object.keys(capabilities.tools).sort()).toEqual([...registered].sort());
    const claimed = Object.entries(capabilities.tools)
      .filter(([, support]) => support === "supported")
      .map(([name]) => name);
    expect(claimed.sort()).toEqual(["droid_capture.logcat", "droid_device.run_shell"]);
    expect(capabilities.notes["droid_device.run_shell"]).toMatch(/exit code of 0 is not evidence/);
  });
});

describe("resources", () => {
  it("lists every resource with a uri, name, description and mime type", () => {
    expect(listResources()).toHaveLength(resources.length);
    for (const entry of listResources()) {
      expect(entry.uri.startsWith("droidctl://")).toBe(true);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.mimeType.length).toBeGreaterThan(0);
    }
    expect(readResource("droidctl://nope")).toBeUndefined();
  });

  it("serves the keycode table in both directions, including the keypad set", () => {
    const table = JSON.parse(readResource("droidctl://reference/keycodes")!.readText());
    expect(table.byName.KEYCODE_DPAD_UP).toBe(19);
    expect(table.byName.KEYCODE_DPAD_DOWN).toBe(20);
    expect(table.byName.KEYCODE_DPAD_LEFT).toBe(21);
    expect(table.byName.KEYCODE_DPAD_RIGHT).toBe(22);
    expect(table.byName.KEYCODE_DPAD_CENTER).toBe(23);
    expect(table.byName.KEYCODE_BACK).toBe(4);
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(table.byName[`KEYCODE_${digit}`]).toBe(7 + digit);
    }
    expect(table.byNumber["20"]).toBe("KEYCODE_DPAD_DOWN");
    expect(Object.keys(table.byName)).toHaveLength(Object.keys(KEYCODES).length);
  });

  it("serves a support matrix covering every registered tool on both transports", () => {
    const matrix = JSON.parse(readResource("droidctl://reference/transport-support")!.readText());
    for (const descriptor of listToolDescriptors()) {
      expect(matrix[descriptor.name]).toBeDefined();
      expect(matrix[descriptor.name].adb).toBe("supported");
      expect(["supported", "unsupported", "unknown"]).toContain(matrix[descriptor.name].ssh);
    }
  });

  it("serves the probe list and the targeting rules", () => {
    expect(JSON.parse(readResource("droidctl://reference/ssh-transport-probes")!.readText())).toHaveLength(
      SSH_TRANSPORT_PROBES.length,
    );
    const rules = readResource("droidctl://reference/targeting-rules")!.readText();
    expect(rules).toMatch(/no default, preferred or current target/);
    expect(rules).toMatch(/refuses to guess|refusing|error listing the candidates/);
  });
});
