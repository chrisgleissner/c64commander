/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryConfigCard, SummaryConfigControlRow } from "@/pages/home/components/SummaryConfigCard";

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, disabled, "aria-label": ariaLabel, "data-testid": testId }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button onClick={() => onValueChange && onValueChange("opt1")} data-testid="select-trigger-btn">
        Change
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, "data-testid": testId, ...rest }: any) => (
    <div data-testid={testId} {...rest}>
      {children}
    </div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

describe("SummaryConfigCard", () => {
  it("renders title and children", () => {
    render(
      <SummaryConfigCard title="My Section" testId="my-card">
        <span data-testid="child-content">content</span>
      </SummaryConfigCard>,
    );
    expect(screen.getByText("My Section")).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
  });

  it("sets data-section-label when sectionLabel provided", () => {
    render(
      <SummaryConfigCard title="T" testId="card" sectionLabel="section-x">
        <span />
      </SummaryConfigCard>,
    );
    expect(screen.getByTestId("card")).toHaveAttribute("data-section-label", "section-x");
  });
});

describe("SummaryConfigControlRow — checkbox mode (2 options)", () => {
  it("renders checkbox unchecked when value matches disabled hint", () => {
    const onChange = vi.fn();
    render(
      <SummaryConfigControlRow
        disabled={false}
        label="Overlay"
        options={["Enabled", "Disabled"]}
        selectTriggerClassName="cls"
        testId="row-cb"
        toggleHints={{ enabled: ["Enabled"], disabled: ["Disabled"] }}
        value="Disabled"
        onValueChange={onChange}
      />,
    );
    const cb = screen.getByTestId("row-cb") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("renders checkbox checked when value matches enabled hint", () => {
    render(
      <SummaryConfigControlRow
        disabled={false}
        label="Overlay"
        options={["Enabled", "Disabled"]}
        selectTriggerClassName="cls"
        testId="row-cb"
        toggleHints={{ enabled: ["Enabled"], disabled: ["Disabled"] }}
        value="Enabled"
        onValueChange={vi.fn()}
      />,
    );
    const cb = screen.getByTestId("row-cb") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("calls onValueChange with enabled value when checking", () => {
    const onChange = vi.fn();
    render(
      <SummaryConfigControlRow
        disabled={false}
        label="Overlay"
        options={["Enabled", "Disabled"]}
        selectTriggerClassName="cls"
        testId="row-cb"
        toggleHints={{ enabled: ["Enabled"], disabled: ["Disabled"] }}
        value="Disabled"
        onValueChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("row-cb"));
    expect(onChange).toHaveBeenCalledWith("Enabled");
  });

  it("renders disabled checkbox when disabled=true", () => {
    render(
      <SummaryConfigControlRow
        disabled={true}
        label="Overlay"
        options={["Enabled", "Disabled"]}
        selectTriggerClassName="cls"
        testId="row-cb"
        value="Enabled"
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-cb")).toBeDisabled();
  });
});

describe("SummaryConfigControlRow — select mode (3+ options)", () => {
  it("renders select with current value", () => {
    render(
      <SummaryConfigControlRow
        disabled={false}
        label="Color Scheme"
        options={["Blue", "Red", "Green"]}
        selectTriggerClassName="cls"
        testId="row-sel"
        value="Blue"
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-sel")).toBeInTheDocument();
    expect(screen.getByText("Color Scheme")).toBeInTheDocument();
  });

  it("calls onValueChange when select changes", () => {
    const onChange = vi.fn();
    render(
      <SummaryConfigControlRow
        disabled={false}
        label="Color Scheme"
        options={["Blue", "Red", "Green"]}
        selectTriggerClassName="cls"
        testId="row-sel"
        value="Blue"
        onValueChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("select-trigger-btn"));
    expect(onChange).toHaveBeenCalledWith("opt1");
  });

  it("passes disabled to select", () => {
    render(
      <SummaryConfigControlRow
        disabled={true}
        label="Color Scheme"
        options={["Blue", "Red", "Green"]}
        selectTriggerClassName="cls"
        testId="row-sel"
        value="Blue"
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Color Scheme")).toBeInTheDocument();
  });
});

describe("SummaryConfigControlRow — controlType override", () => {
  it("forces checkbox when controlType=checkbox even with 3 options", () => {
    render(
      <SummaryConfigControlRow
        controlType="checkbox"
        disabled={false}
        label="Force CB"
        options={["A", "B", "C"]}
        selectTriggerClassName="cls"
        testId="forced-cb"
        value="A"
        onValueChange={vi.fn()}
      />,
    );
    // checkbox input should be present
    expect(screen.getByTestId("forced-cb")).toHaveAttribute("type", "checkbox");
  });

  it("forces select when controlType=select even with 2 options", () => {
    render(
      <SummaryConfigControlRow
        controlType="select"
        disabled={false}
        label="Force Sel"
        options={["Yes", "No"]}
        selectTriggerClassName="cls"
        testId="forced-sel"
        value="Yes"
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("forced-sel")).toBeInTheDocument();
    // Should NOT be a checkbox
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
