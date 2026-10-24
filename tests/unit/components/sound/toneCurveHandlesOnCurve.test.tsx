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
import { curveYAt, handlePosition, yForDb, type Pixel } from "@/lib/audio/tone/toneGeometry";
import { buildPlotModel, cascadeResponseDb, compensatedGains } from "@/lib/audio/tone/toneResponse";

const WIDTH = 300;
const HEIGHT = 176;
const TOLERANCE_PX = 0.5;

/** The on-curve points of a drawn path: its start and the end of each cubic segment, in plot units. */
const pathPoints = (d: string): Pixel[] =>
  d
    .split(/(?=[MC])/)
    .filter(Boolean)
    .map((segment) => {
      const numbers = segment.slice(1).trim().split(/[ ,]+/).map(Number);
      return { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
    });

const presetVectors = [...TONE_PRESETS.map((p) => [...p.bandsDb]), ...AMBIANCE_PRESETS.map((p) => p.sound.bandsDb)];
const awkward = [
  [12, -12, 12, -12, 12, -12, 12, -12, 12, -12],
  [0, 0, 0, 0, 12, 0, 0, 0, 0, 0],
  [-12, -12, -12, -12, 12, 12, 12, 12, 12, 12],
  [3, -7, 11, 2, -9, 5, 12, -4, 8, -1],
];

describe("handles sit on the drawn curve", () => {
  it("puts every handle within 0.5 px of the true cascade response for presets and awkward curves", () => {
    for (const targets of [...presetVectors, ...awkward]) {
      const gains = compensatedGains(targets);
      for (const handle of buildPlotModel(targets).targets) {
        const at = handlePosition(handle, WIDTH, HEIGHT);
        const trueY = yForDb(cascadeResponseDb(gains, handle.freq), HEIGHT);
        expect(Math.abs(trueY - at.y)).toBeLessThan(TOLERANCE_PX);
      }
    }
  });

  it("shows a handle at the value it reaches within 0.1 dB of the requested one when that is reachable", () => {
    for (const targets of presetVectors) {
      buildPlotModel(targets).targets.forEach((handle, band) =>
        expect(Math.abs(handle.db - targets[band])).toBeLessThan(0.1),
      );
    }
  });

  const Harness = () => {
    const [bands, setBands] = useState<number[]>(flatBands());
    return (
      <>
        <ToneCurveEditor bandsDb={bands} onChange={setBands} />
        <button onClick={() => setBands([...TONE_PRESETS[4].bandsDb])}>loudness</button>
      </>
    );
  };

  const expectHandlesOnPath = () => {
    const points = pathPoints(screen.getByTestId("sound-tone-curve").getAttribute("d") ?? "");
    for (let band = 0; band < 10; band += 1) {
      const handle = screen.getByTestId(`sound-tone-point-${band}`);
      const x = Number(handle.dataset.x);
      const y = Number(handle.dataset.y);
      expect(Math.abs(curveYAt(points, x) - y) * (HEIGHT / 100)).toBeLessThan(TOLERANCE_PX);
    }
  };

  it("keeps the handles on the drawn path after a key edit and after a preset change", () => {
    render(<Harness />);
    const plot = screen.getByTestId("sound-tone-plot");
    fireEvent.keyDown(plot, { key: "Enter" });
    for (let n = 0; n < 5; n += 1) fireEvent.keyDown(plot, { key: "ArrowUp" });
    expectHandlesOnPath();
    fireEvent.click(screen.getByText("loudness"));
    expectHandlesOnPath();
    for (let band = 0; band < 10; band += 1) {
      const shown = Number(screen.getByTestId(`sound-tone-point-${band}`).dataset.gain);
      expect(Math.abs(shown - TONE_PRESETS[4].bandsDb[band])).toBeLessThan(0.1);
    }
  });
});
