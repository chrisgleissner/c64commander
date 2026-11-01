/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interstitial = vi.hoisted(() => ({ active: false }));
vi.mock("@/components/ui/interstitial-state", () => ({ useInterstitialActive: () => interstitial.active }));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: "OFFLINE_NO_DEMO" }) }));
vi.mock("@/hooks/useDeviceDiscovery", () => ({ useDeviceDiscovery: () => ({ phase: "idle" }) }));
vi.mock("@/components/tour/TourDriver", () => ({
  default: () => <div data-testid="tour-driver-stand-in" />,
}));

import { TourHost } from "@/components/tour/TourHost";
import { requestTourStart } from "@/lib/tour/tourState";

describe("TourHost (SPM-TOUR-01)", () => {
  beforeEach(() => {
    localStorage.clear();
    interstitial.active = false;
  });
  afterEach(() => localStorage.clear());

  it("a sheet opened over a running tour ends the tour instead of stacking on it", async () => {
    const view = render(<TourHost />);
    await act(async () => requestTourStart({}));
    expect(await screen.findByTestId("tour-driver-stand-in")).toBeInTheDocument();

    interstitial.active = true;
    await act(async () => view.rerender(<TourHost />));

    expect(screen.queryByTestId("tour-driver-stand-in")).toBeNull();
  });
});
