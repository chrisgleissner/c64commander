/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpenSourceLicensesPage from "@/pages/OpenSourceLicensesPage";

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({
      remove: vi.fn(async () => undefined),
    })),
  },
}));

describe("OpenSourceLicensesPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response("# Third-Party Notices\n\nSummary: test notices."));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const renderLicensesRoute = () => {
    render(
      <MemoryRouter initialEntries={["/settings/open-source-licenses"]}>
        <Routes>
          <Route path="/settings/open-source-licenses" element={<OpenSourceLicensesPage />} />
          <Route path="/settings" element={<div>Settings Page</div>} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("does not close on touch pointer-up before the synthesized click", async () => {
    renderLicensesRoute();

    await screen.findByText("Third-Party Notices");
    const overlay = screen.getByTestId("open-source-licenses-overlay");
    const closeButton = screen.getByRole("button", { name: "Close licenses overlay" });

    expect(overlay).toHaveClass("fixed", "z-[1100]");
    expect(overlay.parentElement).toBe(document.body);

    fireEvent.pointerUp(closeButton, { pointerType: "touch" });

    expect(overlay).toBeInTheDocument();
    expect(screen.queryByText("Settings Page")).not.toBeInTheDocument();

    fireEvent.click(closeButton);

    await waitFor(() => expect(screen.getByText("Settings Page")).toBeInTheDocument());
  });
});
