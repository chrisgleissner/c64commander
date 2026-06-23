/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LightingSummaryCard } from "@/pages/home/components/LightingSummaryCard";

const { addLogSpy, buildErrorLogDetailsSpy, updateConfigValueSpy, resolveConfigValueSpy } = vi.hoisted(() => ({
  addLogSpy: vi.fn(),
  buildErrorLogDetailsSpy: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: error.message,
  })),
  updateConfigValueSpy: vi.fn().mockResolvedValue(true),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
}));

vi.mock("@/lib/logging", () => ({
  addLog: addLogSpy,
  buildErrorLogDetails: buildErrorLogDetailsSpy,
}));

vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

const interactiveWriteSpy = vi.fn();
vi.mock("@/hooks/useInteractiveConfigWrite", () => ({
  useInteractiveConfigWrite: () => ({ write: interactiveWriteSpy, isPending: false }),
}));

vi.mock("@/lib/config/ledColors", () => ({
  LED_FIXED_COLORS: [{ name: "Red" }, { name: "Green" }, { name: "Blue" }, { name: "White" }],
  getLedColorRgb: (value: string) => (value === "Red" ? { r: 255, g: 0, b: 0 } : null),
  rgbToCss: ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r},${g},${b})`,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button
        disabled={disabled}
        onClick={() => {
          if (!disabled) onValueChange?.("opt1");
        }}
        data-testid={`select-change-${value}`}
      >
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
  Slider: ({ value, onValueChange, disabled, "data-testid": testId }: any) => (
    <div data-testid={testId} data-disabled={String(disabled)} data-value={JSON.stringify(value)}>
      <button
        onClick={() => {
          onValueChange?.([5]);
        }}
        data-testid={`${testId}-drag`}
      >
        Drag
      </button>
      <button
        onClick={() => {
          onValueChange?.([]);
        }}
        data-testid={`${testId}-drag-empty`}
      >
        Drag Empty
      </button>
    </div>
  ),
}));

const defaultProps = {
  category: "LED Strip",
  config: {
    items: {
      "LedStrip Mode": "Fixed Color",
      "LedStrip Auto SID Mode": {
        selected: "Enabled",
        options: ["Disabled", "Enabled"],
      },
      "LedStrip Pattern": "SingleColor",
      "Fixed Color": "Red",
      "LedStrip SID Select": "SID 1",
      "Color tint": "Pure",
      "Strip Intensity": {
        selected: 8,
        min: 0,
        max: 15,
      },
    },
  },
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
    interactiveWriteSpy.mockResolvedValue(undefined);
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

  it("renders mode, auto-sid, pattern, color, tint, and sid-select controls", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-mode")).toBeInTheDocument();
    expect(screen.getByTestId("led-strip-auto-sid")).toBeInTheDocument();
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

  it("calls updateConfigValue when auto SID mode changes", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-auto-sid"));
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      "LED Strip",
      "LedStrip Auto SID Mode",
      "Enabled",
      "HOME_LED_STRIP_AUTO_SID_MODE",
      "LED strip Music Detect updated",
      undefined,
    );
  });

  it("calls interactiveWrite when intensity slider is moved", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-intensity-slider-drag"));
    expect(interactiveWriteSpy).toHaveBeenCalledTimes(1);
    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Strip Intensity": 5 });
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("restores the resolved intensity after an interactive write failure", async () => {
    interactiveWriteSpy.mockRejectedValueOnce(new Error("intensity failed"));
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "Strip Intensity") return "15";
      return fallback;
    });

    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-intensity-slider-drag"));

    await waitFor(() => expect(screen.getByTestId("led-strip-intensity-value")).toHaveTextContent("15"));
    expect(addLogSpy).toHaveBeenCalledWith(
      "warn",
      "Lighting summary slider write failed",
      expect.objectContaining({
        category: "LED Strip",
        itemName: "Strip Intensity",
        value: 5,
        error: "intensity failed",
      }),
    );
  });

  it("ignores empty async slider payloads", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-intensity-slider-drag-empty"));
    expect(interactiveWriteSpy).not.toHaveBeenCalled();
  });

  it("ignores empty async color slider payloads", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag-empty"));
    expect(interactiveWriteSpy).not.toHaveBeenCalled();
  });

  it("calls interactiveWrite once when the color slider is moved", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    expect(interactiveWriteSpy).toHaveBeenCalledTimes(1);
    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Fixed Color": expect.any(String) });
  });

  it("switches Mode to Fixed Color when the color slider is moved (separate single-item write)", () => {
    // Default resolveConfigValue returns the fallback, so Mode resolves to "Off" here.
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    // The colour goes through the interactive (PUT) lane...
    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Fixed Color": expect.any(String) });
    // ...and Mode is forced to Fixed Color as a SEPARATE single-item write (never batched
    // with the colour — a two-item batch would route through the crashing POST /v1/configs).
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      "LED Strip",
      "LedStrip Mode",
      "Fixed Color",
      "HOME_LED_STRIP_MODE",
      "LED strip mode updated",
      { suppressToast: true },
    );
  });

  it("does not rewrite Mode when the color slider is moved while already in Fixed Color mode", () => {
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "LedStrip Mode") return "Fixed Color";
      if (itemName === "Fixed Color") return "Red";
      return fallback;
    });
    render(<LightingSummaryCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    expect(interactiveWriteSpy).toHaveBeenCalledWith({ "Fixed Color": expect.any(String) });
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("re-asserts Fixed Color mode on a later slider move after the mode write fails", async () => {
    // Mode never resolves to Fixed Color (default fallback), so the optimistic
    // re-render that normally clears the guard cannot happen here — only the
    // failure handler can release it.
    updateConfigValueSpy.mockResolvedValue(false);
    render(<LightingSummaryCard {...defaultProps} />);

    // First move fires the (failing) mode write...
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    expect(updateConfigValueSpy).toHaveBeenCalledTimes(1);
    // ...let the rejection handler clear forceFixedColorModeRef.
    await waitFor(() => expect(interactiveWriteSpy).toHaveBeenCalledTimes(1));

    // A subsequent move (throttled) must retry the mode write instead of staying
    // stuck behind a pinned guard.
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    await waitFor(() => expect(updateConfigValueSpy).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it("does not re-fire the Fixed Color mode write while a successful write keeps the guard", async () => {
    updateConfigValueSpy.mockResolvedValue(true);
    render(<LightingSummaryCard {...defaultProps} />);

    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    expect(updateConfigValueSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(interactiveWriteSpy).toHaveBeenCalledTimes(1));

    // The second move still flushes its colour write (interactiveWrite twice), but
    // the guard held by the successful mode write suppresses a repeat mode write.
    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));
    await waitFor(() => expect(interactiveWriteSpy).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(updateConfigValueSpy).toHaveBeenCalledTimes(1);
  });

  it("restores the resolved color index after an interactive write failure", async () => {
    interactiveWriteSpy.mockRejectedValueOnce(new Error("color failed"));
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "Fixed Color") return "Red";
      return fallback;
    });

    render(
      <LightingSummaryCard
        {...defaultProps}
        config={{
          items: {
            "LedStrip Auto SID Mode": {
              selected: "Enabled",
              options: ["Disabled", "Enabled"],
            },
            "Fixed Color": {
              selected: "Red",
              options: ["Red", "Green", "Blue", "White", "Yellow", "Purple"],
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("led-strip-color-slider-drag"));

    await waitFor(() => expect(screen.getByTestId("led-strip-color-slider")).toHaveAttribute("data-value", "[0]"));
    expect(addLogSpy).toHaveBeenCalledWith(
      "warn",
      "Lighting summary slider write failed",
      expect.objectContaining({
        category: "LED Strip",
        itemName: "Fixed Color",
        value: "Purple",
        error: "color failed",
      }),
    );
  });

  it("shows intensity value from resolved config", () => {
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "Strip Intensity") return "15";
      return fallback;
    });
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-intensity-value")).toHaveTextContent("15");
  });

  it("uses built-in fallback options when summary payloads omit structured metadata", () => {
    resolveConfigValueSpy.mockImplementation((_p: unknown, _c: string, itemName: string, fallback: string | number) => {
      if (itemName === "LedStrip Mode") return "Fixed Color";
      if (itemName === "LedStrip Pattern") return "SingleColor";
      if (itemName === "Fixed Color") return "Red";
      if (itemName === "LedStrip SID Select") return "SID 1";
      if (itemName === "Color tint") return "Pure";
      if (itemName === "Strip Intensity") return "12";
      return fallback;
    });

    render(
      <LightingSummaryCard
        {...defaultProps}
        config={{
          items: {
            "LedStrip Mode": "Fixed Color",
            "LedStrip Pattern": "SingleColor",
            "Fixed Color": "Red",
            "LedStrip SID Select": "SID 1",
            "Color tint": "Pure",
            "Strip Intensity": "12",
          },
        }}
      />,
    );

    expect(screen.getByText("Rainbow")).toBeInTheDocument();
    expect(screen.getByText("Circular")).toBeInTheDocument();
    expect(screen.getByText("SID 2")).toBeInTheDocument();
    expect(screen.getByText("Warm")).toBeInTheDocument();
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

  it("hides auto SID mode when the config item is unavailable", () => {
    render(<LightingSummaryCard {...defaultProps} config={undefined} />);
    expect(screen.queryByTestId("led-strip-auto-sid")).toBeNull();
  });

  it("enables the intensity slider when Strip Intensity is present in the live spec", () => {
    render(<LightingSummaryCard {...defaultProps} />);
    expect(screen.getByTestId("led-strip-intensity-slider")).toHaveAttribute("data-disabled", "false");
    expect(screen.getByTestId("led-strip-intensity-value")).toHaveTextContent("0");
  });

  it("disables the intensity slider and shows Not available when Strip Intensity is missing from the live spec (BUG-067)", () => {
    render(
      <LightingSummaryCard
        {...defaultProps}
        config={{
          items: {
            "LedStrip Auto SID Mode": { selected: "Enabled", options: ["Disabled", "Enabled"] },
          },
        }}
      />,
    );
    expect(screen.getByTestId("led-strip-intensity-slider")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("led-strip-intensity-value")).toHaveTextContent("Not available");
  });

  it("disables select controls for items missing from the live spec (BUG-067)", () => {
    render(
      <LightingSummaryCard
        {...defaultProps}
        config={{
          items: {
            "LedStrip Auto SID Mode": { selected: "Enabled", options: ["Disabled", "Enabled"] },
          },
        }}
      />,
    );

    const selectTestIds = [
      "led-strip-mode",
      "led-strip-pattern",
      "led-strip-color",
      "led-strip-tint",
      "led-strip-sid-select",
    ];

    for (const testId of selectTestIds) {
      const select = screen.getByTestId(testId).closest("[data-value]");
      expect(select).toHaveAttribute("data-disabled", "true");
      const change = select?.querySelector("button") as HTMLButtonElement;
      fireEvent.click(change);
    }

    expect(updateConfigValueSpy).not.toHaveBeenCalled();
    expect(interactiveWriteSpy).not.toHaveBeenCalled();
  });
});
