/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotchedSlider } from "@/components/sound/NotchedSlider";
import type { Notch } from "@/lib/ui/notchedSlider";

const NOTCHES: Notch[] = [
  { id: "off", label: "Off", value: 0 },
  { id: "room", label: "Room", value: 30 },
  { id: "hall", label: "Hall", value: 55 },
];
const TRACK_PX = 244;

const Harness = ({ initial = 0, disabled = false }: { initial?: number; disabled?: boolean }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NotchedSlider
        label="Reverb"
        notches={NOTCHES}
        value={value}
        onChange={setValue}
        accent={{ light: "#7a3fb0", dark: "#d6a8ff" }}
        disabled={disabled}
        testIdPrefix="reverb"
      />
      <output data-testid="value">{value}</output>
    </>
  );
};

const thumb = () => screen.getByTestId("reverb-thumb");
const value = () => Number(screen.getByTestId("value").textContent);
const pulse = () => Number(thumb().querySelector("[data-pulse]")?.getAttribute("data-pulse") ?? "0");

describe("NotchedSlider", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: TRACK_PX,
      height: 44,
      right: TRACK_PX,
      bottom: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("jumps to a notch when its label is tapped", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("reverb-notch-hall"));
    expect(value()).toBe(55);
    expect(thumb()).toHaveAttribute("aria-valuetext", "Hall, 55");
  });

  it("jumps between notches with Left and Right and stops at the ends", () => {
    render(<Harness />);
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    expect(value()).toBe(30);
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    expect(value()).toBe(55);
    fireEvent.keyDown(thumb(), { key: "ArrowLeft" });
    expect(value()).toBe(30);
  });

  it("moves by 5 while a key is held", () => {
    render(<Harness initial={30} />);
    fireEvent.keyDown(thumb(), { key: "ArrowRight", repeat: true });
    fireEvent.keyDown(thumb(), { key: "ArrowRight", repeat: true });
    expect(value()).toBe(40);
    fireEvent.keyDown(thumb(), { key: "ArrowLeft", repeat: true });
    expect(value()).toBe(35);
  });

  it("pulses the thumb when it lands on a notch, and not for a held step", () => {
    render(<Harness />);
    expect(pulse()).toBe(0);
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    expect(pulse()).toBe(1);
    fireEvent.keyDown(thumb(), { key: "ArrowRight", repeat: true });
    expect(pulse()).toBe(1);
  });

  it("snaps a drag that ends near a notch onto it", () => {
    render(<Harness />);
    const track = thumb().parentElement as HTMLElement;
    const near = 22 + ((57 - 0) / 100) * (TRACK_PX - 44);
    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: near, pointerId: 1 });
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(value()).toBe(55);
  });

  it("ignores keys, taps and drags while disabled and leaves the focus ring", () => {
    render(<Harness disabled />);
    fireEvent.keyDown(thumb(), { key: "ArrowRight" });
    expect(screen.getByTestId("reverb-notch-hall")).toBeDisabled();
    fireEvent.pointerDown(thumb().parentElement as HTMLElement, { clientX: 200, pointerId: 1 });
    expect(value()).toBe(0);
    expect(thumb()).toHaveAttribute("tabindex", "-1");
    expect(thumb()).toHaveAttribute("aria-disabled", "true");
  });
});
