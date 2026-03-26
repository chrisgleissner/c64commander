/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionExpandedContent } from "@/components/diagnostics/ActionExpandedContent";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";

const richSummary: ActionSummary = {
  correlationId: "corr-1",
  actionName: "Refresh diagnostics",
  origin: "user",
  originalOrigin: "user",
  trigger: "tap",
  startTimestamp: "2025-01-01T00:00:00.000Z",
  endTimestamp: "2025-01-01T00:00:01.000Z",
  durationMs: 1000,
  outcome: "error",
  errorMessage: "Action failed",
  startRelativeMs: 0,
  effects: [
    {
      type: "REST",
      label: "Read info",
      method: "GET",
      protocol: null,
      hostname: null,
      port: null,
      path: "/v1/info",
      query: null,
      normalizedPath: null,
      target: null,
      product: "C64U",
      status: 200,
      durationMs: 45,
      requestHeaders: { accept: "application/json" },
      requestBody: { probe: true },
      requestPayloadPreview: {
        byteCount: 8,
        previewByteCount: 4,
        hex: "dead",
        ascii: "test",
        truncated: true,
      },
      responseHeaders: { "content-type": "application/json" },
      responseBody: { ok: true },
      responsePayloadPreview: {
        byteCount: 6,
        previewByteCount: 6,
        hex: "beef",
        ascii: "reply",
        truncated: false,
      },
      error: "Transient HTTP error",
    },
    {
      type: "FTP",
      label: "List disk",
      operation: "LIST",
      command: null,
      hostname: null,
      port: null,
      path: "/Usb0",
      target: null,
      result: null,
      requestPayload: { path: "/Usb0" },
      requestPayloadPreview: {
        byteCount: 5,
        previewByteCount: 5,
        hex: "cafe",
        ascii: "disk",
        truncated: false,
      },
      responsePayload: { entries: [] },
      responsePayloadPreview: {
        byteCount: 7,
        previewByteCount: 7,
        hex: "f00d",
        ascii: "result",
        truncated: false,
      },
      error: "FTP timeout",
    },
    {
      type: "ERROR",
      label: "Error",
      message: "Unexpected diagnostics exception",
    },
  ],
};

