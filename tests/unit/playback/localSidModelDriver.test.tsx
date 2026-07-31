/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCategory = vi.fn();
let connectionState = "REAL_CONNECTED";

vi.mock("@/lib/c64api", () => ({ getC64API: () => ({ getCategory }) }));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: connectionState }) }));
vi.mock("@/hooks/useC64Connection", () => ({ useConnectionRoutingEpoch: () => 0 }));

import { LocalSidModelDriver } from "@/components/playback/LocalSidModelDriver";
import { loadLearnedDeviceSidModel, resolveLocalSidModel, saveLocalSidModelFromDevice } from "@/lib/config/appSettings";

const SOCKET_1_IS_6581 = {
  "SID Sockets Configuration": {
    "SID Socket 1": "Enabled",
    "SID Socket 2": "Disabled",
    "SID Detected Socket 1": "6581",
    "SID Detected Socket 2": "None",
  },
  errors: [],
};

beforeEach(() => {
  localStorage.clear();
  getCategory.mockReset();
  connectionState = "REAL_CONNECTED";
});

describe("LocalSidModelDriver", () => {
  it("learns the connected machine's chip and applies it to on-device playback", async () => {
    getCategory.mockResolvedValue(SOCKET_1_IS_6581);
    render(<LocalSidModelDriver />);
    await waitFor(() => expect(loadLearnedDeviceSidModel()).toBe("6581"));
    expect(resolveLocalSidModel()).toBe("6581");
  });

  it("does not touch the device when the connection is not a real one", async () => {
    connectionState = "DEMO_ACTIVE";
    render(<LocalSidModelDriver />);
    await Promise.resolve();
    // Demo mode's config tree is a fixture. Adopting its chip as "the SID in your C64" would
    // outlive the demo in a setting the user has no reason to look at.
    expect(getCategory).not.toHaveBeenCalled();
  });

  it("does not touch the device when the user has turned inference off", async () => {
    saveLocalSidModelFromDevice(false);
    render(<LocalSidModelDriver />);
    await Promise.resolve();
    expect(getCategory).not.toHaveBeenCalled();
  });

  it("reads the machine as soon as the user switches inference back on", async () => {
    saveLocalSidModelFromDevice(false);
    getCategory.mockResolvedValue(SOCKET_1_IS_6581);
    render(<LocalSidModelDriver />);
    expect(getCategory).not.toHaveBeenCalled();
    // The user has just asked the question on the Settings screen, so the answer has to arrive
    // there rather than at the next connection.
    saveLocalSidModelFromDevice(true);
    await waitFor(() => expect(loadLearnedDeviceSidModel()).toBe("6581"));
  });

  it("never lets an unreachable machine surface as a failure", async () => {
    getCategory.mockRejectedValue(new Error("Host unreachable"));
    render(<LocalSidModelDriver />);
    await waitFor(() => expect(getCategory).toHaveBeenCalled());
    expect(loadLearnedDeviceSidModel()).toBeNull();
    expect(resolveLocalSidModel()).toBe("8580");
  });
});
