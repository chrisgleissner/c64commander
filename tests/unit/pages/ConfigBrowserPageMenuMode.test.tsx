/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConfigBrowserPage from "@/pages/ConfigBrowserPage";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = yaml.load(readFileSync(resolve(REPO_ROOT, "docs/c64/devices/c64u/1.1.0/c64u-config.yaml"), "utf8")) as {
  config: { categories: Record<string, { items: Record<string, unknown> }> };
};
const FIXTURE_CATEGORIES = FIXTURE.config.categories;
const ALL_CATEGORIES = Object.keys(FIXTURE_CATEGORIES);

const mockSetConfig = vi.fn();

vi.mock("framer-motion", () => {
  const Motion = ({
    children,
    animate: _a,
    initial: _i,
    exit: _e,
    transition: _t,
    layout: _l,
    whileTap: _wt,
    whileHover: _wh,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) => <div {...rest}>{children}</div>;
  return { AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>, motion: { div: Motion } };
});

vi.mock("@/components/ThemeProvider", () => ({ useThemeContext: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/components/UnifiedHealthBadge", () => ({ UnifiedHealthBadge: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toasts: [], dismiss: vi.fn() }) }));
vi.mock("@/hooks/useRefreshControl", () => ({ useRefreshControl: () => ({ setConfigExpanded: vi.fn() }) }));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: vi.fn() }));
vi.mock("@/lib/c64api", () => ({ BACKGROUND_REQUEST_TIMEOUT_MS: 3000, getC64API: vi.fn() }));

vi.mock("@/components/ConfigItemRow", () => ({
  ConfigItemRow: ({
    name,
    label,
    value,
    onValueChange,
  }: {
    name: string;
    label?: string;
    value?: string | number;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid={`row-${name.toLowerCase().replace(/\s+/g, "-")}`} data-value={String(value ?? "")}>
      <span data-testid="row-label">{label ?? name}</span>
      <button type="button" onClick={() => onValueChange?.("updated")}>
        Update {name}
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/useC64Connection", () => {
  // The real React-Query hooks return a referentially-stable object between renders,
  // so the mock must too. A fresh `{ data, isLoading, refetch }` (or a fresh `data`
  // literal) every call would mask a referential-stability bug — the test would pass
  // while `test:coverage` pegs a core and hangs in a setState-in-effect re-render loop
  // (BUG-033 failure mode). `memo` caches each hook's result by key; builders run lazily
  // (the factory is hoisted, so module consts like ALL_CATEGORIES are read on first call).
  const cache = new Map<string, unknown>();
  const memo = <T,>(key: string, build: () => T): T => {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key) as T;
  };
  return {
    VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
    useC64Connection: () =>
      memo("connection", () => ({
        status: { isConnected: true, deviceInfo: { product: "C64 Ultimate", firmware_version: "1.1.0", errors: [] } },
        runtimeBaseUrl: "http://c64u",
      })),
    useConnectionRoutingEpoch: () => 0,
    useC64Categories: () =>
      memo("categories", () => ({
        data: { categories: ALL_CATEGORIES },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      })),
    useC64Category: (category: string, enabled = true) =>
      memo(`category:${category}:${enabled}`, () => ({
        data:
          enabled && FIXTURE_CATEGORIES[category]
            ? { [category]: { items: FIXTURE_CATEGORIES[category].items } }
            : undefined,
        isLoading: false,
        refetch: vi.fn(),
      })),
    useC64SetConfig: () => memo("setConfig", () => ({ mutateAsync: mockSetConfig, isPending: false })),
    useC64UpdateConfigBatch: () => memo("updateBatch", () => ({ mutateAsync: vi.fn(), isPending: false })),
  };
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "*", element: <ConfigBrowserPage /> }], {
    initialEntries: ["/"],
    future: { v7_startTransition: true, v7_relativeSplatPath: true },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true, v7_relativeSplatPath: true }} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockSetConfig.mockReset();
  mockSetConfig.mockResolvedValue({});
});

