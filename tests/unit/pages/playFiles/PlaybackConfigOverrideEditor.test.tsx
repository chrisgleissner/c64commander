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

// Built fresh on every call so a test can hand the component a response that
// holds exactly the same values under new object references, which is what a
// background config read does.
const buildCategoryPayload = () => ({
  "Audio Mixer": {
    items: {
      "Vol Socket 1": { selected: "0 dB", options: ["OFF", "0 dB", "6 dB"] },
    },
  },
});

describe("PlaybackConfigOverrideEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useC64Categories).mockReturnValue({ data: { categories: ["Audio Mixer"] } } as any);
    vi.mocked(useC64Category).mockReturnValue({
      data: buildCategoryPayload(),
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

  it("keeps a typed value when a config read returns the same values under new references", () => {
    const onChangeOverrides = vi.fn();
    const item = createPlaylistItem();
    const { rerender } = render(<PlaybackConfigOverrideEditor item={item} onChangeOverrides={onChangeOverrides} />);

    fireEvent.change(screen.getByLabelText("Vol Socket 1"), { target: { value: "6 dB" } });
    expect(screen.getByLabelText("Vol Socket 1")).toHaveValue("6 dB");

    // A config read for this category lands while the user is still editing the
    // value. Nothing the user can see has changed, but the response is a new
    // object, so the memoised selected item takes a fresh identity. The editor
    // must not treat that as a reason to re-seed the value field.
    vi.mocked(useC64Category).mockReturnValue({ data: buildCategoryPayload(), isLoading: false } as any);
    rerender(<PlaybackConfigOverrideEditor item={item} onChangeOverrides={onChangeOverrides} />);

    expect(screen.getByLabelText("Vol Socket 1")).toHaveValue("6 dB");

    fireEvent.click(screen.getByRole("button", { name: "Add override" }));
    expect(onChangeOverrides).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }), [
      { category: "Audio Mixer", item: "Vol Socket 1", value: "6 dB" },
    ]);
  });

  it("keeps a typed value when the playlist item is replaced by an equal copy", () => {
    const onChangeOverrides = vi.fn();
    const configOverrides = [{ category: "Audio Mixer", item: "Vol Socket 1", value: "6 dB" }];
    const { rerender } = render(
      <PlaybackConfigOverrideEditor
        item={createPlaylistItem({ configOverrides })}
        onChangeOverrides={onChangeOverrides}
      />,
    );

    fireEvent.change(screen.getByLabelText("Vol Socket 1"), { target: { value: "OFF" } });
    expect(screen.getByLabelText("Vol Socket 1")).toHaveValue("OFF");

    // The playlist re-renders with a structurally identical item, so
    // `item.configOverrides` and the override object inside it are both new
    // references carrying the stored value "6 dB".
    rerender(
      <PlaybackConfigOverrideEditor
        item={createPlaylistItem({
          configOverrides: configOverrides.map((override) => ({ ...override })),
        })}
        onChangeOverrides={onChangeOverrides}
      />,
    );

    expect(screen.getByLabelText("Vol Socket 1")).toHaveValue("OFF");
  });
});
