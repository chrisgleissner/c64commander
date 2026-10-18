/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyDialogBoundary } from "@/components/diagnostics/LazyDialogBoundary";

const reportUserErrorMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/uiErrors", () => ({ reportUserError: reportUserErrorMock }));

const Throws = () => {
  throw new Error("Failed to fetch dynamically imported module");
};

describe("LazyDialogBoundary", () => {
  afterEach(() => {
    reportUserErrorMock.mockClear();
  });

  it("renders its children when they load", () => {
    render(
      <LazyDialogBoundary operation="OP" title="t" description="d">
        <p>dialog</p>
      </LazyDialogBoundary>,
    );

    expect(screen.getByText("dialog")).toBeInTheDocument();
    expect(reportUserErrorMock).not.toHaveBeenCalled();
  });

  it("reports a failed load once and renders nothing instead of throwing to the app", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <div data-testid="app">
        <LazyDialogBoundary operation="DIAGNOSTICS_LOAD" title="Could not open" description="Reload the app.">
          <Throws />
        </LazyDialogBoundary>
        <p>the rest of the app</p>
      </div>,
    );

    expect(screen.getByText("the rest of the app")).toBeInTheDocument();
    expect(reportUserErrorMock).toHaveBeenCalledTimes(1);
    expect(reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "DIAGNOSTICS_LOAD",
        title: "Could not open",
        description: "Reload the app.",
        error: expect.objectContaining({ message: "Failed to fetch dynamically imported module" }),
      }),
    );
  });
});
