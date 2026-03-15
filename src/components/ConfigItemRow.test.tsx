import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConfigItemRow } from "@/components/ConfigItemRow";

let mockProfile: "compact" | "medium" | "expanded" = "medium";

vi.mock("@/hooks/useC64Connection", () => ({
  useC64ConfigItem: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: mockProfile }),
}));

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
});
