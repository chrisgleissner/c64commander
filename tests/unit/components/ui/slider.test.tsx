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
import { sliderValueAtX } from "@/lib/ui/sliderTouchGesture";
import { Slider } from "@/components/ui/slider";
import { SLIDER_POPUP_IDLE_CLOSE_MS, SLIDER_POPUP_MIN_VISIBLE_MS } from "@/lib/ui/sliderPopupStateMachine";

describe("Slider disabled state", () => {
  it("tells assistive technology and the keypad ring that a disabled slider cannot be used", () => {
    render(<Slider value={[1]} min={0} max={15} step={1} disabled aria-label="CPU speed" />);

    expect(screen.getByRole("slider")).toHaveAttribute("aria-disabled", "true");
  });

  it("does not mark an enabled slider as disabled", () => {
    render(<Slider value={[1]} min={0} max={15} step={1} aria-label="CPU speed" />);

    expect(screen.getByRole("slider")).not.toHaveAttribute("aria-disabled");
  });
});

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
  it("commits the latest native draft on blur when change has not fired yet", () => {
    const onValueCommit = vi.fn();

    const Controlled = () => {
      const [value, setValue] = React.useState(50);
      return (
        <Slider
          value={[value]}
          min={0}
          max={100}
          step={1}
          nativeInputMode="overlay"
          onValueChange={(values) => setValue(values[0] ?? 50)}
          onValueCommit={onValueCommit}
          nativeInputAriaLabel="Native slider"
        />
      );
    };

    render(<Controlled />);

    const input = screen.getByLabelText("Native slider");
    fireEvent.input(input, { target: { value: "60" } });
    fireEvent.blur(input);

    expect(onValueCommit).toHaveBeenCalledWith([60]);
  });

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

describe("Slider touch handling", () => {
  // A page-scroll gesture that happens to start on a slider must still scroll the page:
  // several sliders (SID mixer volume/pan, CPU speed) stretch close to the full width of
  // their card, so a vertical swipe landing on one is routine, not an edge case. touch-none
  // blocked the vertical axis along with the horizontal one it actually needs, so a swipe
  // starting there was captured by the slider - which also jumps its track press to the
  // touch position, silently changing the slider's value - instead of scrolling the page.
  // touch-pan-y keeps only the horizontal axis, handing vertical panning back to the browser.
  it("keeps the vertical touch axis free for page scrolling", () => {
    render(<Slider value={[50]} min={0} max={100} step={1} data-testid="test-slider" />);

    const root = screen.getByTestId("test-slider");
    expect(root.className).toContain("touch-pan-y");
    expect(root.className).not.toContain("touch-none");
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

describe("Slider touch gestures", () => {
  it("keeps the Android native range overlay from taking touches, so a scroll that starts on it cannot set the value", () => {
    const { rerender } = render(
      <Slider value={[50]} min={0} max={100} step={1} nativeInputMode="overlay" nativeInputAriaLabel="Overlay" />,
    );
    expect(screen.getByLabelText("Overlay")).toHaveClass("pointer-events-none");

    rerender(
      <Slider
        value={[50]}
        min={0}
        max={100}
        step={1}
        nativeInputMode="overlay"
        nativeInputAriaLabel="Overlay"
        disabled
      />,
    );
    expect(screen.getByLabelText("Overlay")).not.toHaveClass("pointer-events-none");
  });

  const renderTouchSlider = () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <Slider
        value={[50]}
        min={0}
        max={100}
        step={1}
        data-testid="touch-slider"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const root = screen.getByTestId("touch-slider");
    root.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 44 }) as DOMRect;
    return { root, onValueChange, onValueCommit };
  };
  const touch = (clientX: number, clientY: number) => ({ pointerType: "touch", pointerId: 7, clientX, clientY });

  it("leaves the value alone when a vertical page scroll starts on the slider", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();

    fireEvent.pointerDown(root, touch(20, 10));
    fireEvent.pointerMove(root, touch(22, 40));
    fireEvent.pointerMove(root, touch(80, 90));
    fireEvent.pointerCancel(root, touch(80, 90));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it("follows a horizontal drag and commits where it ends", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();

    fireEvent.pointerDown(root, touch(20, 10));
    fireEvent.pointerMove(root, touch(23, 11));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(root, touch(60, 12));
    fireEvent.pointerMove(root, touch(65, 12));
    expect(onValueChange).toHaveBeenLastCalledWith([65]);
    fireEvent.pointerUp(root, touch(72, 12));

    expect(onValueChange).toHaveBeenCalledWith([60]);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    expect(onValueCommit).toHaveBeenCalledWith([72]);
  });

  it("sets the value where a tap lands on the track", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();

    fireEvent.pointerDown(root, touch(30, 10));
    fireEvent.pointerUp(root, touch(30, 10));

    expect(onValueChange).toHaveBeenCalledWith([30]);
    expect(onValueCommit).toHaveBeenCalledWith([30]);
  });
  it("ignores movement and release from another pointer while retaining the deferred touch", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();
    fireEvent.pointerDown(root, touch(20, 10));
    fireEvent.pointerMove(root, { ...touch(80, 10), pointerId: 8 });
    fireEvent.pointerUp(root, { ...touch(80, 10), pointerId: 8 });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
    fireEvent.pointerMove(root, touch(60, 10));
    fireEvent.pointerUp(root, touch(70, 10));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith([60]);
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith([70]);
  });

  it("commits the last horizontal draft on cancellation and clears the touch session", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();
    fireEvent.pointerDown(root, touch(20, 10));
    fireEvent.pointerMove(root, touch(60, 10));
    fireEvent.pointerCancel(root, touch(90, 10));
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith([60]);
    fireEvent.pointerMove(root, touch(80, 10));
    fireEvent.pointerUp(root, touch(80, 10));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith([60]);
    expect(onValueCommit).toHaveBeenCalledTimes(1);
  });

  it("cancels an undecided touch without changing or committing a value", () => {
    const { root, onValueChange, onValueCommit } = renderTouchSlider();
    fireEvent.pointerDown(root, touch(20, 10));
    fireEvent.pointerCancel(root, touch(22, 11));
    fireEvent.pointerMove(root, touch(80, 10));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });
});

describe("sliderValueAtX edge geometry", () => {
  it.each([0, -10])("returns the minimum for a track of width %s", (width) => {
    expect(sliderValueAtX(50, { left: 10, width }, 5, 100, 1)).toBe(5);
  });

  it.each([undefined, 0, -1, NaN, Infinity])("keeps the unsnapped position for invalid step %s", (step) => {
    expect(sliderValueAtX(35, { left: 10, width: 100 }, 10, 20, step)).toBe(12.5);
  });
});
