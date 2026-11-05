/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const displayProfile = vi.hoisted(() => ({ current: "medium" }));
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: displayProfile.current }) }));

import { TourRestartCard } from "@/components/tour/TourRestartCard";
import { subscribeTourStart, type TourStartRequest } from "@/lib/tour/tourState";

const openCard = () => fireEvent.click(screen.getByTestId("docs-section-toggle-tour"));

describe("TourRestartCard", () => {
  beforeEach(() => {
    localStorage.clear();
    displayProfile.current = "medium";
  });

  it("starts the tour from a button labelled in full on a roomy screen", () => {
    const requests: TourStartRequest[] = [];
    const release = subscribeTourStart((request) => requests.push(request));
    try {
      render(<TourRestartCard />);
      openCard();

      const start = screen.getByTestId("docs-tour-start");
      expect(start).toHaveTextContent("Start the tour");
      fireEvent.click(start);
    } finally {
      release();
    }
    expect(requests).toEqual([{}]);
  });

  it("labels the button briefly on the compact profile", () => {
    displayProfile.current = "compact";
    render(<TourRestartCard />);
    openCard();

    expect(screen.getByTestId("docs-tour-start")).toHaveTextContent(/^Start$/);
  });
});
