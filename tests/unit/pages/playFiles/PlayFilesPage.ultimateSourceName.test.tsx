/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

type CapturedGroups = Array<{ sources: Array<{ type: string; name: string }> }>;

const page = vi.hoisted(() => ({
  product: "Ultimate 64 Elite",
  sourceGroups: [] as CapturedGroups[],
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/hooks/useC64Connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useC64Connection")>();
  // One patched object per upstream status object, so the page sees a status that is as stable as the real one.
  const patched = new WeakMap<object, object>();
  return {
    ...actual,
    useC64Connection: () => {
      const connection = actual.useC64Connection();
      let status = patched.get(connection.status);
      if (!status) {
        status = { ...connection.status, deviceInfo: { ...connection.status.deviceInfo, product: page.product } };
        patched.set(connection.status, status);
      }
      return { ...connection, status };
    },
  };
});

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: (props: { title: string; sourceGroups: CapturedGroups }) => {
    if (props.title === "Add items") page.sourceGroups.push(props.sourceGroups);
    return null;
  },
}));

import PlayFilesPage from "@/pages/PlayFilesPage";

describe("PlayFilesPage Ultimate source name", () => {
  it("names the Add items Ultimate source after the connected product instead of always C64U", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/play"]}>
          <PlayFilesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(page.sourceGroups.length).toBeGreaterThan(0));
    const ultimateNames = page.sourceGroups
      .at(-1)!
      .flatMap((group) => group.sources)
      .filter((source) => source.type === "ultimate")
      .map((source) => source.name);
    expect(ultimateNames).toEqual(["U64E"]);
  });
});
