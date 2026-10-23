/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { networkOffline, simulatedDevice } = vi.hoisted(() => ({
  networkOffline: vi.fn(() => false),
  simulatedDevice: vi.fn(() => false),
}));

vi.mock("@/lib/connection/networkStatusWatch", () => ({ isNetworkKnownOffline: networkOffline }));
vi.mock("@/lib/connection/connectionManager", () => ({ isSimulatedDeviceTarget: simulatedDevice }));
vi.mock("@/lib/ftp/ftpClient", async (importOriginal) => ({
  isRefusedFtpListing: (await importOriginal<typeof import("@/lib/ftp/ftpClient")>()).isRefusedFtpListing,
  listFtpDirectory: vi.fn(),
  listFtpDirectoryRecursive: vi.fn(),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: vi.fn(() => 21) }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "u64", password: "" })),
}));

import { listFtpDirectory } from "@/lib/ftp/ftpClient";
import { addLog } from "@/lib/logging";
import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import {
  CONFIG_LOOKUP_PROBE_EVERY,
  CONFIG_LOOKUP_SKIPPED_NOTICE,
  createConfigListing,
  SONGLENGTHS_LOOKUP_PROBE_EVERY,
  SONGLENGTHS_LOOKUP_SKIPPED_NOTICE,
} from "@/lib/sourceNavigation/guardedConfigListing";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";

const entry = { type: "file", name: "a.cfg", path: "/USB2/Games/a.cfg" } as const;

