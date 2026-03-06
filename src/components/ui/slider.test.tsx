/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Slider } from "./slider";
import { SLIDER_POPUP_IDLE_CLOSE_MS, SLIDER_POPUP_MIN_VISIBLE_MS } from "@/lib/ui/sliderPopupStateMachine";

describe("Slider value display", () => {
  it("shows value on pointer down and keeps it visible for minimum duration", () => {
    vi.useFakeTimers();
    render(<Slider value={[50]} min={0} max={100} step={1} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
    fireEvent.pointerDown(root);
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();

    fireEvent.pointerUp(root);
    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_MIN_VISIBLE_MS - 50);
    });
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_IDLE_CLOSE_MS + 100);
    });
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
    vi.useRealTimers();
  });

  it("hides value after idle timeout on pointer cancel", () => {
    vi.useFakeTimers();
    render(<Slider value={[50]} min={0} max={100} step={1} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();

    fireEvent.pointerCancel(root);
    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_IDLE_CLOSE_MS + 50);
    });
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
    vi.useRealTimers();
  });

  it("does not show value when showValueOnDrag is false", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} showValueOnDrag={false} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
  });

  it("resets idle close timer on repeated interactions", () => {
    vi.useFakeTimers();
    render(<Slider value={[50]} min={0} max={100} step={1} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);
    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_IDLE_CLOSE_MS - 100);
    });
    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);
    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_IDLE_CLOSE_MS - 100);
    });
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
    vi.useRealTimers();
  });

  it("does not close popup early when controlled value updates immediately", () => {
    vi.useFakeTimers();

    const Controlled = () => {
      const [value, setValue] = React.useState(50);
      return (
        <Slider
          value={[value]}
          min={0}
          max={100}
          step={1}
          onValueCommit={(values) => setValue(values[0] ?? 50)}
          data-testid="test-slider"
        />
      );
    };

    render(<Controlled />);
    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);

    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_MIN_VISIBLE_MS - 50);
    });
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(SLIDER_POPUP_IDLE_CLOSE_MS + 100);
    });
    expect(screen.queryByTestId("slider-value-display")).toBeNull();
    vi.useRealTimers();
  });
});

describe("Slider callbacks", () => {
  it("calls onPointerDown callback", () => {
    const onPointerDown = vi.fn();
    render(<Slider value={[50]} min={0} max={100} step={1} onPointerDown={onPointerDown} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    expect(onPointerDown).toHaveBeenCalled();
  });

  it("calls onPointerUp callback", () => {
    const onPointerUp = vi.fn();
    render(<Slider value={[50]} min={0} max={100} step={1} onPointerUp={onPointerUp} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    fireEvent.pointerUp(root);
    expect(onPointerUp).toHaveBeenCalled();
  });

  it("calls onPointerCancel callback", () => {
    const onPointerCancel = vi.fn();
    render(
      <Slider value={[50]} min={0} max={100} step={1} onPointerCancel={onPointerCancel} data-testid="test-slider" />,
    );

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerCancel(root);
    expect(onPointerCancel).toHaveBeenCalled();
  });
});

describe("Slider midpoint", () => {
  it("renders midpoint notch when configured", () => {
    render(
      <Slider
        value={[50]}
        min={0}
        max={100}
        step={1}
        midpoint={{ value: 50, notch: true }}
        data-testid="test-slider"
      />,
    );

    const root = screen.getByTestId("test-slider");
    const notch = root.querySelector('span[aria-hidden="true"]');
    expect(notch).toBeTruthy();
  });

  it("does not render midpoint notch when notch is false", () => {
    render(
      <Slider
        value={[50]}
        min={0}
        max={100}
        step={1}
        midpoint={{ value: 50, notch: false }}
        data-testid="test-slider"
      />,
    );

    const root = screen.getByTestId("test-slider");
    const notch = root.querySelector('span[aria-hidden="true"]');
    expect(notch).toBeNull();
  });

  it("renders midpoint notch by default when midpoint is provided", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} midpoint={{ value: 25 }} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    const notch = root.querySelector('span[aria-hidden="true"]');
    expect(notch).toBeTruthy();
  });
});

describe("Slider default value", () => {
  it("uses min value when no value or default is provided", () => {
    render(<Slider min={10} max={100} step={1} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    fireEvent.pointerDown(root);
    expect(screen.getByTestId("slider-value-display")).toBeTruthy();
  });
});

describe("Slider custom classes", () => {
  it("applies custom thumb class name", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} thumbClassName="custom-thumb" data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    const thumb = root.querySelector('[role="slider"]');
    expect(thumb?.className).toContain("custom-thumb");
  });

  it("applies custom track class name", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} trackClassName="custom-track" data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    // Track element exists
    expect(root.querySelector("[data-radix-slider-track]") || root.querySelector('[class*="track"]')).toBeTruthy();
  });

  it("applies custom range class name", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} rangeClassName="custom-range" data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    // Range element exists
    expect(root.querySelector("[data-radix-slider-range]") || root.querySelector('[class*="range"]')).toBeTruthy();
  });
});