describe("ConfigBrowserPage — menu hierarchy mode (C64U)", () => {
  it("renders the menu page structure (Layer B) + the Advanced (REST-only) fallback", () => {
    renderPage();
    expect(screen.getByTestId("config-menu-page-video-setup")).toBeInTheDocument();
    expect(screen.getByTestId("config-menu-page-turbo-boost")).toBeInTheDocument();
    expect(screen.getByTestId("config-menu-page-built-in-drive-a")).toBeInTheDocument();
    expect(screen.getByTestId("config-menu-page-network-services-&-timezone")).toBeInTheDocument();
    // Audio setup group label appears above its child pages (e.g. Audio mixer page).
    expect(screen.getAllByText("Audio setup").length).toBeGreaterThan(0);
    // Evidence-less leftovers (C64U Model, SoftIEC, Tape, Data Streams) have no menu page,
    // so the explicitly-labelled residual Advanced (REST-only) section is present (lossless).
    expect(screen.getByTestId("config-advanced-fallback")).toBeInTheDocument();
    // The Audio mixer menu page keeps the SPECIALIZED renderer (CategorySection: solo/reset),
    // not the generic MenuPageSection — routed via soleRestCategory(page) === "Audio Mixer".
    expect(screen.getByTestId("config-category-audio-mixer")).toBeInTheDocument();
    expect(screen.queryByTestId("config-menu-page-audio-mixer")).not.toBeInTheDocument();
  });

  it("relabels items with the menu label while keeping REST identity for write-back", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("config-menu-page-video-setup"));
    const row = await screen.findByTestId("row-system-mode");
    expect(within(row).getByTestId("row-label")).toHaveTextContent("System mode"); // menu label, not "System Mode"

    fireEvent.click(within(row).getByText("Update System Mode"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(1));
    // Write-back uses the canonical REST {category,item}, never the menu label.
    expect(mockSetConfig).toHaveBeenCalledWith({
      category: "U64 Specific Settings",
      item: "System Mode",
      value: "updated",
    });
  });

  it("shows drive ROM aliases under BOTH Memory & ROMs and Built-in drive A, one REST source", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("config-menu-page-memory-&-roms"));
    fireEvent.click(screen.getByTestId("config-menu-page-built-in-drive-a"));

    // The Memory & ROMs › Drive A alias and the Built-in drive A › ROMs primary both
    // render "ROM for 1541 mode" and both write the SAME canonical Drive A Settings source.
    const aliasSection = await screen.findByTestId("config-subsection-drive-a"); // Memory & ROMs › Drive A
    const aliasRow = within(aliasSection).getByTestId("row-rom-for-1541-mode");
    fireEvent.click(within(aliasRow).getByText("Update ROM for 1541 mode"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(1));
    expect(mockSetConfig).toHaveBeenLastCalledWith({
      category: "Drive A Settings",
      item: "ROM for 1541 mode",
      value: "updated",
    });

    const primarySection = screen.getByTestId("config-subsection-roms"); // Built-in drive A › ROMs
    const primaryRow = within(primarySection).getByTestId("row-rom-for-1541-mode");
    fireEvent.click(within(primaryRow).getByText("Update ROM for 1541 mode"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(2));
    expect(mockSetConfig).toHaveBeenLastCalledWith({
      category: "Drive A Settings",
      item: "ROM for 1541 mode",
      value: "updated",
    });
  });

  it("keyword-routes topical leftovers onto aligned pages; evidence-less ones to the residual fallback", async () => {
    renderPage();

    // Serial-bus comms (U64 Specific) keyword-route to the Built-in drive A page's Advanced,
    // keeping the canonical {category,item} identity on write.
    fireEvent.click(screen.getByTestId("config-menu-page-built-in-drive-a"));
    const driveAdvanced = await screen.findByTestId("config-page-advanced-built-in-drive-a");
    const serialRow = within(driveAdvanced).getByTestId("row-serial-bus-mode");
    fireEvent.click(within(serialRow).getByText("Update Serial Bus Mode"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(1));
    expect(mockSetConfig).toHaveBeenLastCalledWith({
      category: "U64 Specific Settings",
      item: "Serial Bus Mode",
      value: "updated",
    });
    // Tape / SoftIEC are NOT mis-homed on the disk-drive page (no whole-category default).
    expect(within(driveAdvanced).queryByTestId("row-tape-playback-rate")).not.toBeInTheDocument();
    expect(within(driveAdvanced).queryByTestId("row-iec-drive")).not.toBeInTheDocument();

    // `C64U Model` (hardware edition, absent from the captured menu) renders in the residual
    // Advanced (REST-only) section, with canonical write-back preserved.
    fireEvent.click(screen.getByTestId("config-advanced-fallback-toggle"));
    const fallback = await screen.findByTestId("config-advanced-fallback");
    const modelRow = within(fallback).getByTestId("row-c64u-model");
    fireEvent.click(within(modelRow).getByText("Update C64U Model"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(2));
    expect(mockSetConfig).toHaveBeenLastCalledWith({
      category: "U64 Specific Settings",
      item: "C64U Model",
      value: "updated",
    });
    // Tape Playback Rate + SoftIEC IEC Drive also surface here (their categories have no page).
    expect(within(fallback).getByTestId("row-tape-playback-rate")).toBeInTheDocument();
    expect(within(fallback).getByTestId("row-iec-drive")).toBeInTheDocument();
  });
});
