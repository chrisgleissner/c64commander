/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAdbSerial, resolveConfiguredDeviceSerial } from "../src/deviceRegistry.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

function mockAdbDevicesOutput(output: string): void {
  const execFileMock = vi.mocked(execFile);
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
      cb(null, { stdout: output });
    },
  );
}

const TWO_DEVICES = [
  "List of devices attached",
  "9B081FFAZ001WX         device usb:5-2 product:flame model:Pixel_4",
  "R5CT123456X            device usb:5-3 product:x1s model:SM_G781B",
  "",
].join("\n");

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolveAdbSerial", () => {
  it("returns a full serial without consulting adb", async () => {
    await expect(resolveAdbSerial("9B081FFAZ001WX")).resolves.toBe("9B081FFAZ001WX");
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });

  it("expands a prefix that matches exactly one connected device", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveAdbSerial("9B0")).resolves.toBe("9B081FFAZ001WX");
  });

  it("refuses a prefix that matches nothing, and names what is connected", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveAdbSerial("ZZZ")).rejects.toThrow(/9B081FFAZ001WX/);
  });

  it("refuses a prefix that matches more than one device rather than picking", async () => {
    mockAdbDevicesOutput(
      ["List of devices attached", "9B0AAAAAAAAAAA         device", "9B0BBBBBBBBBBB         device", ""].join("\n"),
    );
    await expect(resolveAdbSerial("9B0")).rejects.toThrow(/Multiple/);
  });
});

/**
 * This used to walk a hardcoded priority list of two Samsungs. Neither is on this
 * bench, and the Pixel that is was not in the list, so it resolved nothing while
 * looking deliberate.
 */
describe("resolveConfiguredDeviceSerial", () => {
  it("uses the serial named in ANDROID_SERIAL", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveConfiguredDeviceSerial({ ANDROID_SERIAL: "9B081FFAZ001WX" })).resolves.toBe("9B081FFAZ001WX");
  });

  it("accepts a prefix there, and still refuses an ambiguous one", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveConfiguredDeviceSerial({ ANDROID_SERIAL: "9B0" })).resolves.toBe("9B081FFAZ001WX");
  });

  it("refuses to choose when no device is named, and lists what is connected", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveConfiguredDeviceSerial({})).rejects.toThrow(/No Android device was named/);
    await expect(resolveConfiguredDeviceSerial({})).rejects.toThrow(/9B081FFAZ001WX/);
  });

  it("treats a blank ANDROID_SERIAL as naming nothing", async () => {
    mockAdbDevicesOutput(TWO_DEVICES);
    await expect(resolveConfiguredDeviceSerial({ ANDROID_SERIAL: "   " })).rejects.toThrow(/No Android device/);
  });

  it("never picks a device just because it is the only one connected", async () => {
    mockAdbDevicesOutput(["List of devices attached", "9B081FFAZ001WX         device", ""].join("\n"));
    await expect(resolveConfiguredDeviceSerial({})).rejects.toThrow(/No Android device was named/);
  });
});
