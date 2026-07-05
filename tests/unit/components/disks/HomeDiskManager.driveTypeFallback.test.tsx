/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div data-select-root>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div role="option" data-value={value}>
      {children}
    </div>
  ),
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
  data: { drives: [{ a: { bus_id: 8, enabled: true } }, { b: { bus_id: 9, enabled: true } }] },
};

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => 0,
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Connection: () => useC64ConnectionMock,
  useC64Drives: () => useC64DrivesMock,
  useC64ConfigItems: () => ({ data: undefined }),
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
vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    mountDrive: vi.fn().mockResolvedValue(undefined),
    driveCommand: vi.fn().mockResolvedValue(undefined),
    mountDriveUpload: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: () => "http://test-device",
    getDeviceHost: () => "test-device",
    unmountDrive: vi.fn().mockResolvedValue(undefined),
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

const driveTypeOptionsFor = (key: string) => {
  const root = screen.getByTestId(`drive-type-select-${key}`).closest("[data-select-root]") as HTMLElement;
  return within(root)
    .getAllByRole("option")
    .map((option) => option.getAttribute("data-value"));
};

describe("HomeDiskManager Drive Type fallback (HARD16-011)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useC64ConnectionMock.status = { isConnected: true, deviceInfo: { unique_id: "test-device" } };
  });

  it("offers only the current device value for Drive Type when the option domain is unresolved", () => {
    render(<HomeDiskManager />);

    // Empty domains → the model-diverging Drive Type enum must fall back to the
    // current value only (default "1541"), never the fabricated 1541/1571/1581 list.
    expect(driveTypeOptionsFor("a")).toEqual(["1541"]);
    expect(driveTypeOptionsFor("b")).toEqual(["1541"]);
  });
});
