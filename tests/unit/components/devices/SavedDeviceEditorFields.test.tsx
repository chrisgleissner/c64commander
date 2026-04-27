import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";
import { buildSavedDeviceEditorDraft } from "@/lib/savedDevices/deviceEditor";

describe("SavedDeviceEditorFields", () => {
  it("treats a legacy saved name that differs from the host as user-authored", () => {
    expect(
      buildSavedDeviceEditorDraft({
        name: "Office U64",
        host: "c64u",
        httpPort: 80,
        ftpPort: 21,
        telnetPort: 64,
      }),
    ).toMatchObject({
      name: "Office U64",
      nameSource: "USER",
      host: "c64u",
    });
  });

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

  it("shows a subtle auto badge while the name is inferred from the host", () => {
    render(
      <SavedDeviceEditorFields
        draft={{
          name: "c64u",
          nameSource: "INFERRED",
          host: "c64u",
          type: "",
          typeSource: "INFERRED",
          httpPort: "80",
          ftpPort: "21",
          telnetPort: "64",
        }}
        onChange={vi.fn()}
        idPrefix="saved-device"
      />,
    );

    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText(/clear to follow the host/i)).toBeInTheDocument();
  });
});
