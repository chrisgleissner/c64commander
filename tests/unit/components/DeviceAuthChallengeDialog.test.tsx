/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = {
  selectedDeviceId: "dev-c64u",
  devices: [
    { id: "dev-c64u", name: "Living Room C64U", host: "192.168.1.167" },
    { id: "dev-u64", name: "Studio U64", host: "192.168.1.13" },
  ],
};

vi.mock("@/lib/savedDevices/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/savedDevices/store")>();
  return {
    ...actual,
    getSavedDevicesSnapshot: () => snapshot,
  };
});

const submitAuthChallengePassword = vi.fn(async () => true);
const cancelAuthChallenge = vi.fn();
vi.mock("@/lib/auth/authChallengeController", () => ({
  submitAuthChallengePassword: (...args: unknown[]) => submitAuthChallengePassword(...args),
  cancelAuthChallenge: () => cancelAuthChallenge(),
}));

import { DeviceAuthChallengeDialog } from "@/components/DeviceAuthChallengeDialog";
import { notifyAuthRequired, resetAuthChallengeForTests, setAuthChallengeError } from "@/lib/auth/authChallenge";

describe("DeviceAuthChallengeDialog", () => {
  beforeEach(() => {
    resetAuthChallengeForTests();
    submitAuthChallengePassword.mockClear();
    submitAuthChallengePassword.mockResolvedValue(true);
    cancelAuthChallenge.mockClear();
  });

  afterEach(() => {
    resetAuthChallengeForTests();
  });

  it("renders nothing until a Forbidden response raises a challenge", () => {
    render(<DeviceAuthChallengeDialog />);
    expect(screen.queryByText(/network password required/i)).toBeNull();
  });

  it("opens a single popup naming the affected device on Forbidden", () => {
    render(<DeviceAuthChallengeDialog />);
    act(() => {
      notifyAuthRequired({ host: "192.168.1.167" });
      // Burst of Forbidden responses must coalesce into one popup.
      notifyAuthRequired({ host: "192.168.1.167" });
      notifyAuthRequired({ host: "192.168.1.13" });
    });
    expect(screen.getByText(/network password required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Living Room C64U/i).length).toBeGreaterThan(0);
    // Exactly one dialog title — the burst did not stack popups.
    expect(screen.getAllByText(/network password required/i)).toHaveLength(1);
  });

  it("masks the password input", () => {
    render(<DeviceAuthChallengeDialog />);
    act(() => notifyAuthRequired({ host: "192.168.1.167" }));
    const input = screen.getByTestId("device-auth-challenge-input");
    expect(input).toHaveAttribute("type", "password");
  });

  it("submits the entered password to the controller", async () => {
    render(<DeviceAuthChallengeDialog />);
    act(() => notifyAuthRequired({ host: "192.168.1.167" }));
    fireEvent.change(screen.getByTestId("device-auth-challenge-input"), { target: { value: "pwd" } });
    fireEvent.click(screen.getByTestId("device-auth-challenge-submit"));
    await waitFor(() => expect(submitAuthChallengePassword).toHaveBeenCalledWith("pwd"));
  });

  it("shows the rejection message and re-prompts on a wrong password", async () => {
    submitAuthChallengePassword.mockImplementation(async () => {
      // Mirror the controller: failed submit sets an error and keeps the popup open.
      setAuthChallengeError("The device rejected that password. Check it on the device and try again.");
      return false;
    });
    render(<DeviceAuthChallengeDialog />);
    act(() => notifyAuthRequired({ host: "192.168.1.167" }));
    fireEvent.change(screen.getByTestId("device-auth-challenge-input"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("device-auth-challenge-submit"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/rejected that password/i));
    // Still open for another attempt.
    expect(screen.getByTestId("device-auth-challenge-input")).toBeInTheDocument();
  });

  it("cancels via the Cancel button", () => {
    render(<DeviceAuthChallengeDialog />);
    act(() => notifyAuthRequired({ host: "192.168.1.167" }));
    fireEvent.click(screen.getByTestId("device-auth-challenge-cancel"));
    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
  });
});
