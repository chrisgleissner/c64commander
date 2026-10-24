/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToneCurveEditor } from "@/components/sound/ToneCurveEditor";
import { flatBands, frequencyToFraction } from "@/lib/audio/tone/toneCurve";
import { reachableTargets } from "@/lib/audio/tone/toneResponse";
import { resetInputModality, setInputModality } from "@/lib/input/inputModality";

const WIDTH = 300;
const HEIGHT = 176;

const Harness = ({ initial = flatBands(), disabled = false }: { initial?: number[]; disabled?: boolean }) => {
  const [bands, setBands] = useState(initial);
  return (
    <>
      <ToneCurveEditor bandsDb={bands} onChange={setBands} disabled={disabled} />
      <output data-testid="bands">{bands.join(",")}</output>
    </>
  );
};

const bands = () => screen.getByTestId("bands").textContent;
const plot = () => screen.getByTestId("sound-tone-plot");

describe("ToneCurveEditor", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: WIDTH,
      height: HEIGHT,
      right: WIDTH,
      bottom: HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetInputModality();
  });

  it("starts on 1 kHz, flat, with a readout and a disabled reset", () => {
    render(<Harness />);
    expect(screen.getByTestId("sound-tone-readout")).toHaveTextContent("1 kHz, 0 dB");
    expect(screen.getByTestId("sound-tone-reset")).toBeDisabled();
    expect(plot()).toHaveAttribute("role", "slider");
  });

  it("changes only the band nearest to the touch, by the touch height", () => {
    render(<Harness />);
    fireEvent.pointerDown(plot(), { clientX: frequencyToFraction(4000) * WIDTH, clientY: HEIGHT * 0.25, pointerId: 1 });
    expect(bands()).toBe("0,0,0,0,0,0,0,6,0,0");
    expect(screen.getByTestId("sound-tone-readout")).toHaveTextContent("4 kHz, +6 dB");
  });

  it("drags the picked band without switching to the band under the pointer", () => {
    render(<Harness />);
    fireEvent.pointerDown(plot(), { clientX: frequencyToFraction(250) * WIDTH, clientY: HEIGHT / 2, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: frequencyToFraction(8000) * WIDTH, clientY: 0, pointerId: 1 });
    expect(bands()).toBe("0,0,0,12,0,0,0,0,0,0");
    fireEvent.pointerUp(plot(), { pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: 10, clientY: HEIGHT, pointerId: 1 });
    expect(bands()).toBe("0,0,0,12,0,0,0,0,0,0");
  });

  it("clamps a drag past the edges of the plot to plus or minus 12 dB", () => {
    render(<Harness />);
    fireEvent.pointerDown(plot(), { clientX: frequencyToFraction(1000) * WIDTH, clientY: HEIGHT * 3, pointerId: 1 });
    expect(bands()).toBe("0,0,0,0,0,-12,0,0,0,0");
  });

  it("selects bands with Left and Right and stops at the ends", () => {
    render(<Harness />);
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    expect(screen.getByTestId("sound-tone-readout")).toHaveTextContent("500 Hz, 0 dB");
    for (let n = 0; n < 12; n += 1) fireEvent.keyDown(plot(), { key: "ArrowRight" });
    expect(screen.getByTestId("sound-tone-readout")).toHaveTextContent("16 kHz, 0 dB");
    for (let n = 0; n < 12; n += 1) fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    expect(screen.getByTestId("sound-tone-readout")).toHaveTextContent("31 Hz, 0 dB");
  });

  it("leaves Up and Down to the ring until OK starts gain editing", () => {
    render(<Harness />);
    expect(fireEvent.keyDown(plot(), { key: "ArrowUp" })).toBe(true);
    expect(bands()).toBe("0,0,0,0,0,0,0,0,0,0");
    expect(plot()).toHaveAttribute("data-key-nav-vertical", "false");
    fireEvent.keyDown(plot(), { key: "Enter" });
    expect(plot()).toHaveAttribute("data-key-nav-vertical", "true");
    expect(fireEvent.keyDown(plot(), { key: "ArrowUp" })).toBe(false);
    expect(bands()).toBe("0,0,0,0,0,1,0,0,0,0");
    fireEvent.keyDown(plot(), { key: "ArrowDown" });
    fireEvent.keyDown(plot(), { key: "ArrowDown" });
    expect(bands()).toBe("0,0,0,0,0,-1,0,0,0,0");
  });

  it("changes the gain by 3 dB while a key is held", () => {
    render(<Harness />);
    fireEvent.keyDown(plot(), { key: "Enter" });
    fireEvent.keyDown(plot(), { key: "ArrowUp", repeat: true });
    expect(bands()).toBe("0,0,0,0,0,3,0,0,0,0");
  });

  it("ends gain editing with OK, Escape, or leaving the control", () => {
    render(<Harness />);
    fireEvent.keyDown(plot(), { key: "Enter" });
    fireEvent.keyDown(plot(), { key: "Enter" });
    expect(plot()).toHaveAttribute("data-key-nav-vertical", "false");
    fireEvent.keyDown(plot(), { key: "Enter" });
    fireEvent.keyDown(plot(), { key: "Escape" });
    expect(plot()).toHaveAttribute("data-editing", "false");
    fireEvent.keyDown(plot(), { key: "Enter" });
    fireEvent.blur(plot());
    expect(plot()).toHaveAttribute("data-editing", "false");
  });

  it("toggles gain editing for the click the keypad ring synthesizes on OK, not for a pointer click", () => {
    render(<Harness />);
    fireEvent.click(plot(), { detail: 1 });
    expect(plot()).toHaveAttribute("data-editing", "false");
    fireEvent.click(plot(), { detail: 0 });
    expect(plot()).toHaveAttribute("data-editing", "true");
  });

  it("changes the gain by 3 dB with Page Up and Page Down", () => {
    render(<Harness />);
    fireEvent.keyDown(plot(), { key: "PageUp" });
    fireEvent.keyDown(plot(), { key: "PageUp" });
    fireEvent.keyDown(plot(), { key: "PageDown" });
    expect(bands()).toBe("0,0,0,0,0,3,0,0,0,0");
  });

  it("resets the whole curve to flat with the button", () => {
    render(<Harness initial={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} />);
    fireEvent.click(screen.getByTestId("sound-tone-reset"));
    expect(bands()).toBe("0,0,0,0,0,0,0,0,0,0");
  });

  it("puts only the double-tapped band back to 0 dB", () => {
    render(<Harness initial={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} />);
    fireEvent.doubleClick(plot(), { clientX: frequencyToFraction(4000) * WIDTH, clientY: HEIGHT / 2 });
    expect(bands()).toBe("1,2,3,4,5,6,7,0,9,10");
  });

  it("draws the curve across the whole plot through the points and keeps the plot at least 200 px high", () => {
    render(<Harness initial={[0, 0, 0, 0, 0, 12, 0, 0, 0, 0]} />);
    const d = screen.getByTestId("sound-tone-curve").getAttribute("d") ?? "";
    expect(Number(d.slice(1).split(" ")[0])).toBeCloseTo(0, 2);
    expect(Number(d.trim().split(" ").slice(-2)[0])).toBeCloseTo(100, 2);
    const reachable = Math.round(reachableTargets([0, 0, 0, 0, 0, 12, 0, 0, 0, 0])[5] * 10) / 10;
    expect(reachable).toBeLessThan(12);
    expect(screen.getByTestId("sound-tone-point-5")).toHaveAttribute("data-gain", String(reachable));
    expect(plot().className).toContain("min-h-[200px]");
  });

  it("shows the key hint only while the plot has focus and keys are in use", () => {
    render(<Harness />);
    fireEvent.focus(plot());
    expect(screen.queryByTestId("sound-tone-hint")).not.toBeInTheDocument();
    act(() => setInputModality("key-navigation"));
    expect(screen.getByTestId("sound-tone-hint")).toHaveTextContent("Left and right pick a band, OK to adjust");
    fireEvent.keyDown(plot(), { key: "Enter" });
    expect(screen.getByTestId("sound-tone-hint")).toHaveTextContent("Up and down set the gain, OK to finish");
    act(() => setInputModality("pointer"));
    expect(screen.queryByTestId("sound-tone-hint")).not.toBeInTheDocument();
  });

  it("does nothing while disabled", () => {
    render(<Harness disabled />);
    fireEvent.pointerDown(plot(), { clientX: 100, clientY: 10, pointerId: 1 });
    fireEvent.keyDown(plot(), { key: "PageUp" });
    fireEvent.doubleClick(plot());
    fireEvent.click(plot(), { detail: 0 });
    expect(bands()).toBe("0,0,0,0,0,0,0,0,0,0");
    expect(plot()).toHaveAttribute("tabindex", "-1");
    expect(plot()).toHaveAttribute("data-editing", "false");
  });
});
