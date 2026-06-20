import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SavedDeviceEditorFields } from "@/components/devices/SavedDeviceEditorFields";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { resetInputModality } from "@/lib/input";
import type { SavedDeviceEditorDraft } from "@/lib/savedDevices/deviceEditor";

const INITIAL: SavedDeviceEditorDraft = {
  name: "",
  nameSource: "INFERRED",
  host: "",
  type: "",
  typeSource: "INFERRED",
  httpPort: "80",
  ftpPort: "21",
  telnetPort: "64",
};

// A controlled harness so composed values flow back into the field, exactly
// like the real Settings/connection editors. `keypadInput` mirrors the gate the
// real call sites derive from the `keypad_input_enabled` feature flag.
function Harness({ keypadInput = true }: { keypadInput?: boolean }) {
  const [draft, setDraft] = useState<SavedDeviceEditorDraft>(INITIAL);
  return (
    <div>
      <SavedDeviceEditorFields draft={draft} onChange={setDraft} idPrefix="t9" keypadInput={keypadInput} />
      <output data-testid="host-value">{draft.host}</output>
      <output data-testid="name-value">{draft.name}</output>
    </div>
  );
}

describe("SavedDeviceEditorFields — physical T9 / keypad entry", () => {
  afterEach(() => {
    resetInputModality();
  });

  it("enters an IPv4 address into the host field with no on-screen keyboard", () => {
    render(<Harness />);
    const host = screen.getByTestId("t9-host");

    const digit = (d: number) => fireEvent.keyDown(host, { code: `Digit${d}`, key: String(d) });
    const dot = () => fireEvent.keyDown(host, { key: "*", code: "NumpadMultiply" });

    [1, 9, 2].forEach(digit);
    dot();
    [1, 6, 8].forEach(digit);
    dot();
    digit(1);
    dot();
    [1, 3].forEach(digit);

    expect(screen.getByTestId("host-value").textContent).toBe("192.168.1.13");
  });

  it("enters digits into the host field via keypad even though it is a plain input", () => {
    render(<Harness />);
    const host = screen.getByTestId("t9-host");
    [1, 0, 8, 0].forEach((d) => fireEvent.keyDown(host, { code: `Digit${d}`, key: String(d) }));
    expect(screen.getByTestId("host-value").textContent).toBe("1080");
  });

  it("multi-tap cycles candidates in the device name field", () => {
    render(<Harness />);
    const name = screen.getByLabelText(/device name/i);
    // Two quick presses of "2" cycle a -> b in multi-tap mode.
    fireEvent.keyDown(name, { code: "Digit2", key: "2" });
    expect(screen.getByTestId("name-value").textContent).toBe("a");
    fireEvent.keyDown(name, { code: "Digit2", key: "2" });
    expect(screen.getByTestId("name-value").textContent).toBe("b");
  });

  it("shows the T9 mode indicator only after keypad composition enters key-navigation modality", () => {
    render(<Harness />);
    const host = screen.getByTestId("t9-host");

    fireEvent.focus(host);
    expect(screen.queryByTestId("t9-host-t9-mode")).not.toBeInTheDocument();

    fireEvent.keyDown(host, { code: "Digit1", key: "1" });
    expect(screen.getByTestId("t9-host-t9-mode")).toHaveTextContent("T9 Hostname · #");

    fireEvent.keyDown(host, { code: "Backquote", key: "#" });
    expect(screen.getByTestId("t9-host-t9-mode")).toHaveTextContent("T9 Multitap · #");

    fireEvent.blur(host);
    expect(screen.queryByTestId("t9-host-t9-mode")).not.toBeInTheDocument();
  });

  it("does not show the T9 mode indicator when keypad input is disabled", () => {
    render(<Harness keypadInput={false} />);
    const host = screen.getByTestId("t9-host");

    fireEvent.focus(host);
    fireEvent.keyDown(host, { code: "Digit1", key: "1" });

    expect(screen.queryByTestId("t9-host-t9-mode")).not.toBeInTheDocument();
  });

  it("does not intercept keys when keypad input is disabled (the MVP default)", () => {
    // With the composer off, keydown is a no-op: it never composes a multi-tap
    // letter and never flips composer mode. (Native typing/`onChange` still
    // inserts literal digits via the on-screen / hardware keyboard.)
    render(<Harness keypadInput={false} />);
    const name = screen.getByLabelText(/device name/i);
    fireEvent.keyDown(name, { code: "Digit2", key: "2" });
    fireEvent.keyDown(name, { code: "Digit2", key: "2" });
    expect(screen.getByTestId("name-value").textContent).toBe("");

    const host = screen.getByTestId("t9-host");
    fireEvent.keyDown(host, { key: "#", code: "Backquote" });
    fireEvent.keyDown(host, { code: "Digit5", key: "5" });
    expect(screen.getByTestId("host-value").textContent).toBe("");
  });

  it("registers field rows so Enter focuses the input and Escape returns to the ring", () => {
    render(
      <FocusNavigationProvider enabled>
        <Harness keypadInput={false} />
      </FocusNavigationProvider>,
    );

    const hostRow = screen.getByTestId("t9-host-field");
    const host = screen.getByTestId("t9-host");

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(hostRow).toHaveAttribute("data-key-selected", "true");
    expect(document.activeElement).toBe(hostRow);

    fireEvent.keyDown(document.body, { code: "Enter" });
    expect(document.activeElement).toBe(host);

    fireEvent.keyDown(host, { key: "Escape" });
    expect(document.activeElement).toBe(hostRow);
    expect(hostRow).toHaveAttribute("data-key-selected", "true");
  });
});
