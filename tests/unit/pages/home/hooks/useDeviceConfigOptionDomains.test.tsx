/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  getConfigItemMock: vi.fn(),
  cachedItemMock: vi.fn<(category: string, item: string) => unknown>(() => undefined),
  absent: new Set<string>(),
  routing: { epoch: 0 },
}));

vi.mock("@/hooks/useC64Connection", async (importActual) => ({
  ...(await importActual<typeof import("@/hooks/useC64Connection")>()),
  useConnectionRoutingEpoch: () => hoisted.routing.epoch,
}));

vi.mock("@/lib/c64api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/c64api")>()),
  getC64API: () => ({
    getCachedConfigItem: (category: string, item: string) => hoisted.cachedItemMock(category, item),
    isConfigItemDomainKnownAbsent: (category: string, item: string) => hoisted.absent.has(`${category}::${item}`),
    markConfigItemDomainAbsent: (category: string, item: string) => hoisted.absent.add(`${category}::${item}`),
    getConfigItem: (...args: unknown[]) => hoisted.getConfigItemMock(...args),
  }),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

import { useDeviceConfigOptionDomains } from "@/pages/home/hooks/useDeviceConfigOptionDomains";
import { notifyConfigEnrichmentNamespaceChange } from "@/lib/c64api/configEnrichmentNamespaceSignal";

const REFS = [{ category: "Cat", item: "Item" }] as const;

const http404 = () => Object.assign(new Error("HTTP 404"), { c64uHttpStatus: 404 });
const domainPayload = () => ({ Cat: { items: { Item: { current: "x", values: ["A", "B"] } } } });
const noDomainPayload = () => ({ Cat: { items: { Item: { current: "x" } } } });

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

const bumpEpochAndRerender = async (rerender: () => void) => {
  hoisted.routing.epoch += 1;
  act(() => rerender());
  await flush();
};

describe("useDeviceConfigOptionDomains", () => {
  beforeEach(() => {
    hoisted.getConfigItemMock.mockReset();
    hoisted.cachedItemMock.mockReset();
    hoisted.cachedItemMock.mockReturnValue(undefined);
    hoisted.absent.clear();
    hoisted.routing.epoch = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-fetch a definitively-absent (404) ref on the next effect run (HARD16-005)", async () => {
    hoisted.getConfigItemMock.mockRejectedValue(http404());
    const { rerender } = renderHook(() => useDeviceConfigOptionDomains("test", REFS, true));
    await flush();
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);

    await bumpEpochAndRerender(rerender);
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient (timeout / no HTTP status) ref on the next effect run (HARD16-005)", async () => {
    hoisted.getConfigItemMock.mockRejectedValue(new Error("network timeout"));
    const { rerender } = renderHook(() => useDeviceConfigOptionDomains("test", REFS, true));
    await flush();
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);

    await bumpEpochAndRerender(rerender);
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-fetch a ref that answered 200 with no option domain (HARD16-005)", async () => {
    hoisted.getConfigItemMock.mockResolvedValue(noDomainPayload());
    const { rerender } = renderHook(() => useDeviceConfigOptionDomains("test", REFS, true));
    await flush();
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);

    await bumpEpochAndRerender(rerender);
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);
  });

  it("resolves and exposes a device-reported option domain", async () => {
    hoisted.getConfigItemMock.mockResolvedValue(domainPayload());
    const { result } = renderHook(() => useDeviceConfigOptionDomains("test", REFS, true));
    await waitFor(() => expect(result.current["Cat::Item"]?.options).toEqual(["A", "B"]));
  });

  it("re-resolves when the enrichment namespace-change signal fires (HARD16-004)", async () => {
    hoisted.getConfigItemMock.mockResolvedValue(domainPayload());
    renderHook(() => useDeviceConfigOptionDomains("test", REFS, true));
    await flush();
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(1);

    // A same-host identity flip does not bump the routing epoch; the signal must
    // still force the effect to re-run against the new identity.
    act(() => notifyConfigEnrichmentNamespaceChange());
    await flush();
    expect(hoisted.getConfigItemMock).toHaveBeenCalledTimes(2);
  });
});
