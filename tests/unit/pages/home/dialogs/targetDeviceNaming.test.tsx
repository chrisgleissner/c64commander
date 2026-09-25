/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  current: { deviceId: "d1", multiDevice: true, fullLabel: "Workshop", shortLabel: "Workshop" },
}));
vi.mock("@/hooks/useTargetDeviceIdentity", () => ({ useTargetDeviceIdentity: () => identity.current }));

import { MachineActionConfirmationDialog } from "@/pages/home/dialogs/MachineActionConfirmationDialog";
import { PowerOffDialog } from "@/pages/home/dialogs/PowerOffDialog";

const reset = { actionName: "Reset", consequence: "This resets the running C64 session." };

describe("confirmations name the device they act on", () => {
  beforeEach(() => {
    identity.current = { deviceId: "d1", multiDevice: true, fullLabel: "Workshop", shortLabel: "Workshop" };
  });

  it("names the device a machine action goes to when more than one is saved", () => {
    render(<MachineActionConfirmationDialog open action={reset} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText("Confirm Reset on Workshop.")).toBeInTheDocument();
  });

  it("does not name the only device there is", () => {
    identity.current = { ...identity.current, multiDevice: false };
    render(<MachineActionConfirmationDialog open action={reset} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText("Confirm Reset.")).toBeInTheDocument();
  });

  it("names the device that will be powered off", () => {
    render(<PowerOffDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending={false} />);

    expect(screen.getByText(/Once powered off, Workshop cannot be powered on again/)).toBeInTheDocument();
  });
});
