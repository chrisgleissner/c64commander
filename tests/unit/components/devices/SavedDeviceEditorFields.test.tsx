import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";

describe("SavedDeviceEditorFields", () => {
  it("caps device names at 10 characters while editing", () => {
    const onChange = vi.fn();

    render(
      <SavedDeviceEditorFields
        draft={{
          name: "",
          nameSource: "INFERRED",
          host: "c64u",
          type: "",
          typeSource: "INFERRED",
          httpPort: "80",
          ftpPort: "21",
          telnetPort: "64",
        }}
        onChange={onChange}
        idPrefix="saved-device"
      />,
    );

    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "Ultimate FE 64" } });

    expect(onChange).toHaveBeenCalledWith({
      name: "Ultimate F",
      nameSource: "USER",
      host: "c64u",
      type: "",
      typeSource: "INFERRED",
      httpPort: "80",
      ftpPort: "21",
      telnetPort: "64",
    });
    expect(screen.getByLabelText(/device name/i)).toHaveAttribute("maxLength", "10");
  });
});
