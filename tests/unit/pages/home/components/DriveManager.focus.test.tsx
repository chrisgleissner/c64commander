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

const baseProps = {
  handleAction: vi.fn().mockImplementation((fn: () => Promise<void>) => fn()),
  machineTaskBusy: false,
  machineTaskId: null as string | null,
  onResetDrives: onResetDrivesSpy,
  // C64U Remote prunes the telnet drive actions, so they are absent from the ring.
  telnetAvailable: false,
};

const renderInRing = (overrides: Partial<typeof baseProps> & { isConnected?: boolean } = {}) => {
  const { isConnected = true, ...rest } = overrides;
  return render(
    <FocusNavigationProvider profileId="keypad">
      <DriveManager isConnected={isConnected} {...baseProps} {...rest} />
    </FocusNavigationProvider>,
  );
};

describe("DriveManager keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("traverses Reset Drives → each drive toggle top-to-bottom in focusOrder", () => {
    renderInRing();

    // Selection starts on the first registered enabled CTA (Reset Drives, 300);
    // stepping down walks the drive toggles 310 (A) → 320 (B) → 330 (Soft IEC).
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-drive-toggle-a"));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-drive-toggle-b"));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-drive-toggle-soft-iec"));

    // One more step wraps back to the section's first CTA, proving Reset sorts top.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("home-drives-reset"));
  });

  it("center-activates the focused Reset Drives without firing a drive toggle", () => {
    renderInRing();

    // Initial selection is Reset Drives; center fires it directly (no move).
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(onResetDrivesSpy).toHaveBeenCalledTimes(1);
    expect(updateConfigValueSpy).not.toHaveBeenCalled();
  });

  it("center-activates a focused drive toggle without firing the section reset", () => {
    renderInRing();

    fireEvent.keyDown(document.body, { code: "DpadDown" }); // → drive A toggle
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
