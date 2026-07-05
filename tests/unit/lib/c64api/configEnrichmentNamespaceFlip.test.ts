/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { C64API } from "@/lib/c64api";
import { loadConfigEnrichmentAbsentDomains, loadConfigEnrichmentCategory } from "@/lib/c64api/configEnrichmentCache";

const CATEGORY = "Video Settings";
const ITEM = "Video Mode";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const infoBody = (uniqueId: string, firmware: string) => ({
  product: "Ultimate-64",
  unique_id: uniqueId,
  firmware_version: firmware,
  hostname: "c64u",
});

const itemBody = () => ({
  [CATEGORY]: { items: { [ITEM]: { current: "PAL", values: ["PAL", "NTSC"] } } },
});

const originalFetch = globalThis.fetch;
let infoProvider: () => unknown;

const readInfo = (api: C64API) => api.getInfo({ __c64uBypassCache: true });

describe("C64API config enrichment namespace flip (HARD16-004)", () => {
  beforeEach(() => {
    localStorage.clear();
    infoProvider = () => ({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/info")) return jsonResponse(infoProvider());
        if (url.includes("/v1/configs/")) return jsonResponse(itemBody());
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  it("clears the cache on a firmware upgrade instead of migrating stale items into the new namespace", async () => {
    const api = new C64API("http://c64u");

    infoProvider = () => infoBody("uidA", "fw1");
    await readInfo(api);
    await api.getConfigItem(CATEGORY, ITEM);
    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeDefined();

    infoProvider = () => infoBody("uidA", "fw2");
    await readInfo(api);

    // The fw1 items must not be visible under, nor copied into, the fw2 namespace.
    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeUndefined();
    expect(loadConfigEnrichmentCategory("uidA|fw2", CATEGORY)).toBeNull();
  });

  it("clears the cache on a same-host unit swap (different unique id)", async () => {
    const api = new C64API("http://c64u");

    infoProvider = () => infoBody("uidA", "fw1");
    await readInfo(api);
    await api.getConfigItem(CATEGORY, ITEM);
    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeDefined();

    infoProvider = () => infoBody("uidB", "fw1");
    await readInfo(api);

    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeUndefined();
    expect(loadConfigEnrichmentCategory("uidB|fw1", CATEGORY)).toBeNull();
  });

  it("migrates anonymous pre-identity items forward into the first known namespace", async () => {
    const api = new C64API("http://c64u");

    // An item enriched before any /v1/info identity arrives.
    await api.getConfigItem(CATEGORY, ITEM);
    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeDefined();

    infoProvider = () => infoBody("uidA", "fw1");
    await readInfo(api);

    // Anonymous items are legitimately migrated forward, not dropped.
    expect(api.getCachedConfigItem(CATEGORY, ITEM)).toBeDefined();
    expect(loadConfigEnrichmentCategory("uidA|fw1", CATEGORY)).not.toBeNull();
  });

  it("negative-caches a definitively-absent domain per namespace and invalidates it on identity flip (HARD16-005)", async () => {
    const api = new C64API("http://c64u");
    infoProvider = () => infoBody("uidA", "fw1");
    await readInfo(api);

    expect(api.isConfigItemDomainKnownAbsent(CATEGORY, "Missing")).toBe(false);
    api.markConfigItemDomainAbsent(CATEGORY, "Missing");
    expect(api.isConfigItemDomainKnownAbsent(CATEGORY, "Missing")).toBe(true);
    expect(loadConfigEnrichmentAbsentDomains("uidA|fw1")).toContain(`${CATEGORY}::Missing`);

    // A firmware flip must not carry the old namespace's absence sentinel forward.
    infoProvider = () => infoBody("uidA", "fw2");
    await readInfo(api);
    expect(api.isConfigItemDomainKnownAbsent(CATEGORY, "Missing")).toBe(false);
  });
});
