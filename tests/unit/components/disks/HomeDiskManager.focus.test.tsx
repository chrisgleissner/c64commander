/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";
import { useC64ConfigItems, useC64Connection, useC64Drives } from "@/hooks/useC64Connection";
import { useDiskLibrary } from "@/hooks/useDiskLibrary";
import { getC64API } from "@/lib/c64api";

const createMockDrive = (overrides: Record<string, unknown> = {}) => ({
  bus_id: 8,
  enabled: true,
  image_file: "",
  image_path: "",
  status: "ready",
  ...overrides,
});

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => 0,
  HOME_SUMMARY_QUERY_OPTIONS: { intent: "user" },
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user" },
  useC64Connection: vi.fn(),
  useC64ConfigItems: vi.fn(),
  useC64Drives: vi.fn(),
}));

vi.mock("@/hooks/useDiskLibrary");
vi.mock("@/lib/c64api");
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: vi.fn() }));
vi.mock("@/hooks/useActionTrace", () => ({ useActionTrace: () => (fn: unknown) => fn }));
vi.mock("@/hooks/useLocalSources", () => ({
  useLocalSources: () => ({ sources: [], addSourceFromPicker: vi.fn() }),
}));
vi.mock("@/pages/playFiles/hooks/useArchiveClientSettings", () => ({
  useArchiveClientSettings: () => ({
    commoserveEnabled: false,
    archiveConfig: {
      id: "archive-commoserve",
      name: "CommoServe",
      baseUrl: "http://commoserve.files.commodore.net",
      enabled: false,
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="item-selection-dialog">Item Selection Dialog</div> : null,
}));
vi.mock("@/components/itemSelection/AddItemsProgressOverlay", () => ({
  AddItemsProgressOverlay: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="progress-overlay">Progress Overlay</div> : null,
}));
vi.mock("@/components/lists/SelectableActionList", () => ({
  SelectableActionList: ({ headerActions }: { headerActions?: ReactNode }) => (
    <div data-testid="mock-action-list">{headerActions}</div>
  ),
}));

// Mock framer-motion: in jsdom its auto-height/layout animations re-measure on
// every render, which — combined with the focus ring re-scanning the DOM as the
// keypad walks through the drive controls — spins into a remeasure→setState loop
// (the project's CPU-pegged hang). Rendering plain elements removes the animation
// loop without changing the focus behaviour under test.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, layout, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, layout, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
    span: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, variants, layout, ...rest } = props;
      return <span {...rest}>{children}</span>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("HomeDiskManager keypad focus ring (C64U Remote)", () => {
  const mockApi = {
    driveOn: vi.fn().mockResolvedValue(undefined),
    driveOff: vi.fn().mockResolvedValue(undefined),
    resetDrive: vi.fn().mockResolvedValue(undefined),
    unmountDrive: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: () => "http://mock-host",
    getDeviceHost: () => "mock-host",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getC64API as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);
    (useC64Connection as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      status: {
        isConnected: true,
        isConnecting: false,
        state: "ready",
        deviceInfo: { unique_id: "test-device" },
      },
    });
    (useC64Drives as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { drives: [{ a: createMockDrive({ bus_id: 8 }) }, { b: createMockDrive({ bus_id: 9 }) }] },
      dataUpdatedAt: 1,
    });
    (useC64ConfigItems as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });
    (useDiskLibrary as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      disks: [],
      runtimeFiles: {},
      removeDisk: vi.fn(),
    });
  });

  const renderInFocusRing = () =>
    render(
      <FocusNavigationProvider profileId="keypad">
        <HomeDiskManager />
      </FocusNavigationProvider>,
    );

  it("walks visible drive CTAs in top-to-bottom order and activates the focused drive reset", async () => {
    renderInFocusRing();

    // Scope-based auto-discovery puts every drive control in the ring in DOM
    // (reading) order, so the first step lands on drive A's first CTA.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByTestId("drive-mount-toggle-a")).toHaveFocus();

    // Step down through drive A's controls until the reset button is reached
    // (the bus/type selects sit between mount and reset); the walk stays within
    // drive A and the order is strictly top-to-bottom.
    for (let step = 0; step < 8 && document.activeElement !== screen.getByTestId("drive-reset-a"); step++) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
    }
    expect(screen.getByTestId("drive-reset-a")).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    await waitFor(() => {
      expect(mockApi.resetDrive).toHaveBeenCalledWith("a");
    });
    expect(mockApi.driveOff).not.toHaveBeenCalled();
  });

  it("skips disabled drive CTAs and keeps the Add disks action reachable", () => {
    (useC64Connection as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      status: {
        isConnected: false,
        isConnecting: false,
        state: "offline",
        deviceInfo: null,
      },
    });

    renderInFocusRing();

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(screen.getByRole("button", { name: "Add disks" })).toHaveFocus();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(screen.getByTestId("item-selection-dialog")).toBeInTheDocument();
  });
});
