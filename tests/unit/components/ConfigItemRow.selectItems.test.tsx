/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: "OFFLINE_NO_DEMO" as const, deviceInfo: null }),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const OpenContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    Select: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <OpenContext.Provider value={{ open: Boolean(open), setOpen: (next) => onOpenChange?.(next) }}>
        <div>{children}</div>
      </OpenContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: { children: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(OpenContext);
      return (
        <button type="button" onClick={() => setOpen(!open)} {...props}>
          {children}
        </button>
      );
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div data-testid="select-content">{children}</div>,
    SelectItem: ({ value }: { value: string }) => <span data-testid="select-item" data-value={value} />,
  };
});

import { ConfigItemRow } from "@/components/ConfigItemRow";

const renderRow = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigItemRow
        category="Test Category"
        name="Video Mode"
        value="NTSC"
        options={["PAL", "NTSC", "PAL-60", "NTSC-50", "Auto"]}
        onValueChange={vi.fn()}
      />
    </QueryClientProvider>,
  );

const itemValues = () => screen.queryAllByTestId("select-item").map((item) => item.getAttribute("data-value"));

describe("ConfigItemRow select items", () => {
  it("renders only the selected option while the select is closed, so a page of closed selects stays cheap", () => {
    renderRow();

    expect(itemValues()).toEqual(["NTSC"]);
  });

  it("renders every option once the select is opened", () => {
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    expect(itemValues()).toEqual(["PAL", "NTSC", "PAL-60", "NTSC-50", "Auto"]);
  });
});