describe("createConfigListing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listFtpDirectory).mockReset();
    networkOffline.mockReturnValue(false);
    simulatedDevice.mockReturnValue(false);
  });

  it("answers from the listing cache and does not ask the device while the phone is offline", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await source.listEntries("/USB2/Games");
    vi.mocked(listFtpDirectory).mockClear();
    networkOffline.mockReturnValue(true);
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/Games")).resolves.toEqual([expect.objectContaining({ name: "a.cfg" })]);
    await expect(listing.listEntries("/USB2/Other")).resolves.toEqual([]);

    expect(listFtpDirectory).not.toHaveBeenCalled();
    expect(listing.skippedLookups()).toBe(2);
  });

  it("stops asking the device after one connection failure while mobile data keeps the phone online", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("failed to connect to /192.168.1.13 (port 21)"));
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("failed to connect");
    await expect(listing.listEntries("/USB2/Two")).resolves.toEqual([]);
    await expect(listing.listEntries("/USB2/Three")).resolves.toEqual([]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    expect(listing.skippedLookups()).toBe(3);
  });

  it.each([
    "FTP listDirectory timed out after connect 1500ms / transfer 3000ms",
    'Unable to resolve host "c64u": No address associated with hostname',
    "Connection reset",
    "Software caused connection abort",
    "Network is unreachable",
  ])("treats %s as a lost connection", async (message) => {
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error(message));
    const listing = createConfigListing(createUltimateSourceLocation());

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow();
    await expect(listing.listEntries("/USB2/Two")).resolves.toEqual([]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
  });

  it("answers a folder that discovery asks for with a trailing slash from the cache of the browsed folder", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({
      entries: [{ type: "file", name: "demo.cfg", path: "/USB2/Games/demo.cfg" }],
    } as never);
    await source.listEntries("/USB2/Games");
    vi.mocked(listFtpDirectory).mockClear();
    networkOffline.mockReturnValue(true);
    const listing = createConfigListing(source);

    const candidates = await discoverConfigCandidates({
      sourceType: "ultimate",
      sourceId: null,
      sourceRootPath: "/",
      targetFile: { name: "demo.prg", path: "/USB2/Games/demo.prg" },
      listEntries: listing.listEntries,
    });

    expect(
      candidates.some(
        (candidate) => candidate.ref?.fileName === "demo.cfg" || JSON.stringify(candidate).includes("demo.cfg"),
      ),
    ).toBe(true);
    expect(listFtpDirectory).not.toHaveBeenCalled();
  });

  it("asks the device again every few lookups, and uses it again once it answers", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("failed to connect"));
    const listing = createConfigListing(source);
    await expect(listing.listEntries("/USB2/0")).rejects.toThrow();
    vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);

    for (let lookup = 1; lookup < CONFIG_LOOKUP_PROBE_EVERY; lookup += 1) {
      await expect(listing.listEntries(`/USB2/${lookup}`)).resolves.toEqual([]);
    }
    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    await expect(listing.listEntries("/USB2/probe")).resolves.toHaveLength(1);
    await expect(listing.listEntries("/USB2/after")).resolves.toHaveLength(1);

    expect(listFtpDirectory).toHaveBeenCalledTimes(3);
  });

  it("waits for one lookup before starting the next, so the first failure is seen first", async () => {
    const source = createUltimateSourceLocation();
    let rejectFirst: (error: Error) => void = () => undefined;
    vi.mocked(listFtpDirectory).mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
    const listing = createConfigListing(source);

    const first = listing.listEntries("/USB2/One");
    const second = listing.listEntries("/USB2/Two");
    await Promise.resolve();
    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("timed out"));

    await expect(first).rejects.toThrow("timed out");
    await expect(second).resolves.toEqual([]);
    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
  });

  it("names the skipped lookups once, including the one that failed", async () => {
    const listing = createConfigListing(createUltimateSourceLocation());
    expect(listing.skippedNotice()).toBe("");
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("failed to connect"));

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow();

    expect(listing.skippedLookups()).toBe(1);
    expect(listing.skippedNotice()).toBe("Settings files were not looked up while the device could not be reached.");
  });

  it("keeps asking after a failure that is not about the connection", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("550 No such directory"));
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("550");
    await expect(listing.listEntries("/USB2/Two")).resolves.toHaveLength(1);
  });

  it("lists as usual when the target is a simulated device, whatever the radios say", async () => {
    simulatedDevice.mockReturnValue(true);
    networkOffline.mockReturnValue(true);
    vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);
    const listing = createConfigListing(createUltimateSourceLocation());

    await expect(listing.listEntries("/USB2/Games")).resolves.toHaveLength(1);
    expect(listing.skippedLookups()).toBe(0);
  });

  it("never skips a source that is not on the device", async () => {
    networkOffline.mockReturnValue(true);
    const listEntries = vi.fn(async () => []);
    const listing = createConfigListing({ type: "local", listEntries });

    await listing.listEntries("/music");

    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it("runs lookups together once one has been answered", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    const releases: Array<() => void> = [];
    vi.mocked(listFtpDirectory).mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve({ entries: [] } as never))),
    );

    const lookups = [listing.listEntries("/USB2/A"), listing.listEntries("/USB2/B"), listing.listEntries("/USB2/C")];
    await Promise.resolve();
    await Promise.resolve();

    expect(listFtpDirectory).toHaveBeenCalledTimes(4);
    releases.forEach((release) => release());
    await Promise.all(lookups);
  });

  it("goes back to one lookup at a time after a connection failure", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("timed out"));
    await expect(listing.listEntries("/USB2/Down")).rejects.toThrow("timed out");

    await expect(Promise.all([listing.listEntries("/USB2/A"), listing.listEntries("/USB2/B")])).resolves.toEqual([
      [],
      [],
    ]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(2);
  });

  it("stops marking the device unreachable when a later check is answered with a refusal", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("timed out"));
    const listing = createConfigListing(source);
    await expect(listing.listEntries("/USB2/0")).rejects.toThrow();
    for (let lookup = 1; lookup < CONFIG_LOOKUP_PROBE_EVERY; lookup += 1) await listing.listEntries(`/USB2/${lookup}`);
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("550 No such directory"));
    await expect(listing.listEntries("/USB2/probe")).rejects.toThrow("550");
    vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);

    await expect(listing.listEntries("/USB2/after")).resolves.toHaveLength(1);
  });

  it("logs the skipped lookups once however often the notice is asked for", async () => {
    vi.mocked(addLog).mockClear();
    const listing = createConfigListing(createUltimateSourceLocation());
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("failed to connect"));
    await expect(listing.listEntries("/USB2/One")).rejects.toThrow();

    listing.skippedNotice();
    listing.skippedNotice();

    expect(vi.mocked(addLog).mock.calls.filter(([level]) => level === "warn")).toHaveLength(1);
  });

  it("does not ask the device once the add has been canceled", async () => {
    const controller = new AbortController();
    const listing = createConfigListing(createUltimateSourceLocation(), controller.signal);
    controller.abort();

    await expect(listing.listEntries("/USB2/One")).rejects.toMatchObject({ name: "AbortError" });

    expect(listFtpDirectory).not.toHaveBeenCalled();
  });

  it("answers a trailing-slash request from the entries the folder walk just listed", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await source.listEntries("/USB2/Games");
    vi.mocked(listFtpDirectory).mockClear();

    await expect(source.listEntries("/USB2/Games/")).resolves.toHaveLength(1);

    expect(listFtpDirectory).not.toHaveBeenCalled();
  });

  it("does not run lookups together after a 421 reply, however the client words it", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("FTP list failed: 421 Too many FTP connections"));
    const listing = createConfigListing(source);
    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("421");

    await expect(Promise.all([listing.listEntries("/USB2/A"), listing.listEntries("/USB2/B")])).resolves.toEqual([
      [],
      [],
    ]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    expect(listing.skippedLookups()).toBe(3);
  });

  it("counts an unrecognized failure as a skipped lookup and does not take it for an answer from the device", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("Something unexpected happened"));
    const listing = createConfigListing(source);

    await expect(listing.listEntries("/USB2/One")).rejects.toThrow("unexpected");
    await expect(listing.listEntries("/USB2/Two")).resolves.toEqual([]);

    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    expect(listing.skippedLookups()).toBe(2);
  });

  it("keeps the device marked unreachable when a lookup that started before the failure succeeds afterwards", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    let finishStale: () => void = () => undefined;
    vi.mocked(listFtpDirectory).mockImplementationOnce(
      () => new Promise((resolve) => (finishStale = () => resolve({ entries: [entry] } as never))),
    );
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("timed out"));
    const stale = listing.listEntries("/USB2/Stale");
    await expect(listing.listEntries("/USB2/Down")).rejects.toThrow("timed out");

    finishStale();
    await stale;

    await expect(listing.listEntries("/USB2/After")).resolves.toEqual([]);
    expect(listFtpDirectory).toHaveBeenCalledTimes(3);
  });

  it.each(["FTP list failed: getaddrinfo ENOTFOUND u64", "getaddrinfo EAI_AGAIN u64"])(
    "asks again every few lookups after the name failure %s, as after any lost connection",
    async (message) => {
      const source = createUltimateSourceLocation();
      vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error(message));
      const listing = createConfigListing(source);
      await expect(listing.listEntries("/USB2/0")).rejects.toThrow();
      vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);
      for (let lookup = 1; lookup < CONFIG_LOOKUP_PROBE_EVERY; lookup += 1) {
        await expect(listing.listEntries(`/USB2/${lookup}`)).resolves.toEqual([]);
      }
      expect(listFtpDirectory).toHaveBeenCalledTimes(1);

      await expect(listing.listEntries("/USB2/probe")).resolves.toHaveLength(1);
      await expect(listing.listEntries("/USB2/after")).resolves.toHaveLength(1);
    },
  );

  it("marks the device reachable when a lookup that started after a slower failing lookup began is answered", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    let failSlow: () => void = () => undefined;
    let answerFast: () => void = () => undefined;
    vi.mocked(listFtpDirectory).mockImplementationOnce(
      () => new Promise((_, reject) => (failSlow = () => reject(new Error("timed out")))),
    );
    vi.mocked(listFtpDirectory).mockImplementationOnce(
      () => new Promise((resolve) => (answerFast = () => resolve({ entries: [entry] } as never))),
    );
    const slow = listing.listEntries("/USB2/Slow");
    const fast = listing.listEntries("/USB2/Fast");

    failSlow();
    await expect(slow).rejects.toThrow("timed out");
    answerFast();
    await fast;

    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await expect(listing.listEntries("/USB2/After")).resolves.toHaveLength(1);
    expect(listFtpDirectory).toHaveBeenCalledTimes(4);
  });

  it("stops waiting for a lookup that was already sent when the add is canceled", async () => {
    const controller = new AbortController();
    vi.mocked(listFtpDirectory).mockImplementation(() => new Promise(() => undefined));
    const listing = createConfigListing(createUltimateSourceLocation(), controller.signal);
    const lookup = listing.listEntries("/USB2/Slow");
    await Promise.resolve();

    controller.abort();

    await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    expect(listing.skippedLookups()).toBe(0);
  });

  it("rejects with an AbortError when the runtime has no DOMException", async () => {
    const previousDomException = globalThis.DOMException;
    vi.stubGlobal("DOMException", undefined);
    try {
      const controller = new AbortController();
      vi.mocked(listFtpDirectory).mockImplementation(() => new Promise(() => undefined));
      const listing = createConfigListing(createUltimateSourceLocation(), controller.signal);
      const lookup = listing.listEntries("/USB2/Slow");
      await Promise.resolve();

      controller.abort();

      await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.stubGlobal("DOMException", previousDomException);
    }
  });

  it("answers a path with repeated slashes from the entries cached for the folder", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await source.listEntries("/USB2/Games");
    vi.mocked(listFtpDirectory).mockClear();
    networkOffline.mockReturnValue(true);

    await expect(source.listEntries("/USB2//Games//")).resolves.toHaveLength(1);
    expect(source.peekCachedEntries?.("/USB2//Games//")).toHaveLength(1);
    expect(listFtpDirectory).not.toHaveBeenCalled();
  });

  it("keeps the device marked unreachable when a reply from a lookup that started before the failure arrives afterwards", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    let replyLate: () => void = () => undefined;
    vi.mocked(listFtpDirectory).mockImplementationOnce(
      () => new Promise((_, reject) => (replyLate = () => reject(new Error("550 No such directory")))),
    );
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("timed out"));
    const late = listing.listEntries("/USB2/Late");
    await expect(listing.listEntries("/USB2/Down")).rejects.toThrow("timed out");

    replyLate();
    await expect(late).rejects.toThrow("550");

    await expect(listing.listEntries("/USB2/After")).resolves.toEqual([]);
  });

  it("does not mark the device unreachable again for a failure from a lookup that started before the last success", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [] } as never);
    const listing = createConfigListing(source);
    await listing.listEntries("/USB2/First");
    let failLate: () => void = () => undefined;
    vi.mocked(listFtpDirectory).mockImplementationOnce(
      () => new Promise((_, reject) => (failLate = () => reject(new Error("timed out")))),
    );
    const late = listing.listEntries("/USB2/Late");
    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await listing.listEntries("/USB2/Fresh");

    failLate();
    await expect(late).rejects.toThrow("timed out");

    vi.mocked(listFtpDirectory).mockResolvedValueOnce({ entries: [entry] } as never);
    await expect(listing.listEntries("/USB2/After")).resolves.toHaveLength(1);
    expect(listFtpDirectory).toHaveBeenCalledTimes(4);
  });

  it("runs lookups together from the start when the scan of the add has already been answered by the device", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(listFtpDirectory).mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve({ entries: [] } as never))),
    );
    const listing = createConfigListing(createUltimateSourceLocation());
    listing.noteDeviceAnswered();

    const lookups = [listing.listEntries("/USB2/A"), listing.listEntries("/USB2/B")];
    await Promise.resolve();
    await Promise.resolve();

    expect(listFtpDirectory).toHaveBeenCalledTimes(2);
    releases.forEach((release) => release());
    await Promise.all(lookups);
  });

  it("asks again for a songlengths folder on its own, shorter schedule while settings lookups keep the long one", async () => {
    const source = createUltimateSourceLocation();
    vi.mocked(listFtpDirectory).mockRejectedValueOnce(new Error("timed out"));
    const listing = createConfigListing(source);
    await expect(listing.listSonglengthsFolder("/USB2/0")).rejects.toThrow();
    vi.mocked(listFtpDirectory).mockResolvedValue({ entries: [entry] } as never);

    for (let lookup = 1; lookup < SONGLENGTHS_LOOKUP_PROBE_EVERY; lookup += 1) {
      await expect(listing.listSonglengthsFolder(`/USB2/${lookup}`)).resolves.toEqual([]);
    }
    expect(listFtpDirectory).toHaveBeenCalledTimes(1);
    await expect(listing.listSonglengthsFolder("/USB2/probe")).resolves.toHaveLength(1);
    await expect(listing.listEntries("/USB2/after")).resolves.toHaveLength(1);
  });

  it("names what was not looked up for the kind of add", async () => {
    vi.mocked(listFtpDirectory).mockRejectedValue(new Error("timed out"));
    const settingsOnly = createConfigListing(createUltimateSourceLocation());
    const withSonglengths = createConfigListing(createUltimateSourceLocation(), undefined, { songlengths: true });
    await expect(settingsOnly.listEntries("/USB2/One")).rejects.toThrow();
    await expect(withSonglengths.listEntries("/USB2/One")).rejects.toThrow();

    expect(settingsOnly.skippedNotice()).toBe(CONFIG_LOOKUP_SKIPPED_NOTICE);
    expect(withSonglengths.skippedNotice()).toBe(SONGLENGTHS_LOOKUP_SKIPPED_NOTICE);
  });
});
