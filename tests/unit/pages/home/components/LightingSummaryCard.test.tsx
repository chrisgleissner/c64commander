/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LightingSummaryCard } from "@/pages/home/components/LightingSummaryCard";

const { updateConfigValueSpy, resolveConfigValueSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
}));

vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

vi.mock("@/lib/config/ledColors", () => ({
  getLedColorRgb: (value: string) => (value === "Red" ? { r: 255, g: 0, b: 0 } : null),
  rgbToCss: ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r},${g},${b})`,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button onClick={() => onValueChange && onValueChange("opt1")} data-testid={`select-change-${value}`}>
        Change
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, "data-testid": testId }: any) => <div data-testid={testId}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    onValueChangeAsync,
    onValueCommit,
    onValueCommitAsync,
    disabled,
    "data-testid": testId,
  }: any) => (
    <div data-testid={testId} data-disabled={String(disabled)} data-value={JSON.stringify(value)}>
      <button
        onClick={() => {
          onValueChange?.([5]);
          onValueCommit?.([5]);
          onValueChangeAsync?.(5);
          onValueCommitAsync?.(5);
        }}
        data-testid={`${testId}-drag`}
      >
        Drag
      </button>
    </div>
  ),
}));

const defaultProps = {
  category: "LED Strip",
  config: undefined,
  isActive: true,
  operationPrefix: "HOME_LED_STRIP",
  sectionLabel: "LED Strip",
  selectTriggerClassName: "cls",
  successLabel: "LED strip",
  testIdPrefix: "led-strip",
};

describe("LightingSummaryCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_p: unknown, _c: string, _i: string, fallback: string | number) => fallback,
    );
  });

  it("renders the card with testId", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-summary")).toBeInTheDocument();
  });

  it("renders section label as title", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByText("LED Strip")).toBeInTheDocument();
  });

  it("renders mode, pattern, color, tint, and sid-select selects", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-mode")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-pattern")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-color")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-tint")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-sid-select")).toBeInTheDocument();
  });

  it("renders color slider and intensity slider", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-color-slider")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-intensity-slider")).toBeInTheDocument();
  });

  it("renders intensity value display", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-intensity-value")).toBeInTheDocument();
  });

  it("calls updateConfigValue when mode changes", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    // find the mode select area and click its Change button
    const modeSelect = screen.getByTestId("led-strip-mode").closest("[data-value]");
    const changeBtn = modeSelect?.querySelector('[data-testid^="select-change-"]') as HTMLButtonElement;
    fireEvent.click(changeBtn);
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      "LED Strip",
      "LedStrip Mode",
      "opt1",
      "HOME_LED_STRIP_MODE",
      "LED strip mode updated",
      undefined,
    );
  });

  it("calls updateConfigValue when intensity slider is moved", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-intensity-slider-drag"));
    // onValueCommitAsync triggers updateConfigValue
    expect(updateConfigValueSpy).toHaveBeenCalled();
  });

  it("shows intensity value from resolved config", () => {
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "Strip Intensity") return "15";
      return fallback;
    });
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-intensity-value")).toHaveTextContent("15");
  });

  it("disables selects when isActive=false", () => {
    render(<LightingSummaryCard {...defaultProps} isActive={false} />);
    const modeTrigger = screen.getByTestId("led-strip-mode").closest("[data-value]");
    expect(modeTrigger).toHaveAttribute("data-disabled", "true");
  });

  it("disables intensity slider when isActive=false", () => {
    render(<LightingSummaryCard {...defaultProps} isActive={false} />);
    expect(screen.getByTestId("led-strip-intensity-slider")).toHaveAttribute("data-disabled", "true");
  });
});
