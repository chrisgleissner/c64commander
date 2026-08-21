/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";
import { ensureCardOpen } from "../helpers/cards";
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
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    // Any element, not just `div` — the page renders through `CollapsibleSection`, which uses
    // `motion.section` and `motion.span`. Cached per tag: a proxy that builds a new function on
    // every access hands React a new component type each render, remounting the whole subtree.
    motion: new Proxy({} as Record<string, unknown>, {
      get: (target, tag: string) => {
        target[tag] ??= (props: Record<string, unknown> & { children?: ReactNode }) => <Motion {...props} />;
        return target[tag];
      },
    }),
  };
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

const FocusCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

const renderPage = (focusContext?: { current: FocusNavigationContextValue | null }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "*", element: <ConfigBrowserPage /> }], {
    initialEntries: ["/"],
    future: { v7_startTransition: true, v7_relativeSplatPath: true },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FocusNavigationProvider profileId="keypad">
        {focusContext ? <FocusCapture target={focusContext} /> : null}
        <RouterProvider router={router} future={{ v7_startTransition: true, v7_relativeSplatPath: true }} />
      </FocusNavigationProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockSetConfig.mockReset();
  mockSetConfig.mockResolvedValue({});
  // The menu pages render through `CollapsibleSection`, which remembers which sections a user
  // opened — the same behaviour the Settings cards have. Without clearing it, one test's open
  // page is restored in the next one, whose click then closes it.
  localStorage.clear();
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
    // A category with no menu page gets a card of its own, named after the category, rather than
    // sharing one "Advanced (REST-only)" bin with every other homeless category. Nothing is
    // hidden; what changed is that the reader is told what they are looking at.
    expect(screen.queryByTestId("config-advanced-fallback")).not.toBeInTheDocument();
    expect(screen.getByTestId("config-unrouted-softiec-drive-settings")).toBeInTheDocument();
    // The Audio mixer menu page keeps the SPECIALIZED renderer (CategorySection: solo/reset),
    // not the generic MenuPageSection — routed via soleRestCategory(page) === "Audio Mixer".
    expect(screen.getByTestId("config-category-audio-mixer")).toBeInTheDocument();
    expect(screen.queryByTestId("config-menu-page-audio-mixer")).not.toBeInTheDocument();
  });

  it("relabels items with the menu label while keeping REST identity for write-back", async () => {
    renderPage();
    ensureCardOpen(screen.getByTestId("config-menu-page-video-setup"));
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
    ensureCardOpen(screen.getByTestId("config-menu-page-memory-&-roms"));
    ensureCardOpen(screen.getByTestId("config-menu-page-built-in-drive-a"));

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
    ensureCardOpen(screen.getByTestId("config-menu-page-built-in-drive-a"));
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

    // `C64U Model` (hardware edition, absent from the captured menu) renders on a card named for
    // its own category, with canonical write-back preserved.
    fireEvent.click(screen.getByTestId("config-unrouted-toggle-u64-specific-settings"));
    const u64Card = await screen.findByTestId("config-unrouted-u64-specific-settings");
    const modelRow = within(u64Card).getByTestId("row-c64u-model");
    fireEvent.click(within(modelRow).getByText("Update C64U Model"));
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledTimes(2));
    expect(mockSetConfig).toHaveBeenLastCalledWith({
      category: "U64 Specific Settings",
      item: "C64U Model",
      value: "updated",
    });

    // Tape and SoftIEC each get their own card too, rather than sharing one bin: the point of the
    // change is that a reader is told which subject they are looking at.
    fireEvent.click(screen.getByTestId("config-unrouted-toggle-tape-settings"));
    expect(
      within(await screen.findByTestId("config-unrouted-tape-settings")).getByTestId("row-tape-playback-rate"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("config-unrouted-toggle-softiec-drive-settings"));
    expect(
      within(await screen.findByTestId("config-unrouted-softiec-drive-settings")).getByTestId("row-iec-drive"),
    ).toBeInTheDocument();
  });

  it("puts a card for an unplaced category in the same keypad ring as the menu pages", () => {
    // The point of these cards is that nothing is hidden. On the target handset the touchscreen is
    // off by default, so a card that is not in the ring is hidden from the only reader who cannot
    // work around it.
    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderPage(focusContext);

    for (const id of [
      "config-menu-page-video-setup",
      "config-unrouted-softiec-drive-settings",
      "config-unrouted-tape-settings",
      "config-unrouted-data-streams",
    ]) {
      expect(focusContext.current?.engine.sourceForId(id)).toBe("dom+explicit");
    }
  });
});
