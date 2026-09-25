/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LatencyAnalysisPopup } from "@/components/diagnostics/LatencyAnalysisPopup";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { clearLatencySamples, recordLatencySample } from "@/lib/diagnostics/latencyTracker";

// jsdom has no layout, so the responsive wrapper would measure 0 x 0 and draw nothing. A fixed
// size lets the real chart render its axis ticks and legend.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 400, height: 240 })
        : null,
  };
});

describe("LatencyAnalysisPopup chart text", () => {
  afterEach(() => clearLatencySamples());

  it("draws axis ticks and the legend at 14 px or more", () => {
    recordLatencySample("REST", "/v1/info", 40);
    recordLatencySample("REST", "/v1/configs", 900);

    render(
      <DisplayProfileProvider>
        <LatencyAnalysisPopup open onClose={() => {}} />
      </DisplayProfileProvider>,
    );

    const panel = screen.getByTestId("latency-chart-panel");
    const ticks = Array.from(panel.querySelectorAll(".recharts-cartesian-axis-tick-value"));
    const legend = panel.querySelector<HTMLElement>(".recharts-legend-wrapper");

    expect(ticks.length).toBeGreaterThan(0);
    const tickSizes = ticks.map((tick) => Number.parseFloat(tick.getAttribute("font-size") ?? "0"));
    expect(tickSizes.filter((px) => px < 14)).toEqual([]);
    expect(legend).not.toBeNull();
    expect(Number.parseFloat(legend!.style.fontSize)).toBeGreaterThanOrEqual(14);
  });
});
