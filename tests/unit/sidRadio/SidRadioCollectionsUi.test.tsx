/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StilCollectionId } from "@/lib/hvsc/stilCollections";
import { SID_RADIO_COLLECTIONS, sidRadioCollectionLabel } from "@/lib/sidRadio/stilCollectionCatalog";
import { SidRadioChip, whyThisTuneFor } from "@/pages/playFiles/components/SidRadioChip";
import { COLLECTION_COUNTS_DELAY_MS, SidRadioLauncherSheet } from "@/pages/playFiles/components/SidRadioLauncherSheet";
import type { ActiveStation } from "@/pages/playFiles/hooks/useSidRadio";

const JULY = new Date(2026, 6, 15);
const DECEMBER = new Date(2026, 11, 20);

const renderLauncher = (
  overrides: Partial<Parameters<typeof SidRadioLauncherSheet>[0]> = {},
): { onStartCollection: ReturnType<typeof vi.fn>; onOpenChange: ReturnType<typeof vi.fn> } => {
  const onStartCollection = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SidRadioLauncherSheet
      open
      onOpenChange={onOpenChange}
      likeCount={0}
      onStartStyle={vi.fn()}
      onStartTaste={vi.fn()}
      onSurprise={vi.fn()}
      onStartCollection={onStartCollection}
      today={JULY}
      {...overrides}
    />,
  );
  return { onStartCollection, onOpenChange };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SID Radio collections in the launcher", () => {
  it("offers every collection outside its season except Christmas", () => {
    renderLauncher();
    for (const collection of SID_RADIO_COLLECTIONS) {
      const tile = screen.queryByTestId(`sid-radio-collection-${collection.id}`);
      if (collection.id === "christmas") expect(tile).toBeNull();
      else expect(tile).toHaveTextContent(collection.label);
    }
  });

  it("offers Christmas from December 1", () => {
    renderLauncher({ today: DECEMBER });
    expect(screen.getByTestId("sid-radio-collection-christmas")).toBeInTheDocument();
  });

  it.each([
    [new Date(2026, 10, 30), false],
    [new Date(2026, 11, 1), true],
    [new Date(2027, 0, 6), true],
    [new Date(2027, 0, 7), false],
  ])("decides the Christmas season on %s", (today, offered) => {
    renderLauncher({ today });
    expect(screen.queryByTestId("sid-radio-collection-christmas") !== null).toBe(offered);
  });

  it("starts the collection and closes the sheet", () => {
    const { onStartCollection, onOpenChange } = renderLauncher();
    fireEvent.click(screen.getByTestId("sid-radio-collection-winners"));
    expect(onStartCollection).toHaveBeenCalledWith("winners");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows how many tunes a collection holds, and retires one that holds none", () => {
    renderLauncher({ collectionCounts: { winners: 1423, classical: 0 } as Record<StilCollectionId, number> });
    expect(screen.getByTestId("sid-radio-collection-winners-size")).toHaveTextContent("1,423 tunes");
    expect(screen.getByTestId("sid-radio-collection-classical-size")).toHaveTextContent("None installed");
    expect(screen.getByTestId("sid-radio-collection-classical")).toBeDisabled();
    expect(screen.getByTestId("sid-radio-collection-winners")).toBeEnabled();
  });

  it("leaves every tile on offer while the counts are unknown", () => {
    renderLauncher();
    expect(screen.getByTestId("sid-radio-collection-winners")).toBeEnabled();
    expect(screen.queryByTestId("sid-radio-collection-winners-size")).toBeNull();
  });

  it("disables the collections when no HVSC music is installed", () => {
    renderLauncher({ hvscMissing: true });
    expect(screen.getByTestId("sid-radio-collection-winners")).toBeDisabled();
  });

  it("asks for the counts once the sheet has finished opening, not during its animation", () => {
    vi.useFakeTimers();
    const onLoadCollectionCounts = vi.fn();
    renderLauncher({ onLoadCollectionCounts });
    act(() => vi.advanceTimersByTime(COLLECTION_COUNTS_DELAY_MS - 1));
    expect(onLoadCollectionCounts).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onLoadCollectionCounts).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the counts when the sheet closes before it has finished opening", () => {
    vi.useFakeTimers();
    const onLoadCollectionCounts = vi.fn();
    const props = {
      onOpenChange: vi.fn(),
      likeCount: 0,
      onStartStyle: vi.fn(),
      onStartTaste: vi.fn(),
      onSurprise: vi.fn(),
      onLoadCollectionCounts,
      today: JULY,
    };
    const { rerender } = render(<SidRadioLauncherSheet open {...props} />);
    rerender(<SidRadioLauncherSheet open={false} {...props} />);
    act(() => vi.advanceTimersByTime(COLLECTION_COUNTS_DELAY_MS));
    expect(onLoadCollectionCounts).not.toHaveBeenCalled();
  });

  it("hides the section where collections cannot be started", () => {
    renderLauncher({ onStartCollection: undefined });
    expect(screen.queryByTestId("sid-radio-collections")).toBeNull();
  });

  it("says what separates a collection from a mood", () => {
    renderLauncher();
    expect(screen.getByText("Tunes that sound like the mood you pick.")).toBeInTheDocument();
    expect(screen.getByText("Only tunes from the collection, as listed in the HVSC tune notes.")).toBeInTheDocument();
  });

  it("names each collection by its label and falls back to the id", () => {
    expect(sidRadioCollectionLabel("pioneers")).toBe("Electronic pioneers");
    expect(sidRadioCollectionLabel("unknown" as StilCollectionId)).toBe("unknown");
  });
});

