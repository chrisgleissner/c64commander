/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfigBrowserPage from "@/pages/ConfigBrowserPage";
import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";
import { reportUserError } from "@/lib/uiErrors";
import { getC64API } from "@/lib/c64api";
import { resolveAudioMixerResetValue } from "@/lib/config/audioMixer";
import { toast } from "@/hooks/use-toast";

const mockUseC64Connection = vi.fn();
const mockUseC64Categories = vi.fn();
const mockUseC64Category = vi.fn();
const mockUseC64SetConfig = vi.fn();
const mockUseC64UpdateConfigBatch = vi.fn();
const mockSetConfigExpanded = vi.fn();
const mockUpdateHasChanges = vi.fn();

// framer-motion's `AnimatePresence` + `animate={{ height: "auto" }}` expand
// animation spins in jsdom (no real layout to measure), which can wedge the
// renderer when a section is expanded. Match the rest of the suite
// (DocsPage/HomePage/etc.) and render motion elements as plain DOM, stripping
// the animation-only props so React doesn't warn about unknown attributes.
vi.mock("framer-motion", () => {
  const Motion = ({
    children,
    animate: _animate,
    initial: _initial,
    exit: _exit,
    transition: _transition,
    layout: _layout,
    whileTap: _whileTap,
    whileHover: _whileHover,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) => <div {...rest}>{children}</div>;
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: { div: Motion },
  };
});

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/UnifiedHealthBadge", () => ({
  UnifiedHealthBadge: () => null,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
  useC64Connection: () => mockUseC64Connection(),
  useConnectionRoutingEpoch: () => 0,
  useC64Categories: () => mockUseC64Categories(),
  useC64Category: (...args: [string, boolean]) => mockUseC64Category(...args),
  useC64SetConfig: () => mockUseC64SetConfig(),
  useC64UpdateConfigBatch: () => mockUseC64UpdateConfigBatch(),
}));

