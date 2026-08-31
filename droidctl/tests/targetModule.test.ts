/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { FakeTransport, defaultTarget } from "../src/transport/fake.js";
import { SshTransport } from "../src/transport/ssh.js";
import { createTestContext, invoke, withDeviceDefaults } from "./support/harness.js";

describe("droid_target.list_targets", () => {
  it("returns every target with transport, state and emulator flag", async () => {
    const transport = new FakeTransport([
      defaultTarget(),
      defaultTarget({ targetId: "adb:emulator-5554", serial: "emulator-5554", isEmulator: true, state: "offline" }),
    ]);
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_target.list_targets", {}, ctx);
    expect(result.ok).toBe(true);
    expect(result.data.targets).toHaveLength(2);
    expect(result.data.targets[1]).toMatchObject({ isEmulator: true, state: "offline" });
  });

  it("reports a failing transport per transport instead of hiding the working one", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport, extraTransports: [new SshTransport()] });

    const result = await invoke("droid_target.list_targets", {}, ctx);
    expect(result.data.targets).toHaveLength(1);
    expect(result.data.transportErrors).toEqual([
      { transport: "ssh", message: expect.stringContaining("not implemented") },
    ]);
  });

  it("restricts enumeration when transports is given", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport, extraTransports: [new SshTransport()] });

    const result = await invoke("droid_target.list_targets", { transports: ["ssh"] }, ctx);
    expect(result.data.targets).toEqual([]);
    expect(result.data.transportErrors).toHaveLength(1);
  });
});

describe("droid_target.describe_target", () => {
  it("reports build properties and derives the device pixel ratio from the density", async () => {
    const { ctx } = await createTestContext({ transport: withDeviceDefaults(new FakeTransport()) });

    const result = await invoke("droid_target.describe_target", { targetId: "adb:TESTSERIAL01" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      model: "Pixel 4",
      apiLevel: 33,
      release: "13",
      hardware: "flame",
      screen: { width: 1080, height: 2280, density: 440, dpr: 2.75 },
      sizeOverride: null,
      densityOverride: null,
    });
  });

  it("reports a leftover display override, which no other tool would surface", async () => {
    const transport = withDeviceDefaults(new FakeTransport(), { sizeOverride: "480x640", densityOverride: 240 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_target.describe_target", { targetId: "adb:TESTSERIAL01" }, ctx);
    expect(result.data.sizeOverride).toBe("480x640");
    expect(result.data.densityOverride).toBe(240);
    expect(result.data.screen).toMatchObject({ width: 480, height: 640, density: 240, dpr: 1.5 });
  });

  it("fails with target_not_found for an id no transport reports", async () => {
    const { ctx } = await createTestContext({ transport: withDeviceDefaults(new FakeTransport()) });

    const result = await invoke("droid_target.describe_target", { targetId: "adb:NOPE" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("target_not_found");
  });
});