const collectionStation: ActiveStation = {
  seedKind: "collection",
  seedLabel: "Competition winners",
  styleBit: null,
  shuffleSeed: 1,
  rankingSnapshotId: "x",
};

describe("SID Radio chip for a collection", () => {
  it("names the collection and how far through it the station is", () => {
    render(
      <SidRadioChip station={collectionStation} collectionProgress={{ heard: 12, total: 423 }} onStop={vi.fn()} />,
    );
    expect(screen.getByTestId("sid-radio-chip")).toHaveTextContent("Radio: Competition winners");
    expect(screen.getByTestId("sid-radio-collection-progress")).toHaveTextContent("12 of 423");
  });

  it("says it is fetching the tune notes while a collection waits for them, with no station running", () => {
    render(<SidRadioChip station={null} preparingCollection onStop={vi.fn()} />);
    expect(screen.getByTestId("sid-radio-preparing")).toHaveTextContent("Fetching tune notes…");
    expect(screen.queryByText("Your playlist")).toBeNull();
  });

  it("says it is fetching the tune notes in place of the station's name, and keeps Stop", () => {
    render(
      <SidRadioChip
        station={collectionStation}
        collectionProgress={{ heard: 1, total: 2 }}
        preparingCollection
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sid-radio-preparing")).toHaveTextContent("Fetching tune notes…");
    expect(screen.queryByTestId("sid-radio-collection-progress")).toBeNull();
    expect(screen.getByTestId("sid-radio-stop")).toBeEnabled();
  });

  it("shows no progress before the collection's size is known", () => {
    render(<SidRadioChip station={collectionStation} onStop={vi.fn()} />);
    expect(screen.queryByTestId("sid-radio-collection-progress")).toBeNull();
  });

  it.each([
    [{ seedKind: "song", seedLabel: "Commando" }, "Similar to Commando"],
    [{ seedKind: "style", seedLabel: "Melodic" }, "Matches Melodic"],
    [{ seedKind: "taste", seedLabel: "Tunes you like" }, "From tunes you like"],
    [{ seedKind: "collection", seedLabel: "Classical" }, "In the Classical collection"],
  ] as const)("explains a %o station's tune as %j", (station, why) => {
    expect(whyThisTuneFor({ ...collectionStation, ...station })).toBe(why);
  });
});
