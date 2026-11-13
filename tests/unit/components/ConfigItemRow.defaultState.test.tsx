/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigItemRow } from "@/components/ConfigItemRow";
import { useC64ConfigItem } from "@/hooks/useC64Connection";
import { getC64API } from "@/lib/c64api";

vi.mock("@/hooks/useC64Connection", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/hooks/useC64Connection")>();
  return { ...orig, useC64ConfigItem: vi.fn() };
});

const mockConfigItem = vi.mocked(useC64ConfigItem);

const itemPayload = (category: string, name: string, item: Record<string, unknown>) => ({
  data: { [category]: { items: { [name]: item } } },
  isLoading: false,
});

const renderRow = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe("ConfigItemRow default state", () => {
  beforeEach(() => {
    mockConfigItem.mockReset();
    mockConfigItem.mockReturnValue({ data: undefined, isLoading: false } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it("marks an enum item that differs from its default and writes the default back on Reset to default", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Manual", values: ["Off", "Manual"], default: "Off" }) as never,
    );
    const onValueChange = vi.fn();
    renderRow(
      <ConfigItemRow
        category="Cat"
        name="Turbo Control"
        value="Manual"
        onValueChange={onValueChange}
        showDefaultState
      />,
    );

    expect(screen.getByTestId("config-item-modified")).toHaveTextContent("Modified. Default: Off");
    fireEvent.click(screen.getByRole("button", { name: "Reset Turbo Control to default" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("Off");
  });

  it("writes a numeric default as a number", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Level", { current: 9, min: 8, max: 11, format: "%d", default: 8 }) as never,
    );
    const onValueChange = vi.fn();
    renderRow(<ConfigItemRow category="Cat" name="Level" value={9} onValueChange={onValueChange} showDefaultState />);

    fireEvent.click(screen.getByTestId("config-item-reset-default"));

    expect(onValueChange).toHaveBeenCalledWith(8);
  });

  it.each([
    ["Clock Settings", "Year", 2024, 2015],
    ["Network Settings", "Host Name", "mickey", "ultimate"],
  ])(
    "shows no marker or reset on %s > %s even when the value differs from the reported default",
    (category, name, value, def) => {
      mockConfigItem.mockReturnValue(itemPayload(category, name, { current: value, default: def }) as never);
      renderRow(
        <ConfigItemRow category={category} name={name} value={value} onValueChange={vi.fn()} showDefaultState />,
      );

      expect(screen.queryByTestId("config-item-modified")).not.toBeInTheDocument();
      expect(screen.queryByTestId("config-item-reset-default")).not.toBeInTheDocument();
    },
  );

  it("shows no marker when the value equals the default", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Off", values: ["Off", "Manual"], default: "Off" }) as never,
    );
    renderRow(
      <ConfigItemRow category="Cat" name="Turbo Control" value="Off" onValueChange={vi.fn()} showDefaultState />,
    );

    expect(screen.queryByTestId("config-item-modified")).not.toBeInTheDocument();
  });

  it("shows no marker when the payload carries no default", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Manual", values: ["Off", "Manual"] }) as never,
    );
    renderRow(
      <ConfigItemRow category="Cat" name="Turbo Control" value="Manual" onValueChange={vi.fn()} showDefaultState />,
    );

    expect(screen.queryByTestId("config-item-modified")).not.toBeInTheDocument();
  });

  it("shows no marker on a row that did not ask for it", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Manual", values: ["Off", "Manual"], default: "Off" }) as never,
    );
    renderRow(<ConfigItemRow category="Cat" name="Turbo Control" value="Manual" onValueChange={vi.fn()} />);

    expect(screen.queryByTestId("config-item-modified")).not.toBeInTheDocument();
  });

  it("offers no reset on a read-only row", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Manual", values: ["Off", "Manual"], default: "Off" }) as never,
    );
    renderRow(
      <ConfigItemRow
        category="Cat"
        name="Turbo Control"
        value="Manual"
        onValueChange={vi.fn()}
        showDefaultState
        readOnly
      />,
    );

    expect(screen.queryByTestId("config-item-reset-default")).not.toBeInTheDocument();
  });

  it("reads the default from the cached item when the row already has its options, without a fetch", () => {
    vi.spyOn(getC64API(), "getCachedConfigItem").mockReturnValue({
      selected: "Manual",
      values: ["Off", "Manual"],
      default: "Off",
    });
    renderRow(
      <ConfigItemRow
        category="Cat"
        name="Turbo Control"
        value="Manual"
        options={["Off", "Manual"]}
        onValueChange={vi.fn()}
        showDefaultState
      />,
    );

    expect(screen.getByTestId("config-item-modified")).toHaveTextContent("Default: Off");
    expect(mockConfigItem).toHaveBeenCalledWith("Cat", "Turbo Control", false, expect.anything());
  });

  it("shows the marker once the config cache fills after the row first rendered", async () => {
    const category = "Cat";
    const name = "Late Cache Item";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              [category]: { items: { [name]: { current: "Manual", values: ["Off", "Manual"], default: "Off" } } },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    renderRow(
      <ConfigItemRow
        category={category}
        name={name}
        value="Manual"
        options={["Off", "Manual"]}
        onValueChange={vi.fn()}
        showDefaultState
      />,
    );
    expect(screen.queryByTestId("config-item-modified")).not.toBeInTheDocument();

    await act(async () => {
      await getC64API().getConfigItem(category, name);
    });

    expect(screen.getByTestId("config-item-modified")).toHaveTextContent("Default: Off");
    vi.unstubAllGlobals();
  });

  it("does not say the value is saved to flash", () => {
    mockConfigItem.mockReturnValue(
      itemPayload("Cat", "Turbo Control", { current: "Manual", values: ["Off", "Manual"], default: "Off" }) as never,
    );
    renderRow(
      <ConfigItemRow category="Cat" name="Turbo Control" value="Manual" onValueChange={vi.fn()} showDefaultState />,
    );

    expect(screen.getByTestId("config-item-modified").textContent ?? "").not.toMatch(/flash|saved|persist/i);
  });
});