describe("ActionExpandedContent", () => {
  it("renders trigger, REST, FTP, and error details when they are present", () => {
    render(<ActionExpandedContent summary={richSummary} />);

    expect(screen.getByText(/origin:/)).toBeInTheDocument();
    expect(screen.getByTestId("action-trigger-corr-1")).toHaveTextContent("trigger:");
    expect(screen.getByText("error: Action failed")).toBeInTheDocument();

    const restEffect = screen.getByTestId("action-rest-effect-corr-1-0");
    expect(restEffect).toHaveTextContent("GET /v1/info");
    expect(within(restEffect).getByText("Request headers")).toBeInTheDocument();
    expect(within(restEffect).getByText("Request payload")).toBeInTheDocument();
    expect(within(restEffect).getByText("Request preview")).toBeInTheDocument();
    expect(within(restEffect).getByText("Response headers")).toBeInTheDocument();
    expect(within(restEffect).getByText("Response payload")).toBeInTheDocument();
    expect(within(restEffect).getByText("Response preview")).toBeInTheDocument();
    expect(screen.getByText("error: Transient HTTP error")).toBeInTheDocument();

    const ftpEffect = screen.getByTestId("action-ftp-effect-corr-1-0");
    expect(ftpEffect).toHaveTextContent("LIST /Usb0");
    expect(ftpEffect).toHaveTextContent("result: unknown");
    expect(screen.getByText("error: FTP timeout")).toBeInTheDocument();
    expect(screen.getByText("Unexpected diagnostics exception")).toBeInTheDocument();
  });

  it("renders telnet effects with menu path, duration, and unknown result fallback", () => {
    render(
      <ActionExpandedContent
        summary={{
          correlationId: "corr-3",
          actionName: "Power cycle",
          origin: "user",
          originalOrigin: "user",
          trigger: "button",
          startTimestamp: "2025-01-01T00:00:00.000Z",
          endTimestamp: "2025-01-01T00:00:02.000Z",
          durationMs: 2000,
          outcome: "success",
          startRelativeMs: 0,
          effects: [
            {
              type: "TELNET",
              label: "Power cycle",
              actionId: "powerCycle",
              actionLabel: "Power Cycle",
              menuPath: ["Power & Reset", "Power Cycle"],
              target: null,
              result: null,
              durationMs: 850,
              error: null,
            },
          ],
        }}
      />,
    );

    const telnetEffect = screen.getByTestId("action-telnet-effect-corr-3-0");
    expect(screen.getByText("Telnet")).toBeInTheDocument();
    expect(telnetEffect).toHaveTextContent("Power Cycle");
    expect(telnetEffect).toHaveTextContent("target: unknown");
    expect(telnetEffect).toHaveTextContent("result: unknown");
    expect(telnetEffect).toHaveTextContent("850ms");
    expect(telnetEffect).toHaveTextContent("action: powerCycle");
    expect(telnetEffect).toHaveTextContent("menu: Power & Reset → Power Cycle");
  });

  it("omits telnet menu text when the effect has no menu path", () => {
    render(
      <ActionExpandedContent
        summary={{
          correlationId: "corr-4",
          actionName: "Printer on",
          origin: "automation",
          originalOrigin: "schedule",
          startTimestamp: null,
          endTimestamp: null,
          durationMs: null,
          outcome: "error",
          errorMessage: "Telnet write failed",
          startRelativeMs: 0,
          effects: [
            {
              type: "TELNET",
              label: "Printer on",
              actionId: "printerTurnOn",
              actionLabel: "Turn On",
              menuPath: null,
              target: "printer",
              result: "failed",
              durationMs: null,
              error: "socket closed",
            },
          ],
        }}
      />,
    );

    const telnetEffect = screen.getByTestId("action-telnet-effect-corr-4-0");
    expect(telnetEffect).toHaveTextContent("target: printer");
    expect(telnetEffect).toHaveTextContent("result: failed");
    expect(telnetEffect).toHaveTextContent("action: printerTurnOn");
    expect(telnetEffect).not.toHaveTextContent("menu:");
    expect(screen.getByText("error: socket closed")).toBeInTheDocument();
    expect(screen.getByText("error: Telnet write failed")).toBeInTheDocument();
  });

  it("renders REST and FTP unknown fallbacks when status, result, and duration are absent", () => {
    render(
      <ActionExpandedContent
        summary={{
          correlationId: "corr-5",
          actionName: "Probe fallback states",
          origin: "user",
          originalOrigin: "user",
          startTimestamp: null,
          endTimestamp: null,
          durationMs: null,
          outcome: "success",
          startRelativeMs: 0,
          effects: [
            {
              type: "REST",
              label: "Probe info",
              method: "GET",
              protocol: null,
              hostname: null,
              port: null,
              path: "/v1/probe",
              query: null,
              normalizedPath: null,
              target: null,
              product: null,
              status: null,
              durationMs: null,
              requestHeaders: {},
              requestBody: undefined,
              requestPayloadPreview: null,
              responseHeaders: {},
              responseBody: undefined,
              responsePayloadPreview: null,
              error: null,
            },
            {
              type: "FTP",
              label: "Probe ftp",
              operation: "LIST",
              command: null,
              hostname: null,
              port: null,
              path: "/Usb1",
              target: null,
              result: null,
              requestPayload: undefined,
              requestPayloadPreview: null,
              responsePayload: undefined,
              responsePayloadPreview: null,
              error: null,
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("action-rest-effect-corr-5-0")).toHaveTextContent("status: unknown");
    expect(screen.getByTestId("action-rest-effect-corr-5-0")).not.toHaveTextContent("ms");
    expect(screen.getByTestId("action-ftp-effect-corr-5-0")).toHaveTextContent("result: unknown");
    expect(screen.queryByText("Request headers")).not.toBeInTheDocument();
    expect(screen.queryByText("Response headers")).not.toBeInTheDocument();
    expect(screen.queryByText("Request payload")).not.toBeInTheDocument();
    expect(screen.queryByText("Response payload")).not.toBeInTheDocument();
  });

  it("omits optional sections when the summary has no trigger or effects", () => {
    render(
      <ActionExpandedContent
        summary={{
          correlationId: "corr-2",
          actionName: "Idle action",
          origin: "unknown",
          startTimestamp: null,
          endTimestamp: null,
          durationMs: null,
          outcome: "success",
          startRelativeMs: 0,
        }}
      />,
    );

    expect(screen.queryByText("REST")).not.toBeInTheDocument();
    expect(screen.queryByText("FTP")).not.toBeInTheDocument();
    expect(screen.queryByText("Errors")).not.toBeInTheDocument();
    expect(screen.queryByText(/trigger:/)).not.toBeInTheDocument();
  });
});
