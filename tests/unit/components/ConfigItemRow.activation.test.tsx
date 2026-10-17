/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigItemRow } from "@/components/ConfigItemRow";
import { CONFIG_BROWSER_C64_QUERY_OPTIONS, useC64Category } from "@/hooks/useC64Connection";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: "REAL_CONNECTED", deviceInfo: null, demoInterstitialVisible: false }),
}));

const mockApi = {
  getCategories: vi.fn(),
  getCategory: vi.fn(),
  getConfigItem: vi.fn(),
  getCachedConfigItem: vi.fn(),
};

vi.mock("@/lib/c64api", () => ({
  getC64API: () => mockApi,
  updateC64APIConfig: vi.fn(),
  getC64APIConfigSnapshot: () => ({ baseUrl: "http://c64u", password: undefined, deviceHost: "c64u" }),
  buildBaseUrlFromDeviceHost: () => "http://c64u",
  resolveDeviceHostFromStorage: () => "c64u",
  normalizeDeviceHost: () => "c64u",
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: () => "http://c64u",
  updateHasChanges: vi.fn(),
  loadInitialSnapshot: vi.fn(),
}));

vi.mock("@/lib/secureStorage", () => ({ hasStoredPasswordFlag: () => false, getPassword: async () => "" }));

vi.mock("@/hooks/useDiagnosticsSuppressionActive", () => ({ useDiagnosticsSuppressionActive: () => false }));

const CATEGORY = "Audio Mixer";
const OPTIONS = ["On", "Off"];
const NAMES = Array.from({ length: 12 }, (_, index) => `Item ${index}`);

const rowRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/hooks/useDisplayProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDisplayProfile")>();
  return {
    ...actual,
    useDisplayProfile: () => {
      rowRenders.count += 1;
      return actual.useDisplayProfile();
    },
  };
});

const Section = () => {
  useC64Category(CATEGORY, true, CONFIG_BROWSER_C64_QUERY_OPTIONS);
  const onValueChange = useCallback(() => undefined, []);
  return (
    <>
      {NAMES.map((name) => (
        <ConfigItemRow
          key={name}
          category={CATEGORY}
          name={name}
          value="On"
          options={OPTIONS}
          onValueChange={onValueChange}
        />
      ))}
    </>
  );
};

const Host = ({ active, children }: { active: boolean; children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <ScreenActivityProvider active={active}>{children}</ScreenActivityProvider>
  </QueryClientProvider>
);

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("Config rows when their tab is shown again", () => {
  it("does not render a row again when the tab is activated", async () => {
    mockApi.getCategories.mockResolvedValue({ categories: [CATEGORY] });
    mockApi.getCategory.mockResolvedValue({ [CATEGORY]: { items: {} } });
    mockApi.getCachedConfigItem.mockReturnValue({ options: ["On", "Off"] });
    const view = render(
      <Host active={false}>
        <Section />
      </Host>,
    );
    await act(async () => undefined);
    rowRenders.count = 0;

    view.rerender(
      <Host active>
        <Section />
      </Host>,
    );
    await act(async () => undefined);

    expect(rowRenders.count).toBe(0);
  });
});
