import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConfigItemRow } from "@/components/ConfigItemRow";

let mockProfile: "compact" | "medium" | "expanded" = "medium";

vi.mock("@/components/ui/slider", () => ({
  Slider: ({ value, onValueChange, onValueCommit, ...props }: any) => (
    <input
      type="range"
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
      min={props.min}
      max={props.max}
      value={value[0] ?? 0}
      onChange={(event) => onValueChange?.([Number((event.target as HTMLInputElement).value)])}
      onMouseUp={(event) => onValueCommit?.([Number((event.target as HTMLInputElement).value)])}
    />
  ),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64ConfigItem: () => ({ data: undefined, isLoading: false }),
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: mockProfile }),
}));

vi.mock("@/hooks/useDeviceBoundSlider", async () => {
  const React = await import("react");

  return {
    createIndexedSliderDomain: (options: string[]) => ({ options }),
    useDeviceBoundSlider: ({ deviceValue, domain, onDraftChange, preview, commit }: any) => {
      const options: string[] = domain.options ?? [];
      const resolveValue = (index: number) => options[Math.round(index)] ?? String(index);
      const [displayValue, setDisplayValue] = React.useState(deviceValue);

      return {
        displayValue,
        sliderValue: Math.max(0, options.indexOf(displayValue)),
        onValueChange: ([index]: number[]) => {
          const nextValue = resolveValue(index);
          setDisplayValue(nextValue);
          onDraftChange?.(nextValue);
          return preview?.(nextValue);
        },
        onValueCommit: ([index]: number[]) => {
          const nextValue = resolveValue(index);
          setDisplayValue(nextValue);
          onDraftChange?.(nextValue);
          // Mirror the real hook's commit-time guard: a committed value that
          // already equals the AUTHORITATIVE `deviceValue` is a no-op write. If
          // ConfigItemRow feeds the optimistic draft in as `deviceValue`, this
          // guard silently swallows every commit (the BUG this asserts against).
          if (String(nextValue) === String(deviceValue)) return undefined;
          return commit?.(nextValue);
        },
      };
    },
  };
});

describe("ConfigItemRow text input buffering", () => {
  it("keeps focus while typing and commits once on blur", () => {
    const onValueChange = vi.fn();

    render(<ConfigItemRow category="Clock Settings" name="Clock Year" value="2025" onValueChange={onValueChange} />);

    const input = screen.getByLabelText("Clock Year text input");
    act(() => {
      input.focus();
    });

    fireEvent.change(input, { target: { value: "2" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "20" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "202" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "2026" } });
    expect(document.activeElement).toBe(input);

    expect(onValueChange).toHaveBeenCalledTimes(0);

    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("2026");
  });

  it("does not overwrite active local buffer from external value updates", () => {
    const onValueChange = vi.fn();

    const { rerender } = render(
      <ConfigItemRow category="Clock Settings" name="Clock Year" value="2025" onValueChange={onValueChange} />,
    );

    const input = screen.getByLabelText("Clock Year text input") as HTMLInputElement;
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: "202" } });

    rerender(<ConfigItemRow category="Clock Settings" name="Clock Year" value="1999" onValueChange={onValueChange} />);

    expect((screen.getByLabelText("Clock Year text input") as HTMLInputElement).value).toBe("202");
    fireEvent.blur(screen.getByLabelText("Clock Year text input"));
    expect(onValueChange).toHaveBeenCalledWith("202");
  });

  it("commits on Enter without per-character dispatch", () => {
    const onValueChange = vi.fn();

    render(<ConfigItemRow category="Clock Settings" name="Clock Year" value="2025" onValueChange={onValueChange} />);

    const input = screen.getByLabelText("Clock Year text input");
    act(() => {
      input.focus();
    });
    fireEvent.change(input, { target: { value: "2026" } });
    expect(onValueChange).toHaveBeenCalledTimes(0);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("2026");
  });

  it("forces vertical layout on compact displays", () => {
    mockProfile = "compact";
    const onValueChange = vi.fn();

    render(<ConfigItemRow category="Clock Settings" name="Clock Year" value="2025" onValueChange={onValueChange} />);

    expect(screen.getByTestId("config-item-layout")).toHaveAttribute("data-layout", "vertical");
    mockProfile = "medium";
  });

  it("writes only once on commit for a rapid slider drag and never mid-drag (BUG-026)", async () => {
    const pending: Array<() => void> = [];
    const onValueChange = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));

    render(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol UltiSid 1"
        value="10"
        options={Array.from({ length: 21 }, (_, index) => String(index))}
        onValueChange={onValueChange}
        sliderTestId="volume-slider"
      />,
    );

    const slider = screen.getByLabelText("Vol UltiSid 1 slider");

    for (let index = 1; index <= 20; index += 1) {
      fireEvent.change(slider, { target: { value: String(index) } });
    }

    // Config sliders are commit-only: a drag must emit ZERO device writes while
    // moving (no mid-drag /v1/configs flash-commit flood), but the label tracks
    // the drag locally via onDraftChange.
    expect(onValueChange).toHaveBeenCalledTimes(0);
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();

    fireEvent.mouseUp(slider, { target: { value: "20" } });

    await act(async () => {
      await Promise.resolve();
    });

    // Exactly one write — the committed/released value.
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("20");

    pending.shift()?.();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still a single write after the commit settles — no trailing/coalesced second write.
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
  });

  it("still writes on commit even though onDraftChange has mirrored the value locally (commitOnly regression)", async () => {
    // Regression for the commitOnly slider write being silently dropped: the row
    // passed its optimistic `displayValue` (which onDraftChange keeps in lock-step
    // with the live drag) into the slider hook as `deviceValue`. By commit time the
    // hook believed the device already held the dragged value, so its
    // `equals(deviceValue, nextValue)` guard skipped the actual device write — the
    // throttled-mode preview write had been hiding this. The fix feeds the
    // AUTHORITATIVE device value (mergedValue) as deviceValue instead.
    const onValueChange = vi.fn(() => Promise.resolve());

    render(
      <ConfigItemRow
        category="Audio Mixer"
        name="Vol UltiSid 1"
        value="0"
        options={Array.from({ length: 21 }, (_, index) => String(index))}
        onValueChange={onValueChange}
        sliderTestId="volume-slider"
      />,
    );

    const slider = screen.getByLabelText("Vol UltiSid 1 slider");

    // A single tap-to-max: onValueChange fires onDraftChange (mirroring "20" into
    // the row's local display) and the commit lands at the same value.
    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.mouseUp(slider, { target: { value: "20" } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("20");
  });
});
