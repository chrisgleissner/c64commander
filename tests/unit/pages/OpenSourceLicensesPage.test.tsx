import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes, MemoryRouter } from "react-router-dom";

import OpenSourceLicensesPage from "@/pages/OpenSourceLicensesPage";

const mocks = vi.hoisted(() => ({
  addErrorLog: vi.fn(),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: mocks.addErrorLog,
}));

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/settings/open-source-licenses"]}>
      <Routes>
        <Route path="/settings" element={<div>Settings Destination</div>} />
        <Route path="/settings/open-source-licenses" element={<OpenSourceLicensesPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("OpenSourceLicensesPage", () => {
  it("renders bundled notices and preserves markdown structure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () =>
        [
          "# Third Party Notices",
          "",
          "Rendered from `THIRD_PARTY_NOTICES.md`.",
          "",
          "- package-one",
          "- [package-two](https://example.com/pkg)",
        ].join("\n"),
    } as Response);

    renderPage();

    expect(await screen.findByText("Third Party Notices")).toBeInTheDocument();
    expect(screen.getByText("THIRD_PARTY_NOTICES.md")).toBeInTheDocument();
    expect(screen.getByText("package-one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "package-two" })).toHaveAttribute("href", "https://example.com/pkg");
  });

  it("returns to settings when the close action is pressed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "# Third Party Notices",
    } as Response);

    renderPage();

    await screen.findByText("Third Party Notices");
    fireEvent.click(screen.getByRole("button", { name: "Close licenses overlay" }));

    expect(await screen.findByText("Settings Destination")).toBeInTheDocument();
  });

  it("surfaces notice load failures and records an error log", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    renderPage();

    expect(await screen.findByText(/Unable to load open source licenses/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.addErrorLog).toHaveBeenCalledWith("Failed to load third-party notices", {
        error: "Failed to load third-party notices (503)",
      });
    });
  });
});
