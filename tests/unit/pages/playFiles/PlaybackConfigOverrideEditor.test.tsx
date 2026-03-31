import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackConfigOverrideEditor } from "@/pages/playFiles/components/PlaybackConfigOverrideEditor";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64Categories: vi.fn(),
  useC64Category: vi.fn(),
}));

vi.mock("@/components/ConfigItemRow", () => ({
  ConfigItemRow: ({
    name,
    value,
    onValueChange,
  }: {
    name: string;
    value: string | number;
    onValueChange: (value: string) => void;
  }) => (
    <label>
      {name}
      <input aria-label={name} value={String(value)} onChange={(event) => onValueChange(event.target.value)} />
    </label>
  ),
}));

import { useC64Categories, useC64Category } from "@/hooks/useC64Connection";

const createPlaylistItem = (overrides: Partial<PlaylistItem> = {}): PlaylistItem => ({
  id: "item-1",
  request: {
    source: "ultimate",
    path: "/PROGRAMS/demo.prg",
  },
  category: "prg",
  label: "demo.prg",
  path: "/PROGRAMS/demo.prg",
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
  ...overrides,
});

describe("PlaybackConfigOverrideEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useC64Categories).mockReturnValue({ data: { categories: ["Audio Mixer"] } } as any);
    vi.mocked(useC64Category).mockReturnValue({
      data: {
        "Audio Mixer": {
          items: {
            "Vol Socket 1": { selected: "0 dB", options: ["OFF", "0 dB", "6 dB"] },
          },
        },
      },
      isLoading: false,
    } as any);
  });

  it("updates an existing override", () => {
    const onChangeOverrides = vi.fn();
    render(
      <PlaybackConfigOverrideEditor
        item={createPlaylistItem({
          configOverrides: [{ category: "Audio Mixer", item: "Vol Socket 1", value: "6 dB" }],
        })}
        onChangeOverrides={onChangeOverrides}
      />,
    );

    fireEvent.change(screen.getByLabelText("Vol Socket 1"), { target: { value: "OFF" } });
    fireEvent.click(screen.getByRole("button", { name: "Update override" }));

    expect(onChangeOverrides).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }), [
      { category: "Audio Mixer", item: "Vol Socket 1", value: "OFF" },
    ]);
  });

  it("adds a new override from the selected config item", () => {
    const onChangeOverrides = vi.fn();
    render(<PlaybackConfigOverrideEditor item={createPlaylistItem()} onChangeOverrides={onChangeOverrides} />);

    fireEvent.change(screen.getByLabelText("Vol Socket 1"), { target: { value: "6 dB" } });
    fireEvent.click(screen.getByRole("button", { name: "Add override" }));

    expect(onChangeOverrides).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }), [
      { category: "Audio Mixer", item: "Vol Socket 1", value: "6 dB" },
    ]);
  });
});
