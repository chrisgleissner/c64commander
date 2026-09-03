/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { resetCardMemory } from "../../../helpers/cards";
import { enterKeyNavigationModality, leaveKeyNavigationModality } from "../../../../helpers/keypadModality";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";

// This suite uses the REAL DriveCard + SectionHeader + Button so the keypad focus
// ring (focusId / focusOrder) is exercised end-to-end. Only the data hooks and
// heavy dialogs/selects are stubbed; the registered CTAs are the genuine ones.
const { updateConfigValueSpy, resolveConfigValueSpy, onResetDrivesSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
  onResetDrivesSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ mountDrive: vi.fn().mockResolvedValue({}), mountDriveUpload: vi.fn().mockResolvedValue({}) }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

vi.mock("@/pages/home/hooks/useDriveData", () => ({
  useDriveData: () => ({
    refetchDrives: vi.fn().mockResolvedValue(undefined),
    driveASettingsCategory: undefined,
    driveBSettingsCategory: undefined,
    softIecConfig: undefined,
    driveSummaryItems: [],
    drivesByClass: new Map(),
  }),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => 0,
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64ConfigItems: () => ({ data: undefined }),
  useC64Drives: () => ({ data: { drives: [] }, refetch: vi.fn().mockResolvedValue(undefined) }),
  useC64Connection: () => ({ status: { deviceInfo: { product: "Ultimate 64" } } }),
}));

vi.mock("@/hooks/useLocalSources", () => ({
  useLocalSources: () => ({ sources: [], addSourceFromPicker: vi.fn().mockResolvedValue(null) }),
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: "medium" }),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  createUltimateSourceLocation: () => ({ id: "ultimate", type: "ultimate", name: "C64U" }),
}));

vi.mock("@/lib/sourceNavigation/localSourceAdapter", () => ({
  createLocalSourceLocation: (source: any) => ({ id: source.id, type: "local", name: source.name }),
  resolveLocalRuntimeFile: vi.fn(() => null),
}));

vi.mock("@/lib/sourceNavigation/sourceTerms", () => ({
  SOURCE_LABELS: { c64u: "C64 Ultimate", local: "Local" },
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

// Selects are not part of the focus ring (they're d-pad-operated under M2.5), so a
// lightweight stub keeps the harness free of radix portal/pointer machinery.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));

import { DriveManager } from "@/pages/home/components/DriveManager";

// HARD27-039: modality is a module-level singleton shared by every test here.
afterEach(() => leaveKeyNavigationModality());

const baseProps = {
  handleAction: vi.fn().mockImplementation((fn: () => Promise<void>) => fn()),
  machineTaskBusy: false,
  machineTaskId: null as string | null,
  onResetDrives: onResetDrivesSpy,
  // C64U Remote prunes the telnet drive actions, so they are absent from the ring.
  telnetAvailable: false,
};

const FocusContextCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

const renderInRing = (
  overrides: Partial<typeof baseProps> & { isConnected?: boolean } = {},
  focusContext?: { current: FocusNavigationContextValue | null },
) => {
  const { isConnected = true, ...rest } = overrides;
  // HARD27-039: a keypad user arrives here by key, so the discovery engine is
  // already running when the component mounts. These tests read the ring without
  // pressing a key first.
  enterKeyNavigationModality();
  return render(
    <FocusNavigationProvider profileId="keypad">
      {focusContext ? <FocusContextCapture target={focusContext} /> : null}
      <DriveManager isConnected={isConnected} {...baseProps} {...rest} />
    </FocusNavigationProvider>,
  );
};

describe("DriveManager keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    resetCardMemory();
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("keeps Reset Drives and each drive toggle DOM-backed and reachable", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderInRing({}, focusContext);

    // The discovered ring may include selects between these controls; the audit
    // contract is that the primary CTAs are present and reachable from d-pad.
    expect(focusContext.current?.engine.sourceForId("home-drives-reset")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-drive-toggle-a")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-drive-toggle-b")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-drive-toggle-soft-iec")).toBe("dom+explicit");

    const enabledIds = new Set(
      focusContext.current?.controller.focus
        .list()
        .filter((item) => !item.disabled)
        .map((item) => item.id),
    );
    expect(enabledIds.has("home-drives-reset")).toBe(true);
    expect(enabledIds.has("home-drive-toggle-a")).toBe(true);
    expect(enabledIds.has("home-drive-toggle-b")).toBe(true);
    expect(enabledIds.has("home-drive-toggle-soft-iec")).toBe(true);
  });

  it("center-activates the focused Reset Drives without firing a drive toggle", () => {
    renderInRing();

    // Drives is itself collapsible now, so its own toggle is the ring's first stop. OK
    // establishes focus there without activating (the section is already open); a step
    // down reaches Reset Drives.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByTestId("home-section-toggle-drives"));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-drives-reset"));
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onResetDrivesSpy).toHaveBeenCalledTimes(1);
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("center-activates a focused drive toggle without firing the section reset", () => {
    renderInRing();

    // Walk to drive A's ON/OFF rather than counting presses: each drive is a collapsible card
    // now, so the ring passes its header too, and a fixed count only records how many items
    // happened to precede the toggle on the day it was written.
    fireEvent.keyDown(document.body, { code: "DpadCenter" }); // enter the ring
    const toggle = screen.getByTestId("home-drive-toggle-a");
    for (let step = 0; step < 24 && document.activeElement !== toggle; step++) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      if (document.activeElement?.getAttribute("data-section-label")) {
        // A card is a focus scope: go into it to reach the controls it holds.
        fireEvent.keyDown(document.body, { code: "DpadCenter" });
      }
    }
    expect(toggle).toHaveFocus();
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "HOME_DRIVE_ENABLED",
      expect.anything(),
      expect.anything(),
    );
    expect(onResetDrivesSpy).not.toHaveBeenCalled();
  });

  it("skips every drive CTA while disconnected so nothing can be activated by keypad", () => {
    renderInRing({ isConnected: false });

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    expect(onResetDrivesSpy).not.toHaveBeenCalled();
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });
});
