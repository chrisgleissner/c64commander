/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PendingConfigChangeDialog,
  type PendingConfigChangeState,
} from "@/pages/playFiles/components/PendingConfigChangeDialog";

const change: PendingConfigChangeState = {
  itemId: "item-1",
  configRef: { kind: "local", fileName: "tune.cfg", sourceId: "src", path: "/tune.cfg" } as never,
  origin: "manual",
  candidates: [],
};

const renderDialog = (pendingConfigChange: PendingConfigChangeState | null) => {
  const onConfirmed = vi.fn();
  const onClosed = vi.fn();
  render(
    <PendingConfigChangeDialog
      pendingConfigChange={pendingConfigChange}
      onPendingConfigChangeConfirmed={onConfirmed}
      onPendingConfigChangeClosed={onClosed}
    />,
  );
  return { onConfirmed, onClosed };
};

afterEach(cleanup);

describe("PendingConfigChangeDialog", () => {
  it("shows nothing while no config change is waiting for an answer", () => {
    renderDialog(null);
    expect(screen.queryByText("Clear custom edits?")).toBeNull();
  });

  it("explains that the change clears the item's custom edits", () => {
    renderDialog(change);
    expect(screen.getByText("Clear custom edits?")).toBeInTheDocument();
    expect(screen.getByText(/will clear this item.s custom value edits/)).toBeInTheDocument();
  });

  it("hands the waiting change back, then closes, when Continue is pressed", () => {
    const { onConfirmed, onClosed } = renderDialog(change);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith(change);
    expect(onClosed).toHaveBeenCalled();
    expect(onConfirmed.mock.invocationCallOrder[0]).toBeLessThan(onClosed.mock.invocationCallOrder[0]);
  });

  it("closes without applying the change on Cancel", () => {
    const { onConfirmed, onClosed } = renderDialog(change);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("closes without applying the change when dismissed with Escape", () => {
    const { onConfirmed, onClosed } = renderDialog(change);

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});
