/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openAllCards, resetCardMemory } from "../../helpers/cards";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";

vi.mock("@/components/lists/SelectableActionList", () => ({
  SelectableActionList: () => <div data-testid="mock-action-list" />,
}));
vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));
vi.mock("@/components/itemSelection/AddItemsProgressOverlay", () => ({
  AddItemsProgressOverlay: () => <div data-testid="progress-overlay" />,
}));

// Render Radix selects eagerly so each option is queryable without opening the
// portal (jsdom does not drive Radix Select pointer interactions reliably).
const SelectChange = createContext<(value: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => (
    <SelectChange.Provider value={onValueChange}>
      <div data-select-root>{children}</div>
    </SelectChange.Provider>
  ),
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const change = useContext(SelectChange);
    return (
      <button role="option" data-value={value} onClick={() => change(value)}>
        {children}
      </button>
    );
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    setQueryData: vi.fn(),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useDiskLibrary", () => ({
  useDiskLibrary: () => ({
    disks: [],
    runtimeFiles: {},
    addDisks: vi.fn(),
    updateDiskGroup: vi.fn(),
    updateDiskName: vi.fn(),
    removeDisk: vi.fn(),
    bulkRemoveDisks: vi.fn(),
  }),
}));

const useC64ConnectionMock = { status: { isConnected: true, deviceInfo: { unique_id: "test-device" } } };
const useC64DrivesMock = {
  data: {
    drives: [{ a: { bus_id: 8, enabled: true } }, { b: { bus_id: 9, enabled: true } }, { softiec: { bus_id: 11 } }],
  },
};

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => 0,
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Connection: () => useC64ConnectionMock,
  useC64Drives: () => useC64DrivesMock,
  useC64ConfigItems: (category: string) => ({
    data: category === "SoftIEC Drive Settings" ? { [category]: { items: { "Default Path": "/Usb0/" } } } : undefined,
  }),
}));

vi.mock("@/hooks/useLocalSources", () => ({
  useLocalSources: () => ({ sources: [], addSourceFromPicker: vi.fn(), addSourceFromFiles: vi.fn() }),
}));
vi.mock("@/pages/playFiles/hooks/useArchiveClientSettings", () => ({
  useArchiveClientSettings: () => ({
    commoserveEnabled: false,
    archiveConfig: { id: "a", name: "x", baseUrl: "", enabled: false },
  }),
}));
vi.mock("@/hooks/useListPreviewLimit", () => ({ useListPreviewLimit: () => ({ limit: 100 }) }));
vi.mock("@/hooks/useActionTrace", () => ({ useActionTrace: () => (fn: any) => fn }));

// getC64API deliberately exposes no config-domain methods, so
// useDeviceConfigOptionDomains resolves to EMPTY domains — the pre-discovery
// state this test exercises.
const setConfigValue = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    mountDrive: vi.fn().mockResolvedValue(undefined),
    driveCommand: vi.fn().mockResolvedValue(undefined),
    mountDriveUpload: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: () => "http://test-device",
    getDeviceHost: () => "test-device",
    unmountDrive: vi.fn().mockResolvedValue(undefined),
    setConfigValue,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/native/platform", () => ({ getPlatform: () => "web", isNativePlatform: () => false }));
vi.mock("@/lib/native/safUtils", () => ({ redactTreeUri: (v: string) => v }));

const optionIn = (triggerTestId: string, value: string) => {
  const root = screen.getByTestId(triggerTestId).closest("[data-select-root]") as HTMLElement;
  return within(root).getByRole("option", { name: new RegExp(`^#?${value}$`) });
};

describe("HomeDiskManager drive configuration changes", () => {
  beforeEach(() => {
    resetCardMemory();
    vi.clearAllMocks();
    useC64ConnectionMock.status = { isConnected: true, deviceInfo: { unique_id: "test-device" } };
  });

  it("writes the chosen bus ID to the drive's own config category", async () => {
    render(<HomeDiskManager />);
    openAllCards();

    fireEvent.click(optionIn("drive-bus-select-a", "9"));

    await waitFor(() => expect(setConfigValue).toHaveBeenCalledWith("Drive A Settings", "Drive Bus ID", 9));
  });

  it("writes the chosen drive type to the drive's own config category", async () => {
    render(<HomeDiskManager />);
    openAllCards();
    const root = screen.getByTestId("drive-type-select-b").closest("[data-select-root]") as HTMLElement;

    fireEvent.click(within(root).getAllByRole("option")[0]);

    await waitFor(() => expect(setConfigValue).toHaveBeenCalledWith("Drive B Settings", "Drive Type", "1541"));
  });

  it("writes the chosen bus ID to the Soft IEC settings", async () => {
    render(<HomeDiskManager />);
    openAllCards();
    const root = screen.getByTestId("drive-bus-select-soft-iec").closest("[data-select-root]") as HTMLElement;
    const option = within(root).getAllByRole("option")[0];

    fireEvent.click(option);

    await waitFor(() =>
      expect(setConfigValue).toHaveBeenCalledWith(
        "SoftIEC Drive Settings",
        "Soft Drive Bus ID",
        Number(option.getAttribute("data-value")),
      ),
    );
  });

  it("opens the directory browser from the Soft IEC default path button", async () => {
    render(<HomeDiskManager />);
    openAllCards();

    await act(async () => {
      fireEvent.click(screen.getByTestId("drive-default-path-select-soft-iec"));
    });

    expect(screen.getByTestId("drive-default-path-select-soft-iec")).toBeEnabled();
  });
});