vi.mock("@/hooks/useRefreshControl", () => ({
  useRefreshControl: () => ({ setConfigExpanded: mockSetConfigExpanded }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@/components/ConfigItemRow", () => ({
  ConfigItemRow: ({
    name,
    value,
    rightAccessory,
    onValueChange,
    isLoading,
  }: {
    name: string;
    value?: string | number;
    rightAccessory?: ReactNode;
    onValueChange?: (value: string) => void;
    isLoading?: boolean;
  }) => (
    <div
      data-testid={`row-${name.toLowerCase().replace(/\s+/g, "-")}`}
      data-value={String(value ?? "")}
      data-loading={String(Boolean(isLoading))}
    >
      <span>{name}</span>
      <button type="button" onClick={() => onValueChange?.("updated")}>
        Update {name}
      </button>
      {rightAccessory}
    </div>
  ),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

const buildRouter = (ui: JSX.Element) =>
  createMemoryRouter([{ path: "*", element: ui }], {
    initialEntries: ["/"],
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  });

const renderConfigBrowserPage = () =>
  render(
    <RouterProvider
      router={buildRouter(<ConfigBrowserPage />)}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    />,
  );

// Same page, but mounted inside the keypad focus ring (C64U Remote) so d-pad +
// center exercise the category-header registration.
const FocusContextCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

const renderConfigBrowserPageInFocusRing = (focusContext?: { current: FocusNavigationContextValue | null }) =>
  render(
    <RouterProvider
      router={buildRouter(
        <FocusNavigationProvider profileId="keypad">
          {focusContext ? <FocusContextCapture target={focusContext} /> : null}
          <ConfigBrowserPage />
        </FocusNavigationProvider>,
      )}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    />,
  );

vi.mock("@/lib/c64api", () => ({
  BACKGROUND_REQUEST_TIMEOUT_MS: 3000,
  getC64API: vi.fn(),
}));

vi.mock("@/lib/config/audioMixer", () => ({
  resolveAudioMixerResetValue: vi.fn(),
  isAudioMixerValueEqual: (left: string | number, right: string | number) => left === right,
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  updateHasChanges: (...args: [string, boolean]) => mockUpdateHasChanges(...args),
}));

const setupDefaultMocks = () => {
  mockUseC64Connection.mockReturnValue({
    status: { isConnected: true },
    runtimeBaseUrl: "http://c64u",
  });
  mockUseC64Categories.mockReturnValue({
    data: { categories: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseC64Category.mockReturnValue({
    data: {},
    isLoading: false,
    refetch: vi.fn(),
  });
  mockUseC64SetConfig.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockUseC64UpdateConfigBatch.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockSetConfigExpanded.mockReset();
  mockUpdateHasChanges.mockReset();
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ConfigBrowserPage", () => {
  it("renders connection warning when offline", () => {
    setupDefaultMocks();
    mockUseC64Connection.mockReturnValue({
      status: { isConnected: false },
      runtimeBaseUrl: "http://c64u",
    });

    renderConfigBrowserPage();

    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  it("renders categories in demo mode without showing not-connected message", () => {
    setupDefaultMocks();
    mockUseC64Connection.mockReturnValue({
      status: { isConnected: true, isDemo: true, deviceType: "demo" },
      runtimeBaseUrl: "http://c64u",
    });
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "Clock Settings"] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /audio mixer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clock settings/i })).toBeInTheDocument();
  });

  it("filters categories by search query", () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "Clock Settings"] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: "clock" },
    });

    expect(screen.getByRole("button", { name: /clock settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /audio mixer/i })).not.toBeInTheDocument();
  });

  it("shows empty search results message", () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: "missing" },
    });

    expect(screen.getByText(/no categories match your search/i)).toBeInTheDocument();
  });

  it("shows empty state when no categories exist", () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderConfigBrowserPage();

    expect(screen.getByText(/no categories available/i)).toBeInTheDocument();
  });

  it("shows retryable config load failure instead of no categories", () => {
    setupDefaultMocks();
    const refetch = vi.fn();
    mockUseC64Categories.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("request timed out"),
      refetch,
    });

    renderConfigBrowserPage();

    expect(screen.getByTestId("config-load-error")).toHaveTextContent("Config categories could not be loaded.");
    expect(screen.queryByText(/no categories available/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("config-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reports solo routing errors for audio mixer", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });

    // Solo/unsolo routes through useC64UpdateConfigBatch (not a direct
    // api.updateConfigBatch call), so it invalidates queries and marks
    // hasChanges like every other config write. See HARD9-054.
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("Update failed")),
      isPending: false,
    });

    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));

    const soloSwitch = await screen.findByTestId("audio-mixer-solo-vol-ultisid-1");
    fireEvent.click(soloSwitch);

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "AUDIO_ROUTING",
        }),
      );
    });
  });

  it("reports audio mixer update failures when solo is active", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error("Update failed"));
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));

    const soloSwitch = await screen.findByTestId("audio-mixer-solo-vol-ultisid-1");
    fireEvent.click(soloSwitch);
    fireEvent.click(await screen.findByRole("button", { name: /update vol ultisid 1/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "AUDIO_MIXER_UPDATE",
        }),
      );
    });
  });

  it("keeps audio mixer Solo active across item refetch identity changes", async () => {
    sessionStorage.clear();
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    // Solo/unsolo routes through useC64UpdateConfigBatch (not a direct
    // api.updateConfigBatch call). See HARD9-054.
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync: updateConfigBatch,
      isPending: false,
    });

    let audioMixerItems = {
      "Vol Ultisid 1": { selected: "0 dB", options: ["OFF", "0 dB"] },
      "Vol Ultisid 2": { selected: "0 dB", options: ["OFF", "0 dB"] },
    };
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: audioMixerItems,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    fireEvent.click(await screen.findByTestId("audio-mixer-solo-vol-ultisid-1"));

    await waitFor(() => expect(updateConfigBatch).toHaveBeenCalled());
    updateConfigBatch.mockClear();

    audioMixerItems = {
      "Vol Ultisid 1": { selected: "0 dB", options: ["OFF", "0 dB"] },
      "Vol Ultisid 2": { selected: "-6 dB", options: ["OFF", "-6 dB", "0 dB"] },
    };
    fireEvent.change(screen.getByPlaceholderText(/search categories/i), {
      target: { value: "audio" },
    });

    expect(await screen.findByTestId("audio-mixer-solo-vol-ultisid-1")).toBeChecked();
    expect(updateConfigBatch).not.toHaveBeenCalled();
  });

  it("discards a stale audio mixer solo snapshot instead of auto-restoring it (HARD9-054)", async () => {
    // Regression: the mount-time restore effect used to read the solo
    // snapshot from sessionStorage unconditionally and write those old
    // volumes back to the device, even if the snapshot was hours old (an
    // interrupted previous session) and volumes had changed since -
    // silently clobbering current settings on the next Config visit.
    sessionStorage.clear();
    const staleSavedAtMs = Date.now() - 6 * 60 * 1000; // older than the 5-minute freshness window
    sessionStorage.setItem(
      "c64u_audio_mixer_solo_snapshot",
      JSON.stringify({
        savedAtMs: staleSavedAtMs,
        items: [{ name: "Vol Ultisid 1", value: "-6 dB", options: ["-6 dB", "0 dB"] }],
      }),
    );
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue({ errors: [] });
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    await screen.findByTestId("audio-mixer-solo-vol-ultisid-1");

    // Give the mount-time restore effect a chance to run (it fires
    // unconditionally on mount when not already soloed).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("c64u_audio_mixer_solo_snapshot")).toBeNull();
  });

  it("auto-restores a fresh audio mixer solo snapshot on mount (HARD9-054)", async () => {
    sessionStorage.clear();
    const freshSavedAtMs = Date.now() - 30 * 1000; // well within the freshness window
    sessionStorage.setItem(
      "c64u_audio_mixer_solo_snapshot",
      JSON.stringify({
        savedAtMs: freshSavedAtMs,
        items: [{ name: "Vol Ultisid 1", value: "-6 dB", options: ["-6 dB", "0 dB"] }],
      }),
    );
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue({ errors: [] });
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    await screen.findByTestId("audio-mixer-solo-vol-ultisid-1");

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });

  it("reports config update failures", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["General"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error("Update failed"));
    mockUseC64SetConfig.mockReturnValue({ mutateAsync, isPending: false });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Demo Option": { selected: "Off", options: ["Off", "On"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /general/i }));
    fireEvent.click(await screen.findByRole("button", { name: /update demo option/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONFIG_UPDATE",
        }),
      );
    });
  });

  it("does not disable unrelated rows while the shared mutation is pending for a different item (HARD9-085)", async () => {
    // Regression: row isLoading was keyed off setConfig.isPending, the
    // section's SHARED mutation state - while one item's PUT was in flight
    // (spaced by the write throttle), every OTHER row in the category
    // rendered disabled too, appearing dead until the first write settled.
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["General"] },
      isLoading: false,
    });
    mockUseC64SetConfig.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Item A": { selected: "1", options: ["1", "2"] },
            "Item B": { selected: "3", options: ["3", "4"] },
          },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /general/i }));

    const rowA = await screen.findByTestId("row-item-a");
    const rowB = await screen.findByTestId("row-item-b");
    expect(rowA).toHaveAttribute("data-loading", "false");
    expect(rowB).toHaveAttribute("data-loading", "false");
  });

  it("keeps a pending pin latched and reports the failure when Refresh's refetch does not succeed (HARD9-089)", async () => {
    // Regression: react-query's refetch() resolves (does not throw) on
    // failure. handleRefresh used to run its device-truth re-sync
    // unconditionally, dropping every pending optimistic pin and re-syncing
    // to stale cached data on a momentary refresh failure, with no
    // indication anything went wrong.
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["General"] },
      isLoading: false,
    });
    mockUseC64SetConfig.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    const refetchError = new Error("device unreachable");
    const refetch = vi.fn().mockResolvedValue({ isSuccess: false, isError: true, error: refetchError, data: undefined });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Item A": { selected: "1", options: ["1", "2", "updated"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /general/i }));

    const rowA = await screen.findByTestId("row-item-a");
    fireEvent.click(within(rowA).getByRole("button", { name: /update item a/i }));

    await waitFor(() => {
      expect(rowA).toHaveAttribute("data-value", "updated");
    });

    fireEvent.click(await screen.findByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CONFIG_REFRESH",
          error: refetchError,
        }),
      );
    });

    // The pin must survive the failed refresh instead of reverting to the
    // stale pre-update device value.
    expect(rowA).toHaveAttribute("data-value", "updated");
    expect(rowA).toHaveAttribute("data-loading", "true");
  });

  it("keeps the updated local value visible until the device payload catches up", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["General"] },
      isLoading: false,
    });

    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64SetConfig.mockReturnValue({ mutateAsync, isPending: false });

    let selectedValue = "Off";
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Demo Option": { selected: selectedValue, options: ["Off", "updated"] },
          },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    const router = buildRouter(<ConfigBrowserPage />);
    const view = render(
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /general/i }));
    fireEvent.click(screen.getByRole("button", { name: /update demo option/i }));

    await waitFor(() => {
      expect(screen.getByTestId("row-demo-option")).toHaveAttribute("data-value", "updated");
    });

    selectedValue = "Off";
    view.rerender(
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("row-demo-option")).toHaveAttribute("data-value", "updated");
    });
  });

  it("syncs clock settings when fields are present", async () => {
    setupDefaultMocks();
    const now = new Date();
    const monthOptions = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ] as const;
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Clock Settings"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Year: { selected: 2024 },
            Month: {
              selected: "January",
              options: [...monthOptions],
            },
            Day: { selected: 1 },
            Hours: { selected: 0 },
            Minutes: { selected: 0 },
            Seconds: { selected: 0 },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync clock/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        category: "Clock Settings",
        updates: expect.objectContaining({
          Month: monthOptions[now.getMonth()],
        }),
      });
      expect(mockUpdateHasChanges).toHaveBeenCalledWith("http://c64u", true);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Clock synced" }));
    });

    const [{ updates }] = mutateAsync.mock.calls.at(-1) as [{ updates: Record<string, string | number> }];
    expect(updates.Month).toBe(monthOptions[now.getMonth()]);

    const syncedMonthIndex = monthOptions.indexOf(String(updates.Month) as (typeof monthOptions)[number]);
    expect(syncedMonthIndex).toBeGreaterThanOrEqual(0);

    const syncedDate = new Date(
      Number(updates.Year),
      syncedMonthIndex,
      Number(updates.Day),
      Number(updates.Hours),
      Number(updates.Minutes),
      Number(updates.Seconds),
    );
    expect(Math.abs(syncedDate.getTime() - now.getTime())).toBeLessThan(2_000);
  });

  it("syncs clock month names when the live payload omits month options", async () => {
    setupDefaultMocks();
    const now = new Date();
    const expectedMonth = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
      new Date(now.getFullYear(), now.getMonth(), 1),
    );
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Clock Settings"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Year: { selected: 2024 },
            Month: { selected: "October" },
            Day: { selected: 1 },
            Hours: { selected: 0 },
            Minutes: { selected: 0 },
            Seconds: { selected: 0 },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync clock/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        category: "Clock Settings",
        updates: expect.objectContaining({
          Month: expectedMonth,
        }),
      });
      expect(mockUpdateHasChanges).toHaveBeenCalledWith("http://c64u", true);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Clock synced" }));
    });

    const [{ updates }] = mutateAsync.mock.calls.at(-1) as [{ updates: Record<string, string | number> }];
    expect(updates.Month).toBe(expectedMonth);

    const syncedMonthIndex = new Date(`${updates.Month} 1, ${updates.Year}`).getMonth();
    const syncedDate = new Date(
      Number(updates.Year),
      syncedMonthIndex,
      Number(updates.Day),
      Number(updates.Hours),
      Number(updates.Minutes),
      Number(updates.Seconds),
    );
    expect(Math.abs(syncedDate.getTime() - now.getTime())).toBeLessThan(2_000);
  });

  it("reports clock sync when no matching fields exist", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Clock Settings"] },
      isLoading: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Timezone: { selected: "UTC" },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync clock/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CLOCK_SYNC",
        }),
      );
    });
  });

  it("resets audio mixer to defaults", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "-6 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));
    vi.mocked(resolveAudioMixerResetValue).mockResolvedValue("0 dB");

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /reset/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ category: "Audio Mixer" }));
      expect(refetch).toHaveBeenCalled();
      expect(mockUpdateHasChanges).toHaveBeenCalledWith("http://c64u", true);
    });
  });

  it("shows no-op toast when audio mixer is already at defaults", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));
    vi.mocked(resolveAudioMixerResetValue).mockResolvedValue("0 dB");

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /reset/i }));

    await waitFor(() => {
      expect(mutateAsync).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Audio Mixer already at defaults" }));
    });
  });

  it("reports audio mixer reset failures", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error("Reset failed"));
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "-6 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));
    vi.mocked(resolveAudioMixerResetValue).mockResolvedValue("0 dB");

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /reset/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "AUDIO_MIXER_RESET",
        }),
      );
    });
  });

  it("reports clock sync failure when update batch rejects", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Clock Settings"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockRejectedValue(new Error("Clock failed"));
    mockUseC64UpdateConfigBatch.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            Year: { selected: 2024 },
            Month: { selected: 1 },
            Day: { selected: 1 },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();
    fireEvent.click(screen.getByRole("button", { name: /clock settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sync clock/i }));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "CLOCK_SYNC",
          title: "Clock sync failed",
        }),
      );
    });
  });

  it("refreshes category data", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer"] },
      isLoading: false,
    });
    const refetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {
            "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] },
          },
        },
      },
      isLoading: false,
      refetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /audio mixer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("renders loading and empty category states in the category panel", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["General"] },
      isLoading: false,
    });

    const loadingRefetch = vi.fn();
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {},
        },
      },
      isLoading: true,
      refetch: loadingRefetch,
    }));

    const firstView = renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /general/i }));
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    firstView.unmount();

    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: {},
        },
      },
      isLoading: false,
      refetch: loadingRefetch,
    }));

    renderConfigBrowserPage();

    fireEvent.click(screen.getByRole("button", { name: /general/i }));
    expect(await screen.findByText(/no settings available/i)).toBeInTheDocument();
  });
});

