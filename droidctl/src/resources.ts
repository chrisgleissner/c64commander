/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { KEYCODES, KEYCODE_NAMES_BY_NUMBER } from "./keycodes.js";
import { AdbTransport } from "./transport/adb.js";
import { ATTACH_ROUTE_SUPPORT, CONTAINER_ADB_ONLY, sshTransportReference } from "./transport/ssh.js";
import type { TransportCapabilities } from "./transport/types.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  readText: () => string;
}

/**
 * One column per transport, or per route where a transport has several. A note
 * comes from the first column that has one, which on this surface is the ssh
 * attach route explaining a refusal.
 */
export function buildTransportMatrix(
  columns: Readonly<Record<string, TransportCapabilities>>,
): Record<string, Record<string, string>> {
  const names = new Set(Object.values(columns).flatMap((capabilities) => Object.keys(capabilities.tools)));
  const matrix: Record<string, Record<string, string>> = {};
  for (const name of [...names].sort()) {
    const entry: Record<string, string> = {};
    for (const [column, capabilities] of Object.entries(columns)) {
      entry[column] = capabilities.tools[name] ?? "unknown";
      const note = capabilities.notes[name];
      if (note && entry["note"] === undefined) {
        entry["note"] = note;
      }
    }
    matrix[name] = entry;
  }
  return matrix;
}

function transportMatrix(): Record<string, Record<string, string>> {
  const adb = new AdbTransport().capabilities();
  return buildTransportMatrix({
    adb,
    "ssh/container-adb": { transport: "ssh", tools: adb.tools, notes: {} },
    "ssh/container-attach": { transport: "ssh", tools: ATTACH_ROUTE_SUPPORT, notes: CONTAINER_ADB_ONLY },
  });
}

export const resources: ResourceDefinition[] = [
  {
    uri: "droidctl://reference/keycodes",
    name: "Android Keycodes",
    description: "Android key event names and numbers, both directions, as accepted by droid_input.press_key.",
    mimeType: "application/json",
    readText: () => JSON.stringify({ byName: KEYCODES, byNumber: KEYCODE_NAMES_BY_NUMBER }, null, 2),
  },
  {
    uri: "droidctl://reference/transport-support",
    name: "Transport Support Matrix",
    description:
      "Per-tool support for adb and for each ssh route. A refused tool is reported at runtime with its reason, never approximated.",
    mimeType: "application/json",
    readText: () => JSON.stringify(transportMatrix(), null, 2),
  },
  {
    uri: "droidctl://reference/ssh-transport",
    name: "SSH Transport",
    description:
      "How an Android container on a Linux phone is detected over SSH: the detection order, the routes, every " +
      "prerequisite droidctl can report as missing, and the configuration variables.",
    mimeType: "application/json",
    readText: () => JSON.stringify(sshTransportReference(), null, 2),
  },
  {
    uri: "droidctl://reference/targeting-rules",
    name: "Target Selection Rules",
    description: "Why every tool takes an explicit target and refuses to guess.",
    mimeType: "text/markdown",
    readText: () =>
      [
        "# Target selection",
        "",
        "1. `targetId` is required on every tool except `droid_target.list_targets`.",
        "2. A target is addressed by the opaque id that `list_targets` issued, not by a serial typed by a caller.",
        "3. `list_targets` returns no default, preferred or current target.",
        "4. A target id that no longer resolves is an error. There is no fallback to another target.",
        "5. A target id that resolves to more than one device is an error listing the candidates.",
        "6. Every adb invocation carries `-s <serial>`; only enumeration runs without one.",
        "7. Every tool that names an application takes an explicit `package`.",
        "",
        "Two application ids can be installed at once and both open a WebView DevTools socket, so picking the first",
        "one attaches to the wrong application. An emulator can be running beside the device under test, so a bare",
        "`install -r` or `pm clear` can land on whatever that emulator was doing.",
      ].join("\n"),
  },
];

export function listResources() {
  return resources.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  }));
}

export function readResource(uri: string) {
  return resources.find((resource) => resource.uri === uri);
}
