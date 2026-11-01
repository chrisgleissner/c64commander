/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { DiagnosticsConnectionActions } from "@/components/diagnostics/DiagnosticsConnectionActions";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;

const renderActions = () => {
  const handlers = { onCloseOverflow: vi.fn(), onOpenConnectionDetails: vi.fn(), onOpenChange: vi.fn() };
  render(
    <MemoryRouter initialEntries={["/play"]}>
      <DiagnosticsConnectionActions {...handlers} />
      <Where />
    </MemoryRouter>,
  );
  return handlers;
};

describe("DiagnosticsConnectionActions", () => {
  afterEach(() => saveStartupModeByUser("default"));

  it("Connection details closes the menu and opens the view", () => {
    const handlers = renderActions();
    fireEvent.click(screen.getByTestId("diagnostics-connection-details-action"));
    expect(handlers.onCloseOverflow).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenConnectionDetails).toHaveBeenCalledTimes(1);
  });

  it("Manage devices closes Diagnostics and opens Settings", () => {
    const handlers = renderActions();
    fireEvent.click(screen.getByTestId("diagnostics-manage-devices-action"));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("where")).toHaveTextContent("/settings");
  });

  it("SPM-ERR-03 SID Player shows no device actions", () => {
    saveStartupModeByUser("sid-player");
    renderActions();
    expect(screen.queryByTestId("diagnostics-connection-details-action")).toBeNull();
    expect(screen.queryByTestId("diagnostics-manage-devices-action")).toBeNull();
  });
});
