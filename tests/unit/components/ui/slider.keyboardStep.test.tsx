/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slider, SLIDER_KEY_COMMIT_DEBOUNCE_MS } from "@/components/ui/slider";
import { FocusNavigationProvider, useFocusItem } from "@/hooks/useFocusNavigation";
import { createNumericSliderDomain, useDeviceBoundSlider } from "@/hooks/useDeviceBoundSlider";
import { resolveSliderKeyStepDelta, resolveSliderKeyStepSize } from "@/lib/ui/sliderBehavior";

const FINE_DRAG_STEP = 0.01;
const OPTION_COUNT = 41;

type HarnessProps = {
  commit: (value: number) => void;
  keypad?: boolean;
  keyboardStep?: number;
};

const OptionSnappedSlider = ({ commit, keypad = false, keyboardStep }: HarnessProps) => {
  const domain = useMemo(() => createNumericSliderDomain({ min: 0, max: OPTION_COUNT - 1, round: Math.round }), []);
  const slider = useDeviceBoundSlider({ deviceValue: 25, domain, previewMode: "commitOnly", commit });
  const control = (
    <Slider
      value={[slider.sliderValue]}
      min={0}
      max={OPTION_COUNT - 1}
      step={FINE_DRAG_STEP}
      keyboardStep={keyboardStep}
      onValueChange={slider.onValueChange}
      onValueCommit={slider.onValueCommit}
      aria-label="Option volume"
      keypadFocusId={keypad ? "option-volume" : undefined}
    />
  );
  return keypad ? <FocusNavigationProvider enabled>{control}</FocusNavigationProvider> : control;
};

const pressAndSettle = (thumb: HTMLElement, init: { key: string; shiftKey?: boolean }) => {
  fireEvent.keyDown(thumb, { code: init.key, ...init });
  act(() => {
    vi.advanceTimersByTime(SLIDER_KEY_COMMIT_DEBOUNCE_MS + 1);
  });
};

describe("Slider keyboardStep — a fine drag step snapped to options", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["ArrowLeft", 24],
    ["ArrowRight", 26],
    ["ArrowDown", 24],
    ["ArrowUp", 26],
    ["PageDown", 15],
    ["PageUp", 35],
  ])("a plain %s press commits a different option (%s), not the rounded-back current one", (key, expected) => {
    const commit = vi.fn();
    render(<OptionSnappedSlider commit={commit} keyboardStep={1} />);
    const thumb = screen.getByRole("slider", { name: "Option volume" });

    pressAndSettle(thumb, { key });

    expect(commit).toHaveBeenLastCalledWith(expected);
    expect(thumb).toHaveAttribute("aria-valuenow", String(expected));
  });

  it("Shift+arrow skips ten options, as the Radix slider does", () => {
    const commit = vi.fn();
    render(<OptionSnappedSlider commit={commit} keyboardStep={1} />);

    pressAndSettle(screen.getByRole("slider", { name: "Option volume" }), { key: "ArrowLeft", shiftKey: true });

    expect(commit).toHaveBeenLastCalledWith(15);
  });

  it("a keypad D-pad Left press on a ring-registered slider commits the previous option", () => {
    const commit = vi.fn();
    render(<OptionSnappedSlider commit={commit} keypad keyboardStep={1} />);

    pressAndSettle(screen.getByRole("slider", { name: "Option volume" }), { key: "ArrowLeft" });

    expect(commit).toHaveBeenLastCalledWith(24);
  });

  it("with the keypad ring on, Down on the thumb moves to the next stop and leaves the value alone", () => {
    const commit = vi.fn();
    const NextCta = () => {
      const ref = useFocusItem<HTMLButtonElement>({ id: "next-cta", order: 10 });
      return <button ref={ref}>Next CTA</button>;
    };
    render(
      <FocusNavigationProvider enabled>
        <OptionSnappedSlider commit={commit} keyboardStep={1} />
        <NextCta />
      </FocusNavigationProvider>,
    );
    const thumb = screen.getByRole("slider", { name: "Option volume" });
    act(() => thumb.focus());

    pressAndSettle(thumb, { key: "ArrowDown" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next CTA" }));
    expect(commit).not.toHaveBeenCalled();
    expect(thumb).toHaveAttribute("aria-valuenow", "25");
  });

  it("without keyboardStep the fine step leaves the committed option unchanged, which is why it exists", () => {
    const commit = vi.fn();
    render(<OptionSnappedSlider commit={commit} />);
    const thumb = screen.getByRole("slider", { name: "Option volume" });

    pressAndSettle(thumb, { key: "ArrowLeft" });

    expect(commit).not.toHaveBeenCalledWith(24);
    expect(thumb).toHaveAttribute("aria-valuenow", "25");
  });
});

describe("slider key step helpers", () => {
  it("prefers keyboardStep, then step, then 1", () => {
    expect(resolveSliderKeyStepSize(1, 0.01)).toBe(1);
    expect(resolveSliderKeyStepSize(undefined, 0.5)).toBe(0.5);
    expect(resolveSliderKeyStepSize(undefined, undefined)).toBe(1);
    expect(resolveSliderKeyStepSize(0, Number.NaN)).toBe(1);
  });

  it("returns null for keys that do not step, so Home/End stay with the Radix slider", () => {
    expect(resolveSliderKeyStepDelta("Home", false, 1)).toBeNull();
    expect(resolveSliderKeyStepDelta("End", false, 1)).toBeNull();
    expect(resolveSliderKeyStepDelta("Enter", false, 1)).toBeNull();
  });
});

describe("Slider accessible name", () => {
  it("names the thumb that carries role=slider, not the wrapper around it", () => {
    render(<Slider value={[3]} min={0} max={10} step={1} aria-label="Playback volume" data-testid="named-root" />);

    expect(screen.getByRole("slider", { name: "Playback volume" })).toBeInTheDocument();
    expect(screen.getByTestId("named-root")).not.toHaveAttribute("aria-label");
  });

  it("forwards aria-labelledby to the thumb", () => {
    render(
      <>
        <span id="duration-heading">Default duration</span>
        <Slider value={[3]} min={0} max={10} step={1} aria-labelledby="duration-heading" />
      </>,
    );

    expect(screen.getByRole("slider", { name: "Default duration" })).toBeInTheDocument();
  });
});
