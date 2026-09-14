/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { KEYCODES } from "../src/keycodes.js";
import { listResources, readResource, resources } from "../src/resources.js";
import { listToolDescriptors } from "../src/tools/registry.js";
import { CONFIG_VARIABLES } from "../src/transport/sshConfig.js";
import { PREREQUISITE_SUMMARIES } from "../src/transport/sshPrerequisites.js";
import { ATTACH_ROUTE_SUPPORT, CONTAINER_ADB_ONLY, SSH_DETECTION_ORDER } from "../src/transport/ssh.js";

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

  it("serves a support matrix with a column for adb and for each ssh route", () => {
    const matrix = JSON.parse(readResource("droidctl://reference/transport-support")!.readText());
    expect(listToolDescriptors().length).toBe(25);
    for (const descriptor of listToolDescriptors()) {
      const entry = matrix[descriptor.name];
      expect(entry.adb).toBe("supported");
      expect(entry["ssh/container-adb"]).toBe("supported");
      expect(entry["ssh/container-attach"]).toBe(ATTACH_ROUTE_SUPPORT[descriptor.name]);
      expect(entry.note).toBe(CONTAINER_ADB_ONLY[descriptor.name]);
    }
    expect(Object.keys(CONTAINER_ADB_ONLY).sort()).toEqual([
      "droid_assert.assert_not_visible",
      "droid_assert.assert_visible",
      "droid_capture.start_recording",
      "droid_capture.stop_recording",
      "droid_capture.ui_hierarchy",
      "droid_device.forward_webview",
    ]);
  });

  it("serves the ssh detection order, routes, prerequisites and configuration", () => {
    const reference = JSON.parse(readResource("droidctl://reference/ssh-transport")!.readText());
    expect(reference.detectionOrder).toEqual(SSH_DETECTION_ORDER);
    expect(Object.keys(reference.prerequisites)).toEqual(Object.keys(PREREQUISITE_SUMMARIES));
    expect(reference.configuration).toEqual(CONFIG_VARIABLES);
    expect(Object.keys(reference.routes)).toEqual(["container-adb", "container-attach"]);
    expect(reference.specification).toBe("docs/plans/droidctl/spec.md §14");
  });

  it("serves the targeting rules", () => {
    const rules = readResource("droidctl://reference/targeting-rules")!.readText();
    expect(rules).toMatch(/no default, preferred or current target/);
    expect(rules).toMatch(/refuses to guess|refusing|error listing the candidates/);
  });
});
