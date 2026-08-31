/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The registered tool surface, as a plain list a transport can build a capability map from. */
export const ALL_TOOL_NAMES: readonly string[] = [
  "droid_target.list_targets",
  "droid_target.describe_target",
  "droid_app.install_app",
  "droid_app.uninstall_app",
  "droid_app.start_app",
  "droid_app.stop_app",
  "droid_app.clear_app_data",
  "droid_app.write_app_file",
  "droid_app.read_app_file",
  "droid_input.tap",
  "droid_input.swipe",
  "droid_input.input_text",
  "droid_input.press_key",
  "droid_capture.screenshot",
  "droid_capture.ui_hierarchy",
  "droid_capture.start_recording",
  "droid_capture.stop_recording",
  "droid_capture.logcat",
  "droid_assert.assert_visible",
  "droid_assert.assert_not_visible",
  "droid_device.prepare_device",
  "droid_device.run_shell",
  "droid_device.forward_webview",
  "droid_device.push_file",
  "droid_device.pull_file",
];
