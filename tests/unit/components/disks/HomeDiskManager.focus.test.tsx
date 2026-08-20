/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetCardMemory } from "../../helpers/cards";
import { createElement } from "react";
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
  // Any element, not a fixed list: the drive cards render through `CollapsibleSection`, which uses
  // `motion.section`. Cached per tag, because a proxy that builds a new function on every access
  // hands React a new component type each render and remounts the whole subtree.
  motion: new Proxy({} as Record<string, unknown>, {
    get: (target, tag: string) => {
      target[tag] ??= ({ children, ...props }: any) => {
        const { initial, animate, exit, transition, variants, layout, onAnimationComplete, ...rest } = props;
        return createElement(tag, rest, children);
      };
      return target[tag];
    },
  }),
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
    resetCardMemory();
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

  /** Presses Down `steps` times and returns the testid of every element the ring focused. */
  const walkDown = (steps: number): string[] => {
    const visited: string[] = [];
    for (let step = 0; step < steps; step++) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      const id = document.activeElement?.getAttribute("data-testid");
      if (id && visited[visited.length - 1] !== id) visited.push(id);
    }
    return visited;
  };

  it("walks visible drive CTAs in top-to-bottom order and activates the focused drive reset", async () => {
    renderInFocusRing();

    // Scope-based auto-discovery puts every drive control in the ring in DOM
    // (reading) order, so the first step lands on drive A's first CTA.
    // Each drive is a collapsible card now, which makes it a focus scope: the ring walks the
    // cards, and a card's own controls are reached by going into it. The walk is asserted as
    // reachability and order rather than a fixed number of presses, which only recorded how
    // many items happened to precede the mount toggle on the day it was written.
    const topLevel = walkDown(24);
    expect(topLevel).toContain("drive-card-a");
    expect(topLevel).toContain("drive-card-b");
    // No ordering assertion across the two cards here: the walk wraps, so which card the first
    // press lands on is just where the ring happened to be, not the ring's own order. Order is
    // asserted below, inside drive A, where the walk starts from a known item.

    // Go into drive A and walk its controls.
    while (document.activeElement !== screen.getByTestId("drive-card-a")) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
    }
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    const inDriveA = walkDown(12);
    for (const cta of ["drive-mount-toggle-a", "drive-bus-select-a", "drive-type-select-a", "drive-reset-a"]) {
      expect(inDriveA).toContain(cta);
    }
    expect(inDriveA.indexOf("drive-mount-toggle-a")).toBeLessThan(inDriveA.indexOf("drive-reset-a"));

    while (document.activeElement !== screen.getByTestId("drive-reset-a")) {
      fireEvent.keyDown(document.body, { code: "DpadUp" });
    }

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

    // Disconnected, every drive CTA is disabled and the ring skips it. The card headers are
    // still items — a card can be opened and closed offline — so the walk is asserted as
    // "no disabled CTA is ever focused, and Add disks is reached".
    const visited = walkDown(24);
    for (const cta of ["drive-mount-toggle-a", "drive-reset-a", "drive-mount-toggle-b", "drive-reset-b"]) {
      expect(visited).not.toContain(cta);
    }
    while (document.activeElement !== screen.getByRole("button", { name: "Add disks" })) {
      fireEvent.keyDown(document.body, { code: "DpadUp" });
    }

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(screen.getByTestId("item-selection-dialog")).toBeInTheDocument();
  });
});
