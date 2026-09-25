/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadConfigDialog } from "@/pages/home/dialogs/LoadConfigDialog";
import { SaveConfigDialog } from "@/pages/home/dialogs/SaveConfigDialog";

// These dialogs act on whichever Ultimate is connected, an Ultimate-II+ cartridge included.
describe("the app config dialogs name the machine they act on generically", () => {
  it("offers to store the configuration of the connected machine, whatever model it is", () => {
    render(<SaveConfigDialog open onOpenChange={vi.fn()} existingNames={[]} onSave={vi.fn()} isSaving={false} />);

    expect(screen.getByText("Store the current configuration of your C64 in this app.")).toBeInTheDocument();
  });

  it("offers to apply a saved configuration to the connected machine, whatever model it is", () => {
    render(<LoadConfigDialog open onOpenChange={vi.fn()} configs={[]} onLoad={vi.fn()} applyingConfigId={null} />);

    expect(screen.getByText("Select a saved configuration to apply to your C64.")).toBeInTheDocument();
  });
});
