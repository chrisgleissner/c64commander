/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidRadioChip } from "@/pages/playFiles/components/SidRadioChip";
import type { ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

const songStation: ActiveStation = {
  seedKind: "song",
  seedLabel: "Commando",
  styleBit: null,
  shuffleSeed: 42,
  rankingSnapshotId: "x",
};

describe("SidRadioChip", () => {
  it("names a Song station and Style station", () => {
    const { rerender } = render(<SidRadioChip station={songStation} onStop={vi.fn()} />);
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent("Radio: Commando");
    rerender(
      <SidRadioChip
        station={{ ...songStation, seedKind: "style", seedLabel: "Fast-Paced", styleBit: 0 }}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent("Fast-Paced Radio");
  });

  it("stops the station via the stop control", () => {
    const onStop = vi.fn();
    render(<SidRadioChip station={songStation} onStop={onStop} />);
    fireEvent.click(screen.getByTestId("sid-radio-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("expands the 'why this tune' provenance on tap", () => {
    render(<SidRadioChip station={songStation} whyThisTune="similar to Commando" onStop={vi.fn()} />);
    expect(screen.queryByTestId("sid-radio-why")).toBeNull();
    fireEvent.click(screen.getByTestId("sid-radio-chip-toggle"));
    expect(screen.getByTestId("sid-radio-why")).toHaveTextContent("similar to Commando");
  });
});