describe("ConfigBrowserPage keypad focus ring (C64U Remote)", () => {
  it("keeps category headers DOM-backed in the keypad focus ring", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "Clock Settings", "General"] },
      isLoading: false,
    });

    renderConfigBrowserPageInFocusRing(focusContext);

    expect(focusContext.current?.engine.sourceForId("config-category-audio-mixer")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("config-category-clock-settings")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("config-category-general")).toBe("dom+explicit");

    const enabledIds = new Set(
      focusContext.current?.controller.focus
        .list()
        .filter((item) => !item.disabled)
        .map((item) => item.id),
    );
    expect(enabledIds.has("config-category-audio-mixer")).toBe(true);
    expect(enabledIds.has("config-category-clock-settings")).toBe(true);
    expect(enabledIds.has("config-category-general")).toBe(true);
  });

  it("center-activates the focused category header, expanding only that section", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "Clock Settings", "General"] },
      isLoading: false,
    });

    renderConfigBrowserPageInFocusRing(focusContext);

    focusContext.current?.controller.focus.setCurrent("config-category-clock-settings");
    mockSetConfigExpanded.mockClear();

    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    expect(mockSetConfigExpanded).toHaveBeenCalledWith("Clock Settings", true);
    expect(mockSetConfigExpanded).not.toHaveBeenCalledWith("Audio Mixer", true);
    expect(mockSetConfigExpanded).not.toHaveBeenCalledWith("General", true);
  });

  it("is inert without a FocusNavigationProvider (default variant)", () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "Clock Settings"] },
      isLoading: false,
    });

    renderConfigBrowserPage();

    // No provider → no global key listener, so d-pad moves no focus and the
    // category headers keep their plain pointer behaviour.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(document.body);
  });

  it("registers a category's Reset + Refresh group actions into the ring when expanded", async () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "General"] },
      isLoading: false,
    });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: { "Vol Ultisid 1": { selected: "0 dB", options: ["-6 dB", "0 dB"] } },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    renderConfigBrowserPageInFocusRing(focusContext);

    // Expand Audio Mixer, mounting its Reset + Refresh group actions into the ring.
    focusContext.current?.controller.focus.setCurrent("config-category-audio-mixer");
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await Promise.resolve();
    const resetButton = screen.getByRole("button", { name: /^reset$/i });
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    expect(focusContext.current?.engine.sourceForId("config-category-action-audio-mixer")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("config-refresh-audio-mixer")).toBe("dom+explicit");

    expect(focusContext.current?.engine.elementForId("config-category-action-audio-mixer")).toBe(resetButton);
    expect(focusContext.current?.engine.elementForId("config-refresh-audio-mixer")).toBe(refreshButton);
  });

  it("center-activates Clock Settings' Sync clock group action", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Clock Settings"] },
      isLoading: false,
    });
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseC64UpdateConfigBatch.mockReturnValue({ mutateAsync, isPending: false });
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: {
        [categoryName]: {
          items: { Year: { selected: 2024 }, Month: { selected: 1 }, Day: { selected: 1 } },
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    }));

    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderConfigBrowserPageInFocusRing(focusContext);

    // Expand Clock Settings, then select its Sync clock action by stable focus id.
    focusContext.current?.controller.focus.setCurrent("config-category-clock-settings");
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await Promise.resolve();
    const syncButton = screen.getByRole("button", { name: /sync clock/i });
    expect(focusContext.current?.engine.elementForId("config-category-action-clock-settings")).toBe(syncButton);

    // Center activates it → the clock-sync batch fires for this category.
    focusContext.current?.controller.focus.setCurrent("config-category-action-clock-settings");
    syncButton.focus();
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ category: "Clock Settings" }));
    });
  });

  it("skips a disabled category action and still reaches Refresh", async () => {
    setupDefaultMocks();
    mockUseC64Categories.mockReturnValue({
      data: { categories: ["Audio Mixer", "General"] },
      isLoading: false,
    });
    // Audio Mixer with no items → Reset is disabled (skipped in the ring), but
    // Refresh always renders and stays reachable by d-pad.
    mockUseC64Category.mockImplementation((categoryName: string) => ({
      data: { [categoryName]: { items: {} } },
      isLoading: false,
      refetch: vi.fn(),
    }));

    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderConfigBrowserPageInFocusRing(focusContext);

    focusContext.current?.controller.focus.setCurrent("config-category-audio-mixer");
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    await Promise.resolve();
    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeDisabled();

    expect(focusContext.current?.engine.sourceForId("config-category-action-audio-mixer")).toBeNull();
    expect(focusContext.current?.engine.elementForId("config-refresh-audio-mixer")).toBe(refreshButton);
  });
});
