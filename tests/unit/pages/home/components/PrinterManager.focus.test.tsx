/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";

// Uses the REAL SectionHeader + Button so the keypad focus ring (focusId /
// focusOrder) is exercised: only the data hooks and the d-pad-operated selects
// (M2.5) are stubbed.
const { updateConfigValueSpy, resolveConfigValueSpy, onResetPrinterSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
  onResetPrinterSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

vi.mock("@/pages/home/hooks/usePrinterData", () => ({
  usePrinterData: () => ({
    refetchDrives: vi.fn().mockResolvedValue(undefined),
    printerConfig: undefined,
    printerDevice: { enabled: true, busId: 4 },
  }),
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: "medium" }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));

import { PrinterManager } from "@/pages/home/components/PrinterManager";

const baseProps = {
  machineTaskBusy: false,
  machineTaskId: null as string | null,
  onResetPrinter: onResetPrinterSpy,
};

const renderInRing = (overrides: { isConnected?: boolean } = {}) => {
  const { isConnected = true } = overrides;
  return render(
    <FocusNavigationProvider profileId="keypad">
      <PrinterManager isConnected={isConnected} {...baseProps} />
    </FocusNavigationProvider>,
  );
};

describe("PrinterManager keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("traverses Reset Printer → the ON/OFF toggle top-to-bottom in focusOrder", () => {
    renderInRing();

    // The labelled Printers section is selected first; OK descends to Reset.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByTestId("home-printer-reset"));

    // One step down reaches the enable toggle.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-printer-toggle"));

    // Another step wraps back to Reset Printer, confirming only the two CTAs cycle.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-printer-reset"));
  });

  it("center-activates the focused Reset Printer without toggling the printer", () => {
    renderInRing();

    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // enter Printers group → reset
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onResetPrinterSpy).toHaveBeenCalledTimes(1);
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("center-activates the focused ON/OFF toggle without firing the section reset", () => {
    renderInRing();

    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // enter Printers group → reset
    fireEvent.keyDown(document.body, { code: "DpadDown" }); // → printer toggle
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "HOME_DRIVE_ENABLED",
      expect.anything(),
      expect.anything(),
    );
    expect(onResetPrinterSpy).not.toHaveBeenCalled();
  });

  it("skips both printer CTAs while disconnected so nothing can be activated by keypad", () => {
    renderInRing({ isConnected: false });

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    expect(onResetPrinterSpy).not.toHaveBeenCalled();
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });
});
