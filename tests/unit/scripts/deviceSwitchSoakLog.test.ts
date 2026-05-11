import { describe, expect, it } from "vitest";

import {
  DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER,
  parseDeviceSwitchSoakRunnerResult,
} from "../../../scripts/device-switch-soak-log.mjs";

describe("device switch soak log parser", () => {
  it("parses the explicit runner result line instead of embedded callback metadata", () => {
    const payload = {
      status: "completed",
      summary: {
        failureCount: 0,
      },
    };
    const embeddedPayload = JSON.stringify({
      message: `${DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER} ${JSON.stringify({ status: "completed" })}`,
    });
    const logcat = [
      `callback: 123, methodData: ${embeddedPayload}`,
      `${DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER} ${JSON.stringify(payload)}`,
    ].join("\n");

    expect(parseDeviceSwitchSoakRunnerResult(logcat)).toEqual(payload);
  });

  it("falls back to the last complete runner result when a newer log line is truncated", () => {
    const payload = {
      status: "completed",
      summary: {
        failureCount: 2,
      },
    };
    const logcat = [
      `${DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER} ${JSON.stringify(payload)}`,
      `${DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER} ${'{"status":"completed","summary":[}'}`,
    ].join("\n");

    expect(parseDeviceSwitchSoakRunnerResult(logcat)).toEqual(payload);
  });
});
