/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  physicalTestDevices,
  resolveAdbSerial,
  resolvePreferredPhysicalTestDeviceSerial,
} from "../src/deviceRegistry.js";

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

describe("deviceRegistry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through full serials without adb lookup", async () => {
    await expect(resolveAdbSerial("R5C12345678")).resolves.toBe("R5C12345678");
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });

  it("resolves a unique serial from a 3-char prefix", async () => {
    mockAdbDevicesOutput(
      [
        "List of devices attached",
        "R5C12345678\tdevice product:x model:Galaxy device:y transport_id:1",
        "emulator-5554\tdevice product:sdk model:Android device:emu transport_id:2",
      ].join("\n"),
    );

    await expect(resolveAdbSerial("R5C")).resolves.toBe("R5C12345678");
  });

  it("fails when no connected serial matches the prefix", async () => {
    mockAdbDevicesOutput(
      ["List of devices attached", "emulator-5554\tdevice product:sdk model:Android device:emu transport_id:2"].join(
        "\n",
      ),
    );

    await expect(resolveAdbSerial("R5C")).rejects.toThrow('No connected Android device matched prefix "R5C"');
  });

  it("fails when multiple connected serials match the prefix", async () => {
    mockAdbDevicesOutput(
      [
        "List of devices attached",
        "R5C12345678\tdevice product:x model:Galaxy device:y transport_id:1",
        "R5CABCDEFGH\tdevice product:x model:Galaxy device:y transport_id:3",
      ].join("\n"),
    );

    await expect(resolveAdbSerial("R5C")).rejects.toThrow(
      'Multiple connected Android devices matched prefix "R5C": R5C12345678, R5CABCDEFGH',
    );
  });

  it("ignores non-device adb rows when resolving prefixes", async () => {
    mockAdbDevicesOutput(
      [
        "List of devices attached",
        "R5CUNAUTHORIZED\tunauthorized usb:1-1 transport_id:4",
        "R5COFFLINE\toffline transport_id:5",
        "R5C12345678\tdevice product:x model:Galaxy device:y transport_id:1",
      ].join("\n"),
    );

    await expect(resolveAdbSerial("R5C")).resolves.toBe("R5C12345678");
  });

  it("defines note 3 as primary and s21 fe as fallback", () => {
    expect(physicalTestDevices[0]).toMatchObject({
      id: "samsung-galaxy-note-3",
      serialOrPrefix: "211",
    });
    expect(physicalTestDevices[1]).toMatchObject({
      id: "samsung-galaxy-s21-fe",
      serialOrPrefix: "R5C",
    });
  });

  it("resolves primary device when available", async () => {
    mockAdbDevicesOutput(
      [
        "List of devices attached",
        "211\tdevice product:hlte model:SM_N9005 device:hlte transport_id:1",
        "R5C\tdevice product:r9qxeea model:SM_G990B device:r9q transport_id:2",
      ].join("\n"),
    );

    await expect(resolvePreferredPhysicalTestDeviceSerial()).resolves.toBe("211");
  });

  it("falls back to s21 fe when primary is unavailable", async () => {
    mockAdbDevicesOutput(
      ["List of devices attached", "R5C\tdevice product:r9qxeea model:SM_G990B device:r9q transport_id:2"].join("\n"),
    );

    await expect(resolvePreferredPhysicalTestDeviceSerial()).resolves.toBe("R5C");
  });

  it("fails when multiple fallback devices match a configured prefix", async () => {
    mockAdbDevicesOutput(
      [
        "List of devices attached",
        "R5C12345678\tdevice product:x model:Galaxy device:y transport_id:1",
        "R5CABCDEFGH\tdevice product:x model:Galaxy device:y transport_id:2",
      ].join("\n"),
    );

    await expect(resolvePreferredPhysicalTestDeviceSerial()).rejects.toThrow(
      /Multiple connected Android devices matched fallback prefix "R5C"/,
    );
  });

  it("fails when no configured physical test device is connected", async () => {
    mockAdbDevicesOutput(["List of devices attached", "emulator-5554\tdevice product:sdk model:Android"].join("\n"));

    await expect(resolvePreferredPhysicalTestDeviceSerial()).rejects.toThrow(
      /No configured physical test device is connected/,
    );
  });
});
