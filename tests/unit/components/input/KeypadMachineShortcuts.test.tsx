/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const statusState = vi.hoisted(() => ({ isConnected: true }));
const pauseMutateAsync = vi.hoisted(() => vi.fn(async () => undefined));
const resumeMutateAsync = vi.hoisted(() => vi.fn(async () => undefined));
const resetMutateAsync = vi.hoisted(() => vi.fn(async () => undefined));
const pauseResumeMachineMock = vi.hoisted(() => vi.fn());
const publishMachineInterruptMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const reportUserErrorMock = vi.hoisted(() => vi.fn());
const addErrorLogMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useTargetDeviceIdentity", () => ({
  useTargetDeviceIdentity: () => ({ deviceId: "device-1", multiDevice: false, fullLabel: "c64u", shortLabel: "c64u" }),
}));

vi.mock("@/lib/c64api", () => ({ getC64API: () => ({}) }));
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: statusState }),
  useC64MachineControl: () => ({
    pause: { mutateAsync: pauseMutateAsync },
    resume: { mutateAsync: resumeMutateAsync },
    reset: { mutateAsync: resetMutateAsync },
  }),
}));
vi.mock("@/lib/deviceInteraction/machineInterrupt", () => ({
  publishMachineInterrupt: publishMachineInterruptMock,
}));
vi.mock("@/lib/machine/pauseResumeMachine", () => ({ pauseResumeMachine: pauseResumeMachineMock }));
vi.mock("@/lib/savedDevices/store", () => ({ getSelectedSavedDevice: () => ({ id: "device-1" }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: (...args: unknown[]) => reportUserErrorMock(...args) }));
vi.mock("@/lib/logging", () => ({ addErrorLog: (...args: unknown[]) => addErrorLogMock(...args), addLog: vi.fn() }));

import { KeypadMachineShortcuts } from "@/components/input/KeypadMachineShortcuts";
import { requestMachineCommand } from "@/lib/input/keypadCommands";

const press = async (command: "pauseResume" | "reset") => {
  await act(async () => {
    requestMachineCommand(command);
  });
};

describe("the machine actions the keypad's 8 and 9 keys reach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusState.isConnected = true;
    pauseResumeMachineMock.mockResolvedValue("paused");
  });

  it("pauses on 8 through the same implementation Home's tile uses", async () => {
    // Run whichever half the shared implementation would run, so the mutations it is handed are
    // exercised rather than only passed along.
    pauseResumeMachineMock.mockImplementation(async (input: { pause: () => Promise<unknown> }) => {
      await input.pause();
      return "paused";
    });
    render(<KeypadMachineShortcuts />);

    await press("pauseResume");

    await waitFor(() => expect(pauseResumeMachineMock).toHaveBeenCalledTimes(1));
    expect(pauseResumeMachineMock.mock.calls[0][0]).toMatchObject({ deviceId: "device-1" });
    expect(pauseMutateAsync).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ title: "Machine paused" });
  });

  it("says it resumed when that is the direction the machine moved", async () => {
    pauseResumeMachineMock.mockImplementation(async (input: { resume: () => Promise<unknown> }) => {
      await input.resume();
      return "running";
    });
    render(<KeypadMachineShortcuts />);

    await press("pauseResume");

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: "Machine resumed" }));
    expect(resumeMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("reports a failed pause instead of leaving the press looking like it worked", async () => {
    pauseResumeMachineMock.mockRejectedValue(new Error("machine did not answer"));
    render(<KeypadMachineShortcuts />);

    await press("pauseResume");

    await waitFor(() =>
      expect(reportUserErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "KEYPAD_MACHINE_PAUSE_RESUME", description: "machine did not answer" }),
      ),
    );
    expect(addErrorLogMock).toHaveBeenCalled();
  });

  it("does nothing while no device is connected", async () => {
    statusState.isConnected = false;
    render(<KeypadMachineShortcuts />);

    await press("pauseResume");
    await press("reset");

    expect(pauseResumeMachineMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("machine-action-confirmation")).toBeNull();
  });

  it("asks before it resets, and resets only once the confirmation is answered", async () => {
    render(<KeypadMachineShortcuts />);

    await press("reset");

    expect(await screen.findByTestId("machine-action-confirmation")).toBeInTheDocument();
    expect(resetMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(resetMutateAsync).toHaveBeenCalledTimes(1));
    expect(publishMachineInterruptMock).toHaveBeenCalledWith({ reason: "home-reset", label: "Reset" });
    expect(toastMock).toHaveBeenCalledWith({ title: "Machine reset" });
  });

  it("leaves the machine alone when the confirmation is cancelled", async () => {
    render(<KeypadMachineShortcuts />);

    await press("reset");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByTestId("machine-action-confirmation")).toBeNull());
    expect(resetMutateAsync).not.toHaveBeenCalled();
  });

  it("reports a reset the machine refused", async () => {
    resetMutateAsync.mockRejectedValueOnce(new Error("reset refused"));
    render(<KeypadMachineShortcuts />);

    await press("reset");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(reportUserErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "KEYPAD_MACHINE_RESET", description: "reset refused" }),
      ),
    );
  });
});
