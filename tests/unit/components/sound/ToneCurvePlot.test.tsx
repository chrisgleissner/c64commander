/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToneCurvePlot, type ToneCurvePlotProps } from "@/components/sound/ToneCurvePlot";
import { flatBands, frequencyToFraction } from "@/lib/audio/tone/toneCurve";
import { plotTargets } from "@/lib/audio/tone/toneResponse";

const WIDTH = 300;
const HEIGHT = 200;

const mockBox = (width: number, height: number) =>
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

const setup = (props: Partial<ToneCurvePlotProps> = {}) => {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const onResetBand = vi.fn();
  const bands = flatBands();
  bands[7] = 12;
  render(
    <ToneCurvePlot
      targets={plotTargets(bands)}
      selectedBand={5}
      onChange={onChange}
      onSelect={onSelect}
      onResetBand={onResetBand}
      rootProps={{ "data-testid": "plot" }}
      {...props}
    />,
  );
  return { onChange, onSelect, onResetBand, plot: screen.getByTestId("plot") };
};

describe("ToneCurvePlot", () => {
  beforeEach(() => mockBox(WIDTH, HEIGHT));
  afterEach(() => vi.restoreAllMocks());

  it("draws the live spectrum behind the curve only when levels are given", () => {
    setup();
    expect(screen.queryByTestId("sound-tone-spectrum")).not.toBeInTheDocument();
    cleanup();
    setup({ spectrum: new Array<number>(24).fill(0.5) });
    const path = screen.getByTestId("sound-tone-spectrum").getAttribute("d") ?? "";
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path.split("C")).toHaveLength(24 + 2);
  });

  it("draws nothing for an empty spectrum", () => {
    setup({ spectrum: [] });
    expect(screen.queryByTestId("sound-tone-spectrum")).not.toBeInTheDocument();
  });

  it("reports a press as the nearest band at the height touched and shows the guide while dragging", () => {
    const { plot, onSelect, onChange } = setup();
    fireEvent.pointerDown(plot, { clientX: frequencyToFraction(250) * WIDTH, clientY: 14, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(3);
    expect(onChange).toHaveBeenCalledWith(3, expect.any(Number));
    expect(screen.getByTestId("sound-tone-guide")).toBeInTheDocument();
    fireEvent.pointerUp(plot, { pointerId: 1 });
    expect(screen.queryByTestId("sound-tone-guide")).not.toBeInTheDocument();
  });

  it("cancels a drag on pointer cancel", () => {
    const { plot, onChange } = setup();
    fireEvent.pointerDown(plot, { clientX: 100, clientY: 100, pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerCancel(plot, { pointerId: 1 });
    fireEvent.pointerMove(plot, { clientX: 100, clientY: 10, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets the band under a double tap", () => {
    const { plot, onResetBand } = setup();
    fireEvent.doubleClick(plot, { clientX: 150, clientY: 100 });
    expect(onResetBand).toHaveBeenCalledTimes(1);
  });

  it("ignores touches and double taps while disabled and draws no handle halo", () => {
    const { plot, onSelect, onChange, onResetBand } = setup({ disabled: true });
    fireEvent.pointerDown(plot, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.doubleClick(plot, { clientX: 100, clientY: 100 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onResetBand).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sound-tone-halo")).not.toBeInTheDocument();
  });

  it("ignores touches while the plot has no size yet", () => {
    mockBox(0, 0);
    const { plot, onSelect } = setup();
    fireEvent.pointerDown(plot, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hands its root element to a callback ref and to an object ref", () => {
    const callback = vi.fn();
    setup({ plotRef: callback });
    expect(callback).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    cleanup();
    const object = createRef<HTMLDivElement>();
    setup({ plotRef: object });
    expect(object.current).toBeInstanceOf(HTMLDivElement);
  });

  it("shows the value bubble with its edge position only while editing, and never when disabled", () => {
    setup({ emphasis: true, selectedBand: 7, height: 240 });
    const bubble = screen.getByTestId("sound-tone-bubble");
    expect(bubble).toHaveTextContent("4 kHz");
    expect(bubble.style.transform).toContain("18px");
    cleanup();
    setup({ emphasis: true, selectedBand: 7, disabled: true });
    expect(screen.queryByTestId("sound-tone-bubble")).not.toBeInTheDocument();
  });

  it("keeps the bubble inside the plot for the lowest and the highest band", () => {
    setup({ emphasis: true, selectedBand: 0 });
    expect(screen.getByTestId("sound-tone-bubble").style.transform).toContain("-14px");
    cleanup();
    setup({ emphasis: true, selectedBand: 9 });
    expect(screen.getByTestId("sound-tone-bubble").style.transform).toContain("calc(-100% + 14px)");
  });

  it("renders no handles for no targets and a selection that does not exist", () => {
    setup({ targets: [], selectedBand: 4, emphasis: true });
    expect(screen.queryByTestId("sound-tone-point-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sound-tone-bubble")).not.toBeInTheDocument();
  });
});
