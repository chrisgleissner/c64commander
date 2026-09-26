/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConnectC64Card } from "@/pages/home/components/ConnectC64Card";
import { resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

const seedSelectedDevice = (lastSuccessfulConnectionAt: string | null) => {
  localStorage.setItem(
    "c64u_saved_devices:v1",
    JSON.stringify({
      version: 1,
      selectedDeviceId: "home",
      devices: [{ id: "home", host: "192.0.2.146", httpPort: 80, lastSuccessfulConnectionAt }],
      summaries: {},
      summaryLru: [],
    }),
  );
  resetSavedDevicesCacheForTests();
};

const renderCard = () =>
  render(
    <MemoryRouter>
      <ConnectC64Card />
    </MemoryRouter>,
  );

describe("the card Home shows while no C64 Ultimate is connected", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => resetSavedDevicesCacheForTests());

  it("asks a user without a working device to set one up", () => {
    seedSelectedDevice(null);
    renderCard();

    expect(screen.getByRole("heading")).toHaveTextContent("Connect a C64 Ultimate");
    expect(screen.getByTestId("home-connect-c64-setup")).toHaveTextContent("Set up a device");
  });

  // Out and about with a device that has connected before, "Set up a device" read as if it had been lost.
  it("tells a user whose device has connected before that it is out of reach and reconnects by itself", () => {
    seedSelectedDevice("2026-09-15T10:00:00.000Z");
    renderCard();

    expect(screen.getByRole("heading")).toHaveTextContent("C64 Ultimate out of reach");
    expect(screen.getByText(/connects again by itself/)).toBeInTheDocument();
    expect(screen.getByTestId("home-connect-c64-setup")).toHaveTextContent("Connection settings");
  });
});
