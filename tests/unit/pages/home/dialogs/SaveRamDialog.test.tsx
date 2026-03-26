/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SaveRamDialog } from "@/pages/home/dialogs/SaveRamDialog";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

const renderDialog = (isSaving = false) => {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(<SaveRamDialog open={true} onOpenChange={onOpenChange} onSave={onSave} isSaving={isSaving} />);
  return { ...view, onSave, onOpenChange };
};

const renderDialogWithTelnet = (opts: { telnetAvailable?: boolean; telnetBusy?: boolean } = {}) => {
  const onSave = vi.fn();
  const onSaveReu = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  const view = render(
    <SaveRamDialog
      open={true}
      onOpenChange={onOpenChange}
      onSave={onSave}
      isSaving={false}
      onSaveReu={onSaveReu}
      telnetAvailable={opts.telnetAvailable ?? true}
      telnetBusy={opts.telnetBusy ?? false}
    />,
  );
  return { ...view, onSave, onSaveReu, onOpenChange };
};

const goToCustomForm = () => {
  const handles = renderDialog();
  fireEvent.click(screen.getByTestId("save-ram-type-custom"));
  return handles;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SaveRamDialog – type list", () => {
  it("renders the type list when open", () => {
    renderDialog();
    expect(screen.getByTestId("save-ram-type-list")).toBeInTheDocument();
  });

  it("calls onSave with 'program' when Program button is clicked", () => {
    const { onSave, onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("save-ram-type-program"));
    expect(onSave).toHaveBeenCalledWith("program");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onSave with 'basic' when Basic button is clicked", () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByTestId("save-ram-type-basic"));
    expect(onSave).toHaveBeenCalledWith("basic");
  });

  it("calls onSave with 'screen' when Screen button is clicked", () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByTestId("save-ram-type-screen"));
    expect(onSave).toHaveBeenCalledWith("screen");
  });

  it("shows custom form when Custom button is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("save-ram-type-custom"));
    expect(screen.getByTestId("save-ram-custom-form")).toBeInTheDocument();
    expect(screen.queryByTestId("save-ram-type-list")).not.toBeInTheDocument();
  });

  it("cancel button calls onOpenChange(false)", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("type buttons are disabled when isSaving=true", () => {
    renderDialog(true);
    expect(screen.getByTestId("save-ram-type-program")).toBeDisabled();
  });
});

describe("SaveRamDialog – custom form", () => {
  it("adds and deletes custom ranges", () => {
    goToCustomForm();

    fireEvent.click(screen.getByTestId("save-ram-custom-add-range"));
    expect(screen.getByTestId("save-ram-custom-start-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("save-ram-custom-delete-range-1"));
    expect(screen.queryByTestId("save-ram-custom-start-1")).not.toBeInTheDocument();
  });

  it("sanitizes input to uppercase hex without a typed $ prefix", () => {
    goToCustomForm();

    const startInput = screen.getByTestId("save-ram-custom-start") as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "$0aZf1!" } });

    expect(startInput.value).toBe("0AF1");
  });

  it("shows toast and does not call onSave for incomplete addresses", () => {
    const { onSave } = goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "0400" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-confirm"));

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Invalid address",
        description: "Range 1 must use 1-4 hex digits.",
      }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows toast when end address < start address", () => {
    const { onSave } = goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "0800" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end"), { target: { value: "0400" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-confirm"));

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Invalid range",
        description: "Range 1 end address must be ≥ start address.",
      }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows toast when custom ranges overlap", () => {
    const { onSave } = goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "0400" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end"), { target: { value: "07E7" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-add-range"));
    fireEvent.change(screen.getByTestId("save-ram-custom-start-1"), { target: { value: "0700" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end-1"), { target: { value: "0800" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-confirm"));

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Overlapping ranges",
        description: "Custom ranges must not overlap.",
      }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with multiple custom ranges for valid addresses", () => {
    const { onSave } = goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "0400" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end"), { target: { value: "07E7" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-add-range"));
    fireEvent.change(screen.getByTestId("save-ram-custom-start-1"), { target: { value: "2000" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end-1"), { target: { value: "20FF" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-confirm"));

    expect(onSave).toHaveBeenCalledWith("custom", [
      { start: 0x0400, length: 0x07e7 - 0x0400 + 1 },
      { start: 0x2000, length: 0x20ff - 0x2000 + 1 },
    ]);
  });

  it("preserves custom ranges across remounts", () => {
    const initial = goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "c000" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end"), { target: { value: "cfff" } });
    fireEvent.click(screen.getByTestId("save-ram-custom-add-range"));
    fireEvent.change(screen.getByTestId("save-ram-custom-start-1"), { target: { value: "d800" } });
    fireEvent.change(screen.getByTestId("save-ram-custom-end-1"), { target: { value: "dbff" } });

    initial.unmount();

    goToCustomForm();

    expect((screen.getByTestId("save-ram-custom-start") as HTMLInputElement).value).toBe("C000");
    expect((screen.getByTestId("save-ram-custom-end") as HTMLInputElement).value).toBe("CFFF");
    expect((screen.getByTestId("save-ram-custom-start-1") as HTMLInputElement).value).toBe("D800");
    expect((screen.getByTestId("save-ram-custom-end-1") as HTMLInputElement).value).toBe("DBFF");
  });

  it("back button returns to the type list without clearing drafts", () => {
    goToCustomForm();

    fireEvent.change(screen.getByTestId("save-ram-custom-start"), { target: { value: "0400" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByTestId("save-ram-type-custom"));

    expect((screen.getByTestId("save-ram-custom-start") as HTMLInputElement).value).toBe("0400");
  });
});

describe("SaveRamDialog – Save REU", () => {
  it("shows Save REU button when telnetAvailable", () => {
    renderDialogWithTelnet({ telnetAvailable: true });
    expect(screen.getByTestId("save-ram-type-reu")).toBeInTheDocument();
  });

  it("hides Save REU button when no handler is provided", () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SaveRamDialog open={true} onOpenChange={onOpenChange} onSave={onSave} isSaving={false} telnetAvailable={true} />,
    );
    expect(screen.queryByTestId("save-ram-type-reu")).not.toBeInTheDocument();
  });

  it("hides Save REU button when telnetAvailable is false", () => {
    renderDialogWithTelnet({ telnetAvailable: false });
    expect(screen.queryByTestId("save-ram-type-reu")).not.toBeInTheDocument();
  });

  it("calls onSaveReu when Save REU is clicked", () => {
    const { onSaveReu } = renderDialogWithTelnet();
    fireEvent.click(screen.getByTestId("save-ram-type-reu"));
    expect(onSaveReu).toHaveBeenCalledTimes(1);
  });

  it("disables Save REU when telnetBusy", () => {
    renderDialogWithTelnet({ telnetBusy: true });
    expect(screen.getByTestId("save-ram-type-reu")).toBeDisabled();
  });
});
