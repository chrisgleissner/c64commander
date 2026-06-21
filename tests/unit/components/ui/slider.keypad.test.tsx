/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, SLIDER_KEY_COMMIT_DEBOUNCE_MS } from "@/components/ui/slider";
import { FocusNavigationProvider, useFocusItem } from "@/hooks/useFocusNavigation";

/**
 * Proves HAZARD 1: a focused slider's Left/Right adjust the value (visible
 * aria-valuenow) WITHOUT moving focus, while Up/Down move focus WITHOUT changing
 * the value; and that a key-repeat burst coalesces into exactly ONE commit
 * (device write) through the existing onValueChange/onValueCommit path.
 */

const NextCta = () => {
  const ref = useFocusItem<HTMLButtonElement>({ id: "next-cta", order: 10 });
  return <button ref={ref}>Next CTA</button>;
};

type HarnessProps = {
  onValueChange?: (values: number[]) => void;
  onValueCommit?: (values: number[]) => void;
  enabled?: boolean;
};

const Harness = ({ onValueChange, onValueCommit, enabled = true }: HarnessProps) => {
  const [value, setValue] = useState(2);
  return (
    <FocusNavigationProvider enabled={enabled}>
      <Slider
        value={[value]}
        min={0}
        max={5}
        step={1}
        onValueChange={(values) => {
          setValue(values[0] ?? 0);
          onValueChange?.(values);
        }}
        onValueCommit={onValueCommit}
        keypadFocusId="kp-slider"
        keypadFocusOrder={0}
        aria-label="Test slider"
        data-testid="kp-slider"
      />
      <NextCta />
    </FocusNavigationProvider>
  );
};

describe("Slider — keypad navigation (HAZARD 1)", () => {
  afterEach(() => vi.useRealTimers());

  it("Left/Right adjust the value (aria-valuenow) and do NOT move focus", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "2");

    fireEvent.keyDown(thumb, { key: "ArrowRight", code: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith([3]);
    expect(thumb).toHaveAttribute("aria-valuenow", "3");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Next CTA" }));

    fireEvent.keyDown(thumb, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(onValueChange).toHaveBeenLastCalledWith([2]);
    expect(thumb).toHaveAttribute("aria-valuenow", "2");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Next CTA" }));
  });

  it("Up/Down move focus and do NOT change the value", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const thumb = screen.getByRole("slider");

    fireEvent.keyDown(thumb, { key: "ArrowDown", code: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next CTA" }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(thumb).toHaveAttribute("aria-valuenow", "2");
  });

  it("coalesces a key-repeat burst into exactly one commit (one device write)", () => {
    vi.useFakeTimers();
    const onValueCommit = vi.fn();
    render(<Harness onValueCommit={onValueCommit} />);
    const thumb = screen.getByRole("slider");

    // Three rapid Left presses within the debounce window (2 → 1 → 0 → 0 edge).
    fireEvent.keyDown(thumb, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(onValueCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SLIDER_KEY_COMMIT_DEBOUNCE_MS + 20);
    });
    expect(onValueCommit).toHaveBeenCalledTimes(1);
  });

  it("is inert when the keypad flag is off (Radix handles arrows natively)", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} enabled={false} />);
    const thumb = screen.getByRole("slider");
    // No data-key-selected ever appears, and focus never jumps to the CTA via Down.
    fireEvent.keyDown(thumb, { key: "ArrowDown", code: "ArrowDown" });
    expect(thumb).not.toHaveAttribute("data-key-selected");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Next CTA" }));
  });
});
