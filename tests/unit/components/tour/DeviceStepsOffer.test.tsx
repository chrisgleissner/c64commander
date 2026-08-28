/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionRef = vi.hoisted(() => ({ current: { isConnected: false } }));
vi.mock("@/hooks/useC64Connection", () => ({ useC64Connection: () => ({ status: connectionRef.current }) }));

import { DeviceStepsOffer } from "@/components/tour/DeviceStepsOffer";
import { DEVICE_STEP_IDS } from "@/lib/tour/steps";
import { TOUR_STATE_KEY, loadTourState, subscribeTourStart, type TourStartRequest } from "@/lib/tour/tourState";

const setPending = (pending: boolean) =>
  localStorage.setItem(
    TOUR_STATE_KEY,
    JSON.stringify({ completedAt: 1, skippedAt: null, lastStepId: null, deviceStepsPending: pending }),
  );

describe("DeviceStepsOffer", () => {
  beforeEach(() => {
    localStorage.clear();
    connectionRef.current = { isConnected: false };
  });

  it("is silent while nothing is connected, even with the steps pending", () => {
    setPending(true);
    render(<DeviceStepsOffer />);
    expect(screen.queryByTestId("home-tour-device-steps-offer")).toBeNull();
  });

  it("is silent when the steps are not pending", () => {
    setPending(false);
    connectionRef.current = { isConnected: true };
    render(<DeviceStepsOffer />);
    expect(screen.queryByTestId("home-tour-device-steps-offer")).toBeNull();
  });

  it("offers the steps once a machine is connected", async () => {
    setPending(true);
    connectionRef.current = { isConnected: true };
    render(<DeviceStepsOffer />);
    await waitFor(() => expect(screen.getByTestId("home-tour-device-steps-offer")).toBeInTheDocument());
  });

  it("starts the tour at the first device step", async () => {
    setPending(true);
    connectionRef.current = { isConnected: true };
    const requests: TourStartRequest[] = [];
    const release = subscribeTourStart((request) => requests.push(request));
    try {
      render(<DeviceStepsOffer />);
      await waitFor(() => expect(screen.getByTestId("home-tour-device-steps-start")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("home-tour-device-steps-start"));
      expect(requests).toEqual([{ fromStepId: DEVICE_STEP_IDS[0] }]);
    } finally {
      release();
    }
  });

  /* D10: it is never offered twice. Taking it clears the flag as surely as dismissing it does. */
  it("clears the flag when the offer is taken", async () => {
    setPending(true);
    connectionRef.current = { isConnected: true };
    render(<DeviceStepsOffer />);
    await waitFor(() => expect(screen.getByTestId("home-tour-device-steps-start")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("home-tour-device-steps-start"));
    await waitFor(() => expect(loadTourState().deviceStepsPending).toBe(false));
  });

  it("clears the flag when the offer is dismissed", async () => {
    setPending(true);
    connectionRef.current = { isConnected: true };
    render(<DeviceStepsOffer />);
    await waitFor(() => expect(screen.getByTestId("home-tour-device-steps-dismiss")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("home-tour-device-steps-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("home-tour-device-steps-offer")).toBeNull());
    expect(loadTourState().deviceStepsPending).toBe(false);
  });

  it("is not offered a second time after it has been dismissed once", async () => {
    setPending(true);
    connectionRef.current = { isConnected: true };
    const { unmount } = render(<DeviceStepsOffer />);
    await waitFor(() => expect(screen.getByTestId("home-tour-device-steps-dismiss")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("home-tour-device-steps-dismiss"));
    await waitFor(() => expect(loadTourState().deviceStepsPending).toBe(false));
    unmount();

    render(<DeviceStepsOffer />);
    expect(screen.queryByTestId("home-tour-device-steps-offer")).toBeNull();
  });
});
