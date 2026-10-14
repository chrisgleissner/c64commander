/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { useArrangementPin } from "@/hooks/useArrangementPin";
import { resetInputModality } from "@/lib/input";

const SELECTED = "data-key-selected";

/** Queries whose root is the whole document: with no match they visit every element in it. */
const countDocumentWideQueries = () => {
  const counted = { count: 0 };
  const roots = () => [document, document.body, document.documentElement];
  for (const proto of [Document.prototype, Element.prototype]) {
    for (const name of ["querySelector", "querySelectorAll"] as const) {
      const original = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      vi.spyOn(proto as never, name as never).mockImplementation(function (this: unknown, ...args: unknown[]) {
        if (roots().includes(this as never)) counted.count += 1;
        return original.apply(this, args);
      } as never);
    }
  }
  return counted;
};

const ArrangementPinReadout = () => {
  const pinned = useArrangementPin();
  return <output data-testid="pinned">{String(pinned)}</output>;
};

const Page = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <ArrangementPinReadout />
      <section data-section-label="Machine">
        <button>Reset</button>
        <button>Pause</button>
      </section>
      <section data-section-label="Drives">
        <button>Mount</button>
        <button onClick={() => setDialogOpen(true)}>Open dialog</button>
      </section>
      {Array.from({ length: 200 }, (_, index) => (
        <p key={index}>Line {index}</p>
      ))}
      {dialogOpen ? (
        <div role="dialog" aria-label="Confirm">
          <button onClick={() => setDialogOpen(false)}>Close dialog</button>
        </div>
      ) : null}
    </>
  );
};

const pressAndSettle = async (code: string) => {
  await act(async () => {
    fireEvent.keyDown(document.body, { code });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("keypad key handling document-wide queries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetInputModality();
  });

  it("does not search the whole document on a D-pad press while the page is unchanged", async () => {
    render(
      <FocusNavigationProvider>
        <Page />
      </FocusNavigationProvider>,
    );
    await pressAndSettle("ArrowDown");
    await pressAndSettle("ArrowDown");

    const queries = countDocumentWideQueries();
    const presses = 6;
    for (let press = 0; press < presses; press += 1) await pressAndSettle("ArrowDown");
    const perPress = queries.count / presses;

    expect(document.querySelectorAll(`[${SELECTED}="true"]`)).toHaveLength(1);
    expect(perPress).toBe(0);
  });

  it("still sees a dialog that opened and closed between two key presses", async () => {
    render(
      <FocusNavigationProvider>
        <Page />
      </FocusNavigationProvider>,
    );
    await pressAndSettle("ArrowDown");
    expect(screen.getByTestId("pinned").textContent).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("pinned").textContent).toBe("true");
    await pressAndSettle("ArrowDown");
    const closeDialog = screen.getByRole("button", { name: "Close dialog" });
    expect(closeDialog.getAttribute(SELECTED)).toBe("true");

    await act(async () => {
      fireEvent.click(closeDialog);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("pinned").textContent).toBe("false");
    await pressAndSettle("ArrowDown");
    const selected = document.querySelector(`[${SELECTED}="true"]`);
    expect(selected).not.toBeNull();
    expect(selected!.closest('[role="dialog"]')).toBeNull();
  });
});
