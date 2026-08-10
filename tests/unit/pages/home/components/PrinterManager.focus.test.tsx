/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";

// Uses the REAL SectionHeader + Button so the keypad focus ring (focusId /
// focusOrder) is exercised: only the data hooks and the d-pad-operated selects
// (M2.5) are stubbed.
//
// Printers now starts closed, so these tests open it mid-test rather than on mount.
// Real framer-motion animates that reveal from height:0/opacity:0, and jsdom applies
// those inline styles synchronously without ever progressing the animation (no rAF
// ticks run in this environment) - so the newly revealed content stayed effectively
// invisible for the rest of the test, and the enable toggle inside it was never
// reachable. Mocking framer-motion here, the same way MachineControls.focus.test.tsx
// already does, renders the content as plain elements with no transition to get stuck in.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

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

// The ring's DOM discovery coalesces mutations into a single microtask rescan
// (FocusDiscoveryEngine.scheduleRefresh, queueMicrotask) rather than rescanning
// synchronously. `fireEvent` flushes React's own effects via `act`, but does not by
// itself let a *microtask* queued from inside those effects run before the next
// `fireEvent` call reads the ring. Opening Printers mounts the enable toggle for the
// first time and queues exactly that rescan, so the tests below flush one microtask
// turn after opening before continuing - otherwise the toggle stays undiscovered and
// navigation silently wraps between the two elements that were already known.
const flushFocusDiscovery = () => act(() => Promise.resolve());

describe("PrinterManager keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("traverses Reset Printer → the ON/OFF toggle top-to-bottom in focusOrder", async () => {
    renderInRing();

    // Printers starts closed, so the ring's first stop is the section's own toggle - not
    // yet Reset, which is not in the DOM until the section is opened. The first Center
    // establishes focus there without activating it; a second Center is what opens it.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByTestId("home-section-toggle-printers"));
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await flushFocusDiscovery();

    // One step down reaches Reset, now that opening the section put it in the DOM.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-printer-reset"));

    // One more step down reaches the enable toggle.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-printer-toggle"));

    // Another step wraps back to the section's own toggle, which is the ring's first
    // stop now that it is a member too - confirming the three items cycle as a whole.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-section-toggle-printers"));
  });

  it("center-activates the focused Reset Printer without toggling the printer", async () => {
    renderInRing();

    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // enter ring → section toggle
    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // activates it, opening the section
    await flushFocusDiscovery();
    fireEvent.keyDown(document.body, { code: "DpadDown" }); // → reset
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onResetPrinterSpy).toHaveBeenCalledTimes(1);
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("center-activates the focused ON/OFF toggle without firing the section reset", async () => {
    renderInRing();

    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // enter ring → section toggle
    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // activates it, opening the section
    await flushFocusDiscovery();
    fireEvent.keyDown(document.body, { code: "DpadDown" }); // → reset
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
