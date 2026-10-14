/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfigBrowserPage from "@/pages/ConfigBrowserPage";
import { MenuBlock } from "@/pages/config/MenuBlock";
import type { AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { setProgressiveMountEnabled } from "@/lib/ui/progressiveMount";
import { resetStagedRowsForTests } from "@/lib/ui/stagedRows";
import { requestConfigItemFocus, resetConfigItemFocusLatchForTests } from "@/lib/search/configDeepLink";

vi.mock("framer-motion", () => {
  const Motion = ({
    children,
    animate: _animate,
    initial: _initial,
    exit: _exit,
    transition: _transition,
    layout: _layout,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) => <div {...rest}>{children}</div>;
  const cache: Record<string, unknown> = {};
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy(cache, {
      get: (target, tag: string) => {
        if (!target[tag]) target[tag] = (props: Record<string, unknown>) => <Motion {...props} />;
        return target[tag];
      },
    }),
  };
});

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/UnifiedHealthBadge", () => ({ UnifiedHealthBadge: () => null }));

const ITEM_COUNT = 40;
const itemNames = Array.from({ length: ITEM_COUNT }, (_, index) => `Item ${index + 1}`);
const categoryData = { Big: Object.fromEntries(itemNames.map((name) => [name, "On"])) };

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Connection: () => ({ status: { isConnected: true }, runtimeBaseUrl: "http://c64u" }),
  useConnectionRoutingEpoch: () => 0,
  useC64Categories: () => ({ data: { categories: ["Big"] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useC64Category: () => ({ data: categoryData, isLoading: false, refetch: vi.fn() }),
  useC64SetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useC64UpdateConfigBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useRefreshControl", () => ({ useRefreshControl: () => ({ setConfigExpanded: vi.fn() }) }));

vi.mock("@/components/ConfigItemRow", () => ({
  ConfigItemRow: ({ name }: { name: string }) => <div data-testid="staged-row" data-config-item={name} />,
}));

vi.mock("@/lib/c64api", () => ({
  BACKGROUND_REQUEST_TIMEOUT_MS: 3000,
  getC64API: vi.fn(),
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u" }),
}));

const renderPage = () =>
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: "*", element: <ConfigBrowserPage /> }], { initialEntries: ["/"] })}
    />,
  );

const builtRows = () => screen.queryAllByTestId("staged-row").map((row) => row.getAttribute("data-config-item"));

describe("ConfigBrowserPage builds a large category's rows in stages", () => {
  beforeEach(() => {
    setProgressiveMountEnabled(true);
    // Far below the screen, so only the shared first rows are built before the paint.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5100 } as DOMRect);
  });

  afterEach(() => {
    setProgressiveMountEnabled(false);
    resetStagedRowsForTests();
    resetConfigItemFocusLatchForTests();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("opening the card builds only its first rows in the opening commit, then every row after the paint", async () => {
    renderPage();
    act(() => fireEvent.click(screen.getByTestId("config-category-big")));

    const firstCommit = builtRows();
    expect(firstCommit.length).toBeGreaterThan(0);
    expect(firstCommit.length).toBeLessThan(ITEM_COUNT);
    expect(firstCommit).toEqual(itemNames.slice(0, firstCommit.length));

    await waitFor(() => expect(builtRows()).toEqual(itemNames));
  });

  it("a card reopened after all its rows were built builds them in stages again", async () => {
    renderPage();
    act(() => fireEvent.click(screen.getByTestId("config-category-big")));
    await waitFor(() => expect(builtRows()).toEqual(itemNames));
    act(() => fireEvent.click(screen.getByTestId("config-category-big")));
    expect(builtRows()).toEqual([]);

    act(() => fireEvent.click(screen.getByTestId("config-category-big")));

    expect(builtRows().length).toBeLessThan(ITEM_COUNT);
    await waitFor(() => expect(builtRows()).toEqual(itemNames));
  });

  it("builds the row a search result lands on in the opening commit, however far down the card it is", () => {
    requestConfigItemFocus("Big", "Item 38");
    renderPage();

    expect(builtRows()).toContain("Item 38");
    expect(builtRows()).toEqual(itemNames.slice(0, 38));
  });

  it("a menu page block builds its first rows at once, the rest after the paint, and its menu-only entries last", async () => {
    const authoritativeValues = {
      resolveValue: (_key: string, value: string | number) => value,
      pending: {},
    } as unknown as AuthoritativeConfigValueState;
    render(
      <MenuBlock
        block={{
          key: "big",
          title: null,
          category: "Big",
          leaves: itemNames.map((item) => ({ item, label: item })),
          menuOnly: [{ label: "Save to flash" }],
        }}
        active
        authoritativeValues={authoritativeValues}
        writeLeaf={vi.fn()}
      />,
    );

    expect(builtRows().length).toBeGreaterThan(0);
    expect(builtRows().length).toBeLessThan(ITEM_COUNT);
    expect(screen.queryByTestId("config-menu-only")).toBeNull();

    await waitFor(() => expect(builtRows()).toEqual(itemNames));
    expect(screen.getByTestId("config-menu-only")).toHaveTextContent("Save to flash");
  });
});
