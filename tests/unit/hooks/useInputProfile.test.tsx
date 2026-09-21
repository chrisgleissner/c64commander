/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { installKeymapOverrides } from "@/lib/input/keymapOverrides";
import { parseKeymapOverride } from "@/lib/input/keymapOverrideSchema";

const overrideFile = (bindings: unknown[]) => {
  const parsed = parseKeymapOverride(JSON.stringify({ schema: 1, bindings }));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.file;
};

afterEach(() => installKeymapOverrides([]));

describe("keymap override files reach an already mounted provider", () => {
  it("routes a key bound only by a file installed after mount", () => {
    const openDiagnostics = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad" shortcuts={{ openDiagnostics }}>
        <button type="button">anything focusable</button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { key: "Unidentified", code: "", keyCode: 142 });
    expect(openDiagnostics).not.toHaveBeenCalled();

    act(() => installKeymapOverrides([overrideFile([{ keyCode: 142, action: "star" }])]));
    fireEvent.keyDown(document.body, { key: "Unidentified", code: "", keyCode: 142 });

    expect(openDiagnostics).toHaveBeenCalledOnce();
  });
});
