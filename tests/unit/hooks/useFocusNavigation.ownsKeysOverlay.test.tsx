/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { OWNS_KEYS_ATTR, SKIP_ATTR } from "@/lib/input";

describe("a dialog that answers the D-pad and OK itself", () => {
  it("keeps focus where it is on Down and on OK", () => {
    render(
      <FocusNavigationProvider>
        <div role="dialog" aria-label="Remote Input" tabIndex={-1} {...{ [SKIP_ATTR]: "", [OWNS_KEYS_ATTR]: "" }}>
          <button type="button">Keys</button>
        </div>
      </FocusNavigationProvider>,
    );
    const dialog = screen.getByRole("dialog");
    dialog.focus();

    fireEvent.keyDown(dialog, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter", code: "Enter" });

    expect(dialog).toHaveFocus();
  });
});
