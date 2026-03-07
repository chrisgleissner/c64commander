/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface PhysicalTestDevice {
  id: string;
  name: string;
  serialPrefix: string;
}

export const physicalTestDevices = [
  {
    id: "samsung-galaxy-s21-fe",
    name: "Samsung Galaxy S21 FE",
    serialPrefix: "R5C",
  },
] as const satisfies readonly PhysicalTestDevice[];

export const defaultPhysicalTestDevice = physicalTestDevices[0];
const execFileAsync = promisify(execFile);

if (!defaultPhysicalTestDevice) {
  throw new Error("Device registry is empty; at least one physical test device is required.");
}

function parseConnectedDeviceSerials(adbOutput: string): string[] {
  return adbOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("List of devices attached"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length > 1 && parts[1] === "device")
    .map((parts) => parts[0]!)
    .filter((serial) => serial.length > 0);
}

export async function resolveAdbSerial(serialOrPrefix: string): Promise<string> {
  if (serialOrPrefix.length > 3) {
    return serialOrPrefix;
  }

  const { stdout } = await execFileAsync("adb", ["devices", "-l"]);
  const connectedSerials = parseConnectedDeviceSerials(stdout);
  const candidates = connectedSerials.filter((serial) => serial.startsWith(serialOrPrefix));

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  if (candidates.length === 0) {
    throw new Error(
      `No connected Android device matched prefix "${serialOrPrefix}". Connected devices: ${
        connectedSerials.join(", ") || "(none)"
      }`,
    );
  }

  throw new Error(`Multiple connected Android devices matched prefix "${serialOrPrefix}": ${candidates.join(", ")}`);
}
