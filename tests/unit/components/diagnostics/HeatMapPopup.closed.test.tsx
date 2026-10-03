/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const buildRestHeatMap = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diagnostics/heatMapData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/diagnostics/heatMapData")>();
  buildRestHeatMap.mockImplementation(actual.buildRestHeatMap);
  return { ...actual, buildRestHeatMap };
});

import { HeatMapPopup } from "@/components/diagnostics/HeatMapPopup";

describe("HeatMapPopup while closed", () => {
  it("builds no matrix when Diagnostics re-renders it closed, and builds one when it opens", () => {
    const props = { onClose: () => undefined, variant: "REST" as const };
    const { rerender } = render(<HeatMapPopup open={false} traceEvents={[]} {...props} />);
    rerender(<HeatMapPopup open={false} traceEvents={[]} {...props} />);
    rerender(<HeatMapPopup open={false} traceEvents={[]} {...props} />);
    expect(buildRestHeatMap).not.toHaveBeenCalled();

    rerender(<HeatMapPopup open traceEvents={[]} {...props} />);
    expect(buildRestHeatMap).toHaveBeenCalledTimes(1);
  });
});
