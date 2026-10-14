/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const checkboxRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => {
    checkboxRenders.count += 1;
    return <span data-testid="row-checkbox" />;
  },
}));

import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const items: ActionListItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `item-${index + 1}`,
  title: `Track ${index + 1}`,
  selected: false,
  actionLabel: "Play",
  onSelectToggle: vi.fn(),
  onAction: vi.fn(),
}));

let tick: () => void = () => undefined;

const Page = ({ rowItems }: { rowItems: ActionListItem[] }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  tick = () => setElapsedSeconds((value) => value + 1);
  return (
    <DisplayProfileProvider>
      <span>{elapsedSeconds}</span>
      <SelectableActionList
        title="Playlist"
        items={rowItems}
        totalItemCount={rowItems.length}
        emptyLabel="No files"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={20}
      />
    </DisplayProfileProvider>
  );
};

describe("SelectableActionList rows", () => {
  it("do not render again when the page around the list ticks and the items are the same objects", () => {
    render(<Page rowItems={items} />);
    const rendersAfterMount = checkboxRenders.count;
    expect(rendersAfterMount).toBeGreaterThanOrEqual(items.length);

    act(() => tick());
    act(() => tick());

    expect(checkboxRenders.count).toBe(rendersAfterMount);
  });

  it("render again when the item they show is a different object", () => {
    const { rerender } = render(<Page rowItems={items} />);
    const rendersAfterMount = checkboxRenders.count;

    rerender(<Page rowItems={items.map((item, index) => (index === 0 ? { ...item, selected: true } : item))} />);

    expect(checkboxRenders.count).toBe(rendersAfterMount + 1);
  });
});
