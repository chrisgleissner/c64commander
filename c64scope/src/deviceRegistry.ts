/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

/**
 * The device under test is named, never guessed at. This walked a hardcoded priority
 * list of two Samsungs, neither of which is on this bench, so it resolved nothing
 * while looking deliberate. ANDROID_SERIAL is adb's own variable, so setting it once
 * points every runner here and adb itself at the same device.
 */
export async function resolveConfiguredDeviceSerial(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configured = (env["ANDROID_SERIAL"] ?? "").trim();
  if (configured) {
    return resolveAdbSerial(configured);
  }

  const { stdout } = await execFileAsync("adb", ["devices", "-l"]);
  const connectedSerials = parseConnectedDeviceSerials(stdout);
  throw new Error(
    "No Android device was named. Set ANDROID_SERIAL, or pass the serial explicitly. " +
      `Connected: ${connectedSerials.join(", ") || "(none)"}`,
  );
}
