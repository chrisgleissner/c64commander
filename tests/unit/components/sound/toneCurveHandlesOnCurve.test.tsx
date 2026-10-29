/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ToneCurveEditor } from "@/components/sound/ToneCurveEditor";
import { AMBIANCE_PRESETS } from "@/lib/audio/tone/ambiancePresets";
import { TONE_PRESETS, flatBands } from "@/lib/audio/tone/toneCurve";
import { handlePosition, yForDb, type Pixel } from "@/lib/audio/tone/toneGeometry";
import { cascadeResponseDb, compensatedGains, plotTargets } from "@/lib/audio/tone/toneResponse";

const WIDTH = 300;
const HEIGHT = 176;
const TOLERANCE_PX = 0.5;
const SAMPLES_PER_SEGMENT = 32;

type Segment = { from: Pixel; c1: Pixel; c2: Pixel; to: Pixel };

/** The cubic segments of a drawn "M x y C ..." path, scaled from plot units to CSS pixels. */
const segments = (d: string): Segment[] => {
  const numbers = d.replace(/[MC]/g, " ").trim().split(/[ ,]+/).map(Number);
  const point = (i: number): Pixel => ({ x: (numbers[i] * WIDTH) / 100, y: (numbers[i + 1] * HEIGHT) / 100 });
  const result: Segment[] = [];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    result.push({ from: point(i - 2), c1: point(i), c2: point(i + 2), to: point(i + 4) });
  }
  return result;
};

const bezier = ({ from, c1, c2, to }: Segment, t: number): Pixel => {
  const u = 1 - t;
  const at = (a: number, b: number, c: number, e: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e;
  return { x: at(from.x, c1.x, c2.x, to.x), y: at(from.y, c1.y, c2.y, to.y) };
};

const drawnHandles = (): Pixel[] =>
  Array.from({ length: 10 }, (_, band) => {
    const handle = screen.getByTestId(`sound-tone-point-${band}`);
    return { x: (Number(handle.dataset.x) * WIDTH) / 100, y: (Number(handle.dataset.y) * HEIGHT) / 100 };
  });

/** Every handle centre is a point of the drawn curve, and between two handles the curve never leaves their range. */
const expectCurveThroughHandles = () => {
  const curve = segments(screen.getByTestId("sound-tone-curve").getAttribute("d") ?? "");
  const handles = drawnHandles();
  for (const handle of handles) {
    const distance = Math.min(
      ...curve.flatMap((segment) => [segment.from, segment.to]).map((p) => Math.hypot(p.x - handle.x, p.y - handle.y)),
    );
    expect(distance).toBeLessThan(TOLERANCE_PX);
  }
  for (let band = 0; band < handles.length - 1; band += 1) {
    const left = handles[band];
    const right = handles[band + 1];
    const between = curve.filter((segment) => segment.from.x >= left.x - 0.01 && segment.to.x <= right.x + 0.01);
    expect(between.length).toBeGreaterThan(0);
    for (const segment of between) {
      for (let n = 0; n <= SAMPLES_PER_SEGMENT; n += 1) {
        const { y } = bezier(segment, n / SAMPLES_PER_SEGMENT);
        expect(y).toBeGreaterThanOrEqual(Math.min(left.y, right.y) - TOLERANCE_PX);
        expect(y).toBeLessThanOrEqual(Math.max(left.y, right.y) + TOLERANCE_PX);
      }
    }
  }
};

const presetVectors = [...TONE_PRESETS.map((p) => [...p.bandsDb]), ...AMBIANCE_PRESETS.map((p) => p.sound.bandsDb)];
const awkward = [
  [12, -12, 12, -12, 12, -12, 12, -12, 12, -12],
  [0, 0, 0, 0, 12, 0, 0, 0, 0, 0],
  [-12, -12, -12, -12, 12, 12, 12, 12, 12, 12],
  [3, -7, 11, 2, -9, 5, 12, -4, 8, -1],
];

describe("the tone curve passes through every handle", () => {
  it("places each handle at the true cascade response of the solved gains, within 0.5 px", () => {
    for (const targets of [...presetVectors, ...awkward]) {
      const gains = compensatedGains(targets);
      for (const handle of plotTargets(targets)) {
        const at = handlePosition(handle, WIDTH, HEIGHT);
        const trueY = yForDb(cascadeResponseDb(gains, handle.freq), HEIGHT);
        expect(Math.abs(trueY - at.y)).toBeLessThan(TOLERANCE_PX);
      }
    }
  });

  it("shows a handle at the requested value within 0.1 dB when that value is reachable", () => {
    for (const targets of presetVectors) {
      plotTargets(targets).forEach((handle, band) => expect(Math.abs(handle.db - targets[band])).toBeLessThan(0.1));
    }
  });

  const Harness = ({ initial }: { initial: number[] }) => {
    const [bands, setBands] = useState<number[]>(initial);
    return (
      <>
        <ToneCurveEditor bandsDb={bands} onChange={setBands} />
        <button onClick={() => setBands([...TONE_PRESETS[4].bandsDb])}>loudness</button>
      </>
    );
  };

  it.each([...presetVectors, ...awkward].map((bands) => [bands.join(","), bands]))(
    "draws a curve through each handle centre with no overshoot between handles for %s",
    (_name, bands) => {
      render(<Harness initial={[...bands]} />);
      expectCurveThroughHandles();
    },
  );

  it("keeps the curve through the handles after a key edit and after a preset change", () => {
    render(<Harness initial={flatBands()} />);
    const plot = screen.getByTestId("sound-tone-plot");
    fireEvent.keyDown(plot, { key: "Enter" });
    for (let n = 0; n < 5; n += 1) fireEvent.keyDown(plot, { key: "ArrowUp" });
    expectCurveThroughHandles();
    fireEvent.click(screen.getByText("loudness"));
    expectCurveThroughHandles();
    for (let band = 0; band < 10; band += 1) {
      const shown = Number(screen.getByTestId(`sound-tone-point-${band}`).dataset.gain);
      expect(Math.abs(shown - TONE_PRESETS[4].bandsDb[band])).toBeLessThan(0.1);
    }
  });

  it("runs flat from the first handle to the left edge and from the last handle to the right edge", () => {
    render(<Harness initial={[6, 0, 0, 0, 0, 0, 0, 0, 0, -6]} />);
    const curve = segments(screen.getByTestId("sound-tone-curve").getAttribute("d") ?? "");
    const handles = drawnHandles();
    expect(curve[0].from.x).toBeCloseTo(0, 6);
    expect(curve[0].from.y).toBeCloseTo(handles[0].y, 2);
    expect(curve[curve.length - 1].to.x).toBeCloseTo(WIDTH, 6);
    expect(curve[curve.length - 1].to.y).toBeCloseTo(handles[9].y, 2);
  });
});
