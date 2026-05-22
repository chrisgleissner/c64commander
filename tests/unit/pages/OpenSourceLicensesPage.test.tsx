import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, MemoryRouter } from "react-router-dom";

import OpenSourceLicensesPage from "@/pages/OpenSourceLicensesPage";

const mocks = vi.hoisted(() => ({
  addErrorLog: vi.fn(),
  appRemoveListener: vi.fn().mockResolvedValue(undefined),
  appAddListener: vi.fn(),
  backButtonListener: null as null | (() => void),
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

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: mocks.appAddListener,
  },
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
  beforeEach(() => {
    mocks.addErrorLog.mockReset();
    mocks.appRemoveListener.mockReset();
    mocks.backButtonListener = null;
    mocks.appAddListener.mockImplementation(async (_eventName: string, listener: () => void) => {
      mocks.backButtonListener = listener;
      return { remove: mocks.appRemoveListener };
    });
  });

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

  it("returns to settings when Android back is pressed on the licenses overlay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "# Third Party Notices",
    } as Response);

    renderPage();

    await screen.findByText("Third Party Notices");
    expect(mocks.backButtonListener).not.toBeNull();
    mocks.backButtonListener?.();

    expect(await screen.findByText("Settings Destination")).toBeInTheDocument();
  });

  it("keeps the overlay scrollable and wraps long content on small screens", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () =>
        ["# Third Party Notices", "", "Use `THIS_IS_A_VERY_LONG_LICENSE_TOKEN_WITHOUT_BREAKS`."].join("\n"),
    } as Response);

    renderPage();

    await screen.findByText("Third Party Notices");
    expect(screen.getByTestId("open-source-licenses-overlay")).toHaveClass("absolute", "inset-0", "overflow-hidden");
    expect(screen.getByTestId("open-source-licenses-scroll")).toHaveClass("overflow-y-auto", "overflow-x-hidden");
    expect(screen.getByText("THIS_IS_A_VERY_LONG_LICENSE_TOKEN_WITHOUT_BREAKS")).toHaveClass(
      "break-all",
      "whitespace-pre-wrap",
    );
  });

  it("renders dependency tables as readable cards instead of raw markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () =>
        [
          "# Third Party Notices",
          "",
          "## Dependency notices",
          "",
          "| Ecosystem | Package | Version | License | Source URL |",
          "| --- | --- | --- | --- | --- |",
          "| NPM | package-one | 1.0.0 | [MIT](https://spdx.org/licenses/MIT.html) | [https://example.com/pkg-one.tgz](https://example.com/pkg-one.tgz) |",
          "| NPM | package-two | 2.0.0 | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) | [https://example.com/pkg-two.tgz](https://example.com/pkg-two.tgz) |",
        ].join("\n"),
    } as Response);

    renderPage();

    await screen.findByText("Open Source Licenses");
    expect(screen.queryByTestId("open-source-licenses-raw")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("open-source-license-card")).toHaveLength(2);
    expect(screen.getByText("package-one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIT" })).toHaveAttribute("href", "https://spdx.org/licenses/MIT.html");
    expect(screen.getByRole("link", { name: "https://example.com/pkg-two.tgz" })).toHaveAttribute(
      "href",
      "https://example.com/pkg-two.tgz",
    );
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
