/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The six tests spec §11.2 requires, kept in one file so a reviewer can find them.
 */

import { describe, expect, it } from "vitest";
import { adbArgs } from "../src/transport/adb.js";
import { FakeTransport, defaultTarget } from "../src/transport/fake.js";
import { TransportRegistry } from "../src/transport/registry.js";
import { TargetResolutionError } from "../src/tools/errors.js";
import { isApplicationScoped, requiresTarget } from "../src/tools/policy.js";
import { listToolDescriptors } from "../src/tools/registry.js";
import { createTestContext, invoke } from "./support/harness.js";

function generateArgumentVectors(): string[][] {
  const words = ["shell", "input", "tap", "-r", "--time-limit", "/sdcard/x y.png", "", "pm", "list", "packages"];
  const vectors: string[][] = [[]];
  let seed = 7;
  for (let index = 0; index < 60; index += 1) {
    const length = index % 6;
    const vector: string[] = [];
    for (let position = 0; position < length; position += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      vector.push(words[seed % words.length]!);
    }
    vectors.push(vector);
  }
  return vectors;
}

describe("targeting: 1. adbArgs always carries an explicit serial", () => {
  it("emits -s <serial> ahead of every generated argument vector", () => {
    for (const rest of generateArgumentVectors()) {
      const argv = adbArgs("9B0EXAMPLE", rest);
      expect(argv[0]).toBe("-s");
      expect(argv[1]).toBe("9B0EXAMPLE");
      expect(argv.slice(2)).toEqual(rest);
    }
  });

  it("refuses to build an invocation with no serial", () => {
    expect(() => adbArgs("", ["shell", "input", "tap"])).toThrow(/non-empty serial/);
    expect(() => adbArgs("   ", ["devices"])).toThrow(/non-empty serial/);
  });
});

describe("targeting: 2. every tool but list_targets requires a target", () => {
  it("declares targetId in required, derived from the registry", () => {
    // The count assertion first: without it, a requiresTarget that returned
    // false for everything would leave nothing to check and the test would pass.
    const targeted = listToolDescriptors().filter((descriptor) => requiresTarget(descriptor.name));
    expect(targeted.length).toBeGreaterThanOrEqual(20);
    const offenders = targeted
      .filter((descriptor) => !(descriptor.inputSchema.required ?? []).includes("targetId"))
      .map((descriptor) => descriptor.name);
    expect(offenders).toEqual([]);
  });

  it("leaves list_targets targetless, since it is what issues target ids", () => {
    const listTargets = listToolDescriptors().find((d) => d.name === "droid_target.list_targets");
    expect(listTargets?.inputSchema.required ?? []).toEqual([]);
  });
});

describe("targeting: 3. every application-scoped tool requires a package", () => {
  it("declares package in required, derived from the registry", () => {
    const scoped = listToolDescriptors().filter((descriptor) => isApplicationScoped(descriptor.name));
    expect(scoped.length).toBeGreaterThanOrEqual(8);
    const offenders = scoped
      .filter((descriptor) => !(descriptor.inputSchema.required ?? []).includes("package"))
      .map((descriptor) => descriptor.name);
    expect(offenders).toEqual([]);
  });
});

describe("targeting: 4. list_targets offers no default", () => {
  it("returns no key matching default, preferred or current", async () => {
    const { ctx } = await createTestContext();
    const result = await invoke("droid_target.list_targets", {}, ctx);
    expect(result.ok).toBe(true);

    const keys: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key);
          walk(nested);
        }
      }
    };
    walk(result.data);
    expect(keys).toContain("targetId");
    expect(keys.filter((key) => /default|preferred|current/i.test(key))).toEqual([]);
  });
});

describe("targeting: 5. a colliding target id is an error, not a pick", () => {
  it("reports ambiguous_target listing both candidates", async () => {
    const transport = new FakeTransport([
      defaultTarget({ targetId: "adb:DUPLICATE", serial: "DUPLICATE", model: "Pixel_4" }),
      defaultTarget({ targetId: "adb:DUPLICATE", serial: "DUPLICATE", model: "emulator", isEmulator: true }),
    ]);
    const registry = new TransportRegistry([transport]);

    await expect(registry.resolve("adb:DUPLICATE")).rejects.toBeInstanceOf(TargetResolutionError);
    const error = await registry.resolve("adb:DUPLICATE").catch((caught: TargetResolutionError) => caught);
    expect(error.code).toBe("ambiguous_target");
    expect((error.details?.["candidates"] as unknown[]).length).toBe(2);
  });

  it("still refuses when exactly one device is connected but the id does not match it", async () => {
    const transport = new FakeTransport([defaultTarget({ targetId: "adb:ONLYONE", serial: "ONLYONE" })]);
    const registry = new TransportRegistry([transport]);

    const error = await registry.resolve("adb:SOMETHINGELSE").catch((caught: TargetResolutionError) => caught);
    expect(error.code).toBe("target_not_found");
    expect(error.details?.["availableTargetIds"]).toEqual(["adb:ONLYONE"]);
  });

  it("does not resolve a prefix of a valid id", async () => {
    const transport = new FakeTransport([defaultTarget({ targetId: "adb:9B081FFAZ001WX", serial: "9B081FFAZ001WX" })]);
    const registry = new TransportRegistry([transport]);

    const error = await registry.resolve("adb:9B0").catch((caught: TargetResolutionError) => caught);
    expect(error.code).toBe("target_not_found");
  });
});

describe("targeting: 6. a stale target id touches no device", () => {
  it("returns target_not_found and records zero device calls", async () => {
    const transport = new FakeTransport([defaultTarget({ targetId: "adb:STILLHERE", serial: "STILLHERE" })]);
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.stop_app",
      { targetId: "adb:GONE", package: "uk.gleissner.c64commander" },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("target_not_found");
    expect(transport.calls.filter((call) => call.kind !== "listTargets")).toEqual([]);
  });
});
