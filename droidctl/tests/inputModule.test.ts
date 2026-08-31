/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { KEYCODES, resolveKeycode } from "../src/keycodes.js";
import { assertOnScreen, convertCoordinate } from "../src/tools/modules/input.js";
import { FakeTransport } from "../src/transport/fake.js";
import { createTestContext, invoke, withDeviceDefaults } from "./support/harness.js";

const TARGET = "adb:TESTSERIAL01";

describe("coordinate conversion", () => {
  it("passes physical coordinates through and rounds", () => {
    expect(convertCoordinate(120.4, "physical", undefined)).toBe(120);
    expect(convertCoordinate(120.6, undefined, undefined)).toBe(121);
  });

  it("multiplies CSS coordinates by dpr once, here rather than in each caller", () => {
    expect(convertCoordinate(160, "css", 2.75)).toBe(440);
    expect(convertCoordinate(100, "css", 1.5)).toBe(150);
  });

  it("refuses CSS units without a dpr", () => {
    expect(() => convertCoordinate(160, "css", undefined)).toThrow(/requires dpr/);
  });
});

describe("screen bounds", () => {
  it("accepts a point inside the screen and rejects one outside", () => {
    expect(() => assertOnScreen([{ x: 0, y: 0 }], { width: 100, height: 100 })).not.toThrow();
    expect(() => assertOnScreen([{ x: 99, y: 99 }], { width: 100, height: 100 })).not.toThrow();
    expect(() => assertOnScreen([{ x: 100, y: 10 }], { width: 100, height: 100 })).toThrow(/outside the 100x100/);
    expect(() => assertOnScreen([{ x: -1, y: 10 }], { width: 100, height: 100 })).toThrow(/outside the 100x100/);
  });
});

describe("droid_input.tap", () => {
  it("taps at converted CSS coordinates", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.tap", { targetId: TARGET, x: 160, y: 200, units: "css", dpr: 2.75 }, ctx);

    expect(result.data).toMatchObject({ tapped: true, x: 440, y: 550, holdMs: null });
    expect(transport.execArgvLines()).toContain("input tap 440 550");
  });

  it("presses and holds with an explicit release, which is a different gesture", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.tap", { targetId: TARGET, x: 10, y: 20, hold: 5 }, ctx);

    expect(result.data.holdMs).toBe(5);
    const lines = transport.execArgvLines();
    expect(lines).toContain("input motionevent DOWN 10 20");
    expect(lines).toContain("input motionevent UP 10 20");
    expect(lines).not.toContain("input tap 10 20");
  });

  it("refuses an off-screen tap before injecting it", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.tap", { targetId: TARGET, x: 5000, y: 20 }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/outside the 1080x2280 screen/);
    expect(transport.execArgvLines().some((line) => line.startsWith("input"))).toBe(false);
  });

  it("refuses to inject when the screen size cannot be read", async () => {
    const transport = new FakeTransport();
    transport.respondTo("wm size", { stdout: "" });
    transport.respondTo("wm density", { stdout: "" });
    transport.respondTo("getprop", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.tap", { targetId: TARGET, x: 10, y: 10 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/Unable to read the screen size/);
  });

  it("reports a failing input command", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    transport.respondTo("input tap", { exitCode: 1, stderr: "Error: Injecting to another application requires..." });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.tap", { targetId: TARGET, x: 10, y: 10 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/input tap 10 10 failed/);
  });
});

describe("droid_input.swipe", () => {
  it("swipes with the default duration and validates both endpoints", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.swipe", { targetId: TARGET, x1: 10, y1: 20, x2: 30, y2: 40 }, ctx);

    expect(result.data.durationMs).toBe(250);
    expect(transport.execArgvLines()).toContain("input swipe 10 20 30 40 250");
  });

  it("refuses a swipe whose end point is off screen", async () => {
    const transport = withDeviceDefaults(new FakeTransport());
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.swipe", { targetId: TARGET, x1: 10, y1: 20, x2: 30, y2: 9999 }, ctx);
    expect(result.ok).toBe(false);
    expect(transport.execArgvLines().some((line) => line.startsWith("input swipe"))).toBe(false);
  });
});

describe("droid_input.input_text", () => {
  it("sends the text", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.input_text", { targetId: TARGET, text: "hello" }, ctx);
    expect(result.data.characters).toBe(5);
    expect(transport.execArgvLines()).toContain("input text hello");
  });
});

describe("droid_input.press_key", () => {
  it("accepts a number, a KEYCODE_ name and a bare name", () => {
    expect(resolveKeycode(20)).toBe(20);
    expect(resolveKeycode("KEYCODE_DPAD_DOWN")).toBe(20);
    expect(resolveKeycode("dpad_down")).toBe(20);
    expect(resolveKeycode("23")).toBe(23);
    expect(KEYCODES["KEYCODE_BACK"]).toBe(4);
  });

  it("rejects an unknown name and a negative number", () => {
    expect(() => resolveKeycode("KEYCODE_NOT_A_KEY")).toThrow(/Unknown keycode/);
    expect(() => resolveKeycode(-1)).toThrow(/non-negative integer/);
  });

  it("sends a long press the requested number of times", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_input.press_key",
      { targetId: TARGET, keycode: "KEYCODE_DPAD_DOWN", longPress: true, repeat: 3 },
      ctx,
    );

    expect(result.data).toMatchObject({ keycode: 20, repeat: 3, longPress: true });
    expect(transport.execArgvLines().filter((line) => line === "input keyevent --longpress 20")).toHaveLength(3);
  });

  it("reports a failing keyevent", async () => {
    const transport = new FakeTransport();
    transport.respondTo("input keyevent", { exitCode: 1, stderr: "no" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_input.press_key", { targetId: TARGET, keycode: 4 }, ctx);
    expect(result.ok).toBe(false);
  });
});
