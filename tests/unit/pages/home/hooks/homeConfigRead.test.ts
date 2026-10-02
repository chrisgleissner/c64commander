/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
const api = vi.hoisted(() => ({
  baseUrl: "http://device",
  getBaseUrl() {
    return api.baseUrl;
  },
  getAllConfigCategories: vi.fn<(options: unknown) => Promise<Record<string, unknown>>>(),
  selectConfigItems: vi.fn((all: Record<string, unknown>, category: string) =>
    all[category] ? { [category]: all[category] } : null,
  ),
}));

vi.mock("@/lib/logging", () => logs);
vi.mock("@/lib/c64api", () => ({ getC64API: () => api }));

import { readHomeConfig } from "@/pages/home/hooks/homeConfigRead";
import { publishDeviceWrite, subscribeDeviceWrites } from "@/lib/deviceInteraction/deviceWriteEvents";

const guards = { isInteracting: () => false, isWritePending: () => false };
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { c64uHttpStatus: status });

let client: QueryClient;
let unsubscribers: Array<() => void> = [];

const mountQuery = (category: string, items: string[]) => {
  const observer = new QueryObserver(client, {
    queryKey: ["c64-config-items", category, items.join("|"), 0],
    queryFn: async () => ({ [category]: { items: {} } }),
    staleTime: Infinity,
  });
  unsubscribers.push(observer.subscribe(() => undefined));
};

let deviceCounter = 0;

beforeEach(() => {
  deviceCounter += 1;
  api.baseUrl = `http://device-${deviceCounter}`;
  api.getAllConfigCategories.mockReset();
  logs.addLog.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  unsubscribers = [];
});

afterEach(() => {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  client.clear();
});

describe("readHomeConfig", () => {
  it("falls back to per-category reads when the wildcard answer holds none of the categories Home shows", async () => {
    mountQuery("Audio Mixer", ["Vol Master"]);
    api.getAllConfigCategories.mockResolvedValue({ "Some Other Category": { items: {} } });
    const refetch = vi.spyOn(client, "refetchQueries");

    const outcome = await readHomeConfig(client, guards, 3000);

    expect(outcome).toEqual({ kind: "per-category", requests: 1 });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(logs.addLog).toHaveBeenCalledWith(
      "info",
      "Device does not answer the config wildcard read; Home refreshes per category",
      expect.objectContaining({ reason: "no mounted category in the response" }),
    );
  });

  it("announces a device without the wildcard only once when two reads find out at the same time", async () => {
    mountQuery("Audio Mixer", ["Vol Master"]);
    api.getAllConfigCategories.mockRejectedValue(httpError(404));

    await Promise.all([readHomeConfig(client, guards, 3000), readHomeConfig(client, guards, 3000)]);

    const announcements = logs.addLog.mock.calls.filter(
      ([, message]) => message === "Device does not answer the config wildcard read; Home refreshes per category",
    );
    expect(announcements).toHaveLength(1);
  });

  it("treats every category as written when a write during the read has a malformed category path", async () => {
    mountQuery("Audio Mixer", ["Vol Master"]);
    api.getAllConfigCategories.mockImplementation(async () => {
      publishDeviceWrite("/v1/configs/%E0%A4%A/Vol%20Master");
      return { "Audio Mixer": { items: { "Vol Master": "0 dB" } } };
    });

    const outcome = await readHomeConfig(client, guards, 3000);

    expect(outcome).toEqual({ kind: "wildcard", requests: 1, updatedKeys: 0, skippedKeys: 1 });
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "Config write path has a malformed category; treating every category as written",
      expect.objectContaining({ resourcePath: "/v1/configs/%E0%A4%A/Vol%20Master" }),
    );
  });
});

describe("publishDeviceWrite", () => {
  it("logs a listener that throws and still notifies the others", () => {
    const seen: string[] = [];
    const unsubscribeThrowing = subscribeDeviceWrites(() => {
      throw new Error("listener broke");
    });
    const unsubscribeOther = subscribeDeviceWrites((path) => seen.push(path));

    publishDeviceWrite("/v1/drives/a:mount");
    unsubscribeThrowing();
    unsubscribeOther();

    expect(seen).toEqual(["/v1/drives/a:mount"]);
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "Device write listener threw",
      expect.objectContaining({ resourcePath: "/v1/drives/a:mount", error: "listener broke" }),
    );
  });
});
