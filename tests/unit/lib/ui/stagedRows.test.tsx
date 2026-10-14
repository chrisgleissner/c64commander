/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetStagedRowsForTests, setStagedRowsEnabled, useStagedRows } from "@/lib/ui/stagedRows";

const ROWS = 40;

const List = ({ name }: { name: string }) => {
  const staged = useStagedRows(ROWS);
  return (
    <div>
      {Array.from({ length: staged.count }, (_, index) => (
        <div key={index} data-testid="row">{`${name} ${index + 1}`}</div>
      ))}
      {staged.marker}
    </div>
  );
};

describe("useStagedRows", () => {
  afterEach(() => {
    setStagedRowsEnabled(false);
    resetStagedRowsForTests();
    vi.restoreAllMocks();
  });

  it("caps the rows built before the paint when every list reads as on screen, as lists in opening cards do", async () => {
    setStagedRowsEnabled(true);
    // A card that is opening animates from zero height, so its list's end stays on screen however many
    // rows it is given.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 120 } as DOMRect);

    render(
      <>
        <List name="First" />
        <List name="Second" />
        <List name="Third" />
      </>,
    );

    const beforePaint = screen.getAllByTestId("row").length;
    expect(beforePaint).toBeGreaterThan(0);
    expect(beforePaint).toBeLessThanOrEqual(36);

    await waitFor(() => expect(screen.getAllByTestId("row")).toHaveLength(3 * ROWS));
  });
});
