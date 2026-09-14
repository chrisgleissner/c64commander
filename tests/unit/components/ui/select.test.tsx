/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// jsdom runs no CSS animations, so Radix unmounts a closed list at once. `forceMount` keeps the list
// mounted in the state a browser holds it in while the exit animation plays: `data-state="closed"`.
const renderSelect = (
  open: boolean,
  onValueChange: (value: string) => void,
  onItemKeyDown?: React.KeyboardEventHandler<HTMLDivElement>,
) =>
  render(
    <Select open={open} value="PAL" onValueChange={onValueChange}>
      <SelectTrigger aria-label="System mode">
        <SelectValue />
      </SelectTrigger>
      <SelectContent forceMount>
        <SelectItem value="PAL">PAL</SelectItem>
        <SelectItem value="NTSC" onKeyDown={onItemKeyDown}>
          NTSC
        </SelectItem>
      </SelectContent>
    </Select>,
  );

describe("SelectItem", () => {
  it("selects the focused option on Enter while the list is open", () => {
    const onValueChange = vi.fn();
    renderSelect(true, onValueChange);

    const option = screen.getByRole("option", { name: "NTSC" });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("NTSC");
  });

  it.each(["Enter", " "])("ignores %j on an option of a list that is closing", (key) => {
    const onValueChange = vi.fn();
    renderSelect(false, onValueChange);

    expect(screen.getByRole("listbox", { hidden: true })).toHaveAttribute("data-state", "closed");
    const option = screen.getByRole("option", { name: "NTSC", hidden: true });
    option.focus();
    fireEvent.keyDown(option, { key });

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("passes every key to the item's own onKeyDown and still does not select on a closing list", () => {
    const onValueChange = vi.fn();
    const onItemKeyDown = vi.fn();
    renderSelect(false, onValueChange, onItemKeyDown);

    const option = screen.getByRole("option", { name: "NTSC", hidden: true });
    option.focus();
    fireEvent.keyDown(option, { key: "ArrowDown" });
    fireEvent.keyDown(option, { key: "Enter" });

    expect(onItemKeyDown.mock.calls.map(([event]) => event.key)).toEqual(["ArrowDown", "Enter"]);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
