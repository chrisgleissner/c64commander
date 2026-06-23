/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import type { ReactElement } from "react";
import { ConfigItemRow } from "@/components/ConfigItemRow";
import { createMockC64Server, type MockC64Server } from "../../mocks/mockC64Server";
import { getC64API, updateC64APIConfig } from "@/lib/c64api";

// The lazy per-item "fetch options + upgrade the control" path is gated on an active
// connection. Pin REAL_CONNECTED so this isolated component test exercises it.
vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({
    state: "REAL_CONNECTED" as const,
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: 0,
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    deviceInfo: null,
    demoInterstitialVisible: false,
  }),
}));

const renderWithQuery = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const CATEGORY = "Perf Cache Category";
const ITEM = "Video Mode";
const ITEM_URL = `/v1/configs/${encodeURIComponent(CATEGORY)}/${encodeURIComponent(ITEM)}`;

describe("ConfigItemRow — persistent option cache avoids the per-item refetch storm", () => {
  let server: MockC64Server;

  beforeAll(async () => {
    // Category read returns a bare scalar (like the real device); the per-item read carries
    // the option set. After the first read enriches+caches the static options, later mounts
    // must NOT re-issue the per-item GET.
    server = await createMockC64Server(
      { [CATEGORY]: { [ITEM]: "PAL" } },
      { [CATEGORY]: { [ITEM]: { options: ["PAL", "NTSC"] } } },
    );
    updateC64APIConfig(server.baseUrl);
  });

  afterAll(async () => {
    await server.close();
  });

  const perItemGetCount = () => server.requests.filter((r) => r.method === "GET" && r.url.includes(ITEM_URL)).length;

  it("fetches options once, then serves them from cache on remount (no second per-item request)", async () => {
    // First mount: no inline options → fetch the per-item metadata, upgrade to a select.
    const first = renderWithQuery(
      <ConfigItemRow category={CATEGORY} name={ITEM} value="PAL" onValueChange={() => {}} />,
    );
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(perItemGetCount()).toBeGreaterThanOrEqual(1);
    const afterFirst = perItemGetCount();
    first.unmount();

    // Second mount (fresh React Query client = no query cache): the firmware-static options
    // come from the persistent enrichment cache, so NO new per-item GET is issued and the
    // select renders immediately.
    renderWithQuery(<ConfigItemRow category={CATEGORY} name={ITEM} value="NTSC" onValueChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(getC64API().getCachedConfigItem(CATEGORY, ITEM)).toBeDefined();
    expect(perItemGetCount()).toBe(afterFirst);
  });
});
