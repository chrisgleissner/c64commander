/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TransportUnavailableError } from "../tools/errors.js";
import type {
  CapabilitySupport,
  DetachedHandle,
  ExecResult,
  InstallResult,
  TargetInfo,
  Transport,
  TransportCapabilities,
} from "./types.js";

export const SPEC_REFERENCE = "docs/plans/droidctl/spec.md";

/**
 * Two rules for whoever implements this against real hardware.
 *
 * 1. Verify by artifact, not by exit code. A UI-session tool has been observed
 *    exiting 0 while writing no file inside this kind of container.
 * 2. Prefer a connection into the container over a second implementation. If an
 *    adb connection can be established (probe Q4), the adb backend applies
 *    unchanged and probes Q5 to Q9 stop mattering.
 *
 * The literal commands for each check are in the specification's §14; they name
 * vendor tooling that is not repeated here.
 */
export const SSH_TRANSPORT_PROBES: readonly { id: string; question: string; check: string }[] = [
  {
    id: "Q1",
    question: "Does the device expose a developer mode at all?",
    check: "Settings — is there a developer tools entry?",
  },
  {
    id: "Q2",
    question: "What are the connection details: host address, user, and root escalation?",
    check: "Read the platform release file, print the login user, and confirm the vendor helpers are on PATH.",
  },
  {
    id: "Q3",
    question: "How is an APK installed, and does a raw package-manager install skip host-side integration?",
    check:
      "Install a test APK with the vendor helper and see whether it appears in the launcher; compare the raw route.",
  },
  {
    id: "Q4",
    question: "Can an adb connection be made into the Android container? A yes collapses Q5 to Q9.",
    check: "Enable wireless debugging inside the container, read its port from the dialog, then try connect and pair.",
  },
  {
    id: "Q5",
    question: "Does the input injector work inside the container?",
    check: "Inject a tap over both routes and compare against an observed screen change. Exit 0 is not evidence here.",
  },
  {
    id: "Q6",
    question: "Does a host-side screenshot capture Android window content?",
    check:
      "With the application on screen, take a compositor capture and an Android one, and compare both to the panel.",
  },
  {
    id: "Q7",
    question: "How is a screen recording made, given there is no official capture command?",
    check: "Tunnel the compositor's VNC port, record, and look at the output.",
  },
  {
    id: "Q8",
    question: "Does the application's own logging reach the container's log buffer?",
    check: "Read the container log while the application logs a known string.",
  },
  {
    id: "Q9",
    question: "Can a port be forwarded to the WebView DevTools socket in the container's namespace?",
    check: "After Q4, try the ordinary adb forward.",
  },
];

const UNKNOWN: CapabilitySupport = "unknown";

const SSH_TOOL_SUPPORT: Readonly<Record<string, CapabilitySupport>> = {
  "droid_target.list_targets": UNKNOWN,
  "droid_target.describe_target": UNKNOWN,
  "droid_app.install_app": UNKNOWN,
  "droid_app.uninstall_app": UNKNOWN,
  "droid_app.start_app": UNKNOWN,
  "droid_app.stop_app": UNKNOWN,
  "droid_app.clear_app_data": UNKNOWN,
  "droid_app.write_app_file": UNKNOWN,
  "droid_app.read_app_file": UNKNOWN,
  "droid_input.tap": UNKNOWN,
  "droid_input.swipe": UNKNOWN,
  "droid_input.input_text": UNKNOWN,
  "droid_input.press_key": UNKNOWN,
  "droid_capture.screenshot": UNKNOWN,
  "droid_capture.ui_hierarchy": UNKNOWN,
  "droid_capture.start_recording": "unsupported",
  "droid_capture.stop_recording": "unsupported",
  "droid_capture.logcat": "supported",
  "droid_assert.assert_visible": UNKNOWN,
  "droid_assert.assert_not_visible": UNKNOWN,
  "droid_device.prepare_device": UNKNOWN,
  "droid_device.run_shell": "supported",
  "droid_device.forward_webview": UNKNOWN,
  "droid_device.push_file": UNKNOWN,
  "droid_device.pull_file": UNKNOWN,
};

const SSH_NOTES: Readonly<Record<string, string>> = {
  "droid_target.list_targets": "Needs a connection method: probes Q2 and Q4.",
  "droid_target.describe_target": "Panel geometry is known; wm size availability is not.",
  "droid_app.install_app": "The vendor install helper is attested in community use but not documented: probe Q3.",
  "droid_input.tap": "The input injector has never been tested inside the container: probe Q5.",
  "droid_capture.ui_hierarchy": "Known to exit 0 while writing no file in this container: probe Q5.",
  "droid_capture.start_recording": "No official capture command. Compositor VNC capture is the candidate: probe Q7.",
  "droid_capture.logcat": "Vendor-documented inside the container, including clearing the buffer.",
  "droid_device.run_shell": "Established through the container-attach helper; an exit code of 0 is not evidence.",
  "droid_device.forward_webview": "The DevTools socket is abstract and in the container namespace: probe Q9.",
};

export function sshTransportProbeProcedure(): string {
  return SSH_TRANSPORT_PROBES.map((probe) => `${probe.id}. ${probe.question} Check: ${probe.check}`).join("\n");
}

function unavailable(operation: string): TransportUnavailableError {
  return new TransportUnavailableError(
    "ssh",
    `The ssh transport is not implemented, so ${operation} is unavailable. No such device exists on this bench, and ` +
      "nothing about this transport can be verified without one. Settle these first, with the literal commands in " +
      `${SPEC_REFERENCE} §14:\n${sshTransportProbeProcedure()}`,
    { operation, probes: SSH_TRANSPORT_PROBES.map((probe) => probe.id) },
  );
}

/**
 * A stub, deliberately. The device this transport exists for is not on the
 * bench and cannot be obtained, so nothing here is gated on it.
 */
export class SshTransport implements Transport {
  readonly kind = "ssh" as const;

  capabilities(): TransportCapabilities {
    return { transport: "ssh", tools: { ...SSH_TOOL_SUPPORT }, notes: { ...SSH_NOTES } };
  }

  async listTargets(): Promise<TargetInfo[]> {
    throw unavailable("listTargets");
  }

  async exec(): Promise<ExecResult> {
    throw unavailable("exec");
  }

  spawnShell(): DetachedHandle {
    throw unavailable("spawnShell");
  }

  async pullBinary(): Promise<Buffer> {
    throw unavailable("pullBinary");
  }

  async pullFile(): Promise<number> {
    throw unavailable("pullFile");
  }

  async pushFile(): Promise<number> {
    throw unavailable("pushFile");
  }

  async installPackage(): Promise<InstallResult> {
    throw unavailable("installPackage");
  }

  async forwardPort(): Promise<void> {
    throw unavailable("forwardPort");
  }

  async removeForward(): Promise<void> {
    throw unavailable("removeForward");
  }
}
