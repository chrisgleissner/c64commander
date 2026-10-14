/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDestructiveDialog } from "@/components/ConfirmDestructiveDialog";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { ClearFlashDialog } from "@/pages/home/dialogs/ClearFlashDialog";
import { MachineActionConfirmationDialog } from "@/pages/home/dialogs/MachineActionConfirmationDialog";
import { ManageConfigDialog } from "@/pages/home/dialogs/ManageConfigDialog";
import { PowerOffDialog } from "@/pages/home/dialogs/PowerOffDialog";

vi.mock("@/hooks/useTargetDeviceIdentity", () => ({
  useTargetDeviceIdentity: () => ({ multiDevice: false, fullLabel: null }),
}));

/*
 * The keypad ring starts on whatever holds focus when a dialog opens. A destructive confirmation
 * that opened on its action ran that action for a keypad user who pressed OK twice.
 */
const expectOpensOnCancel = async (dialog: ReactElement) => {
  render(<InterstitialStateProvider>{dialog}</InterstitialStateProvider>);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
};

describe("destructive confirmations open on Cancel", () => {
  it("Reset and the other machine actions", async () => {
    await expectOpensOnCancel(
      <MachineActionConfirmationDialog
        open
        action={{ actionName: "Reset", consequence: "Resets the machine." }}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
  });

  it("Power off", async () => {
    await expectOpensOnCancel(<PowerOffDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
  });

  it("Clear flash configuration", async () => {
    await expectOpensOnCancel(<ClearFlashDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
  });

  it("Clear playlist and the other shared destructive confirmations", async () => {
    await expectOpensOnCancel(
      <ConfirmDestructiveDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        title="Clear playlist?"
        description="Removes every item."
        confirmLabel="Clear"
        idPrefix="clear-playlist"
      />,
    );
  });

  it("Delete config", async () => {
    render(
      <InterstitialStateProvider>
        <ManageConfigDialog
          open
          onOpenChange={vi.fn()}
          configs={[{ id: "config-1", name: "Daily Driver", savedAt: "2026-03-26T12:34:56.000Z" }]}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />
      </InterstitialStateProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByTestId("manage-configs-delete-dialog");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })));
  });
});
