/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VicPalette } from "@/generated/vicPalettes";

const mocks = vi.hoisted(() => ({
  configItem: vi.fn(),
  connectionEpoch: vi.fn(),
  applyPaletteToDevice: vi.fn(),
  readDevicePalette: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64ConfigItem: mocks.configItem,
  useConnectionRoutingEpoch: mocks.connectionEpoch,
}));

// Only the two calls that talk to the machine are replaced; the readers that turn a config-item
// response into filenames stay real, because the shape they accept is part of what is under test.
vi.mock("@/lib/palettes/devicePalettes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palettes/devicePalettes")>()),
  applyPaletteToDevice: mocks.applyPaletteToDevice,
  readDevicePalette: mocks.readDevicePalette,
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

import { useScreenColors } from "@/hooks/useScreenColors";
import { loadPaletteTarget, loadVicPaletteId, savePaletteTarget } from "@/lib/config/appSettings";
import { PALETTE_CATEGORY, PALETTE_ITEM } from "@/lib/palettes/devicePalettes";
import { DEVICE_VIC_PALETTE_ID, VIC_PALETTES, __resetVicPalette, activeVicPalette } from "@/lib/streams/vicPalette";

const COOL = VIC_PALETTES.find((palette) => palette.id === "cool")!;
const NIGHT = VIC_PALETTES.find((palette) => palette.id === "night")!;

/** A `Palette Definition` item as the firmware reports it: a bare filename plus its option list. */
const configResponse = (value: string, presets: string[]) => ({
  [PALETTE_CATEGORY]: {
    items: {
      [PALETTE_ITEM]: { value, details: { presets } },
    },
  },
});

const devicePalette = (id: string): VicPalette => ({
  id,
  name: id,
  description: `read from ${id}`,
  rgb: COOL.rgb,
});

let queryClient: QueryClient;

const createWrapper = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const renderScreenColors = (options?: { enabled?: boolean }) =>
  renderHook(() => (options ? useScreenColors(options) : useScreenColors()), { wrapper: createWrapper() });

describe("useScreenColors", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
    mocks.connectionEpoch.mockReturnValue(0);
    mocks.configItem.mockReturnValue({ data: configResponse("", []) });
    mocks.applyPaletteToDevice.mockResolvedValue("cool.vpl");
    mocks.readDevicePalette.mockImplementation(async (filename: string) =>
      devicePalette(filename.replace(/\.vpl$/, "")),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("the target matrix", () => {
    it("changes only the app's own palette when the target is local", async () => {
      const { result } = renderScreenColors();
      expect(result.current.target).toBe("local");

      await act(async () => {
        await expect(result.current.apply(COOL)).resolves.toBe(true);
      });

      expect(activeVicPalette().id).toBe("cool");
      expect(loadVicPaletteId()).toBe("cool");
      expect(mocks.applyPaletteToDevice).not.toHaveBeenCalled();
    });

    it("paints a palette read off the machine, which no id alone can resolve", async () => {
      // Its colors are not in the built-in table, so storing the id is not enough: resolving an
      // unknown id yields Default, and the picture would then disagree with the tick in the list.
      const fromDevice = { ...COOL, id: "device:mine.vpl", name: "mine.vpl" };
      const { result } = renderScreenColors();

      await act(async () => {
        await expect(result.current.apply(fromDevice)).resolves.toBe(true);
      });

      expect(loadVicPaletteId()).toBe("device:mine.vpl");
      expect(activeVicPalette().id).toBe("device:mine.vpl");
      expect(activeVicPalette().rgb).toEqual(COOL.rgb);
    });

    it("changes only the machine when the target is remote", async () => {
      savePaletteTarget("remote");
      const { result } = renderScreenColors();
      expect(result.current.target).toBe("remote");

      await act(async () => {
        await expect(result.current.apply(COOL)).resolves.toBe(true);
      });

      expect(mocks.applyPaletteToDevice).toHaveBeenCalledWith(COOL, []);
      // The app is still following the machine, and still painting what it was painting.
      expect(loadVicPaletteId()).toBe(DEVICE_VIC_PALETTE_ID);
      expect(activeVicPalette().id).toBe("default");
    });

    it("changes both the app and the machine when the target is both", async () => {
      savePaletteTarget("both");
      const { result } = renderScreenColors();

      await act(async () => {
        await expect(result.current.apply(NIGHT)).resolves.toBe(true);
      });

      expect(activeVicPalette().id).toBe("night");
      expect(loadVicPaletteId()).toBe("night");
      expect(mocks.applyPaletteToDevice).toHaveBeenCalledWith(NIGHT, []);
    });

    it("passes the installed filenames to the device apply so a reinstall is skipped", async () => {
      savePaletteTarget("remote");
      mocks.configItem.mockReturnValue({ data: configResponse("cool.vpl", ["", "cool.vpl"]) });
      const { result } = renderScreenColors();

      await act(async () => {
        await result.current.apply(COOL);
      });

      expect(mocks.applyPaletteToDevice).toHaveBeenCalledWith(COOL, ["cool.vpl"]);
    });

    it("invalidates the palette config queries and nothing else after a device apply", async () => {
      savePaletteTarget("remote");
      const { result } = renderScreenColors();

      queryClient.setQueryData(["c64-config-item", PALETTE_CATEGORY, PALETTE_ITEM], { stale: true });
      queryClient.setQueryData(["c64-config-items", PALETTE_CATEGORY, ["a"]], { stale: true });
      queryClient.setQueryData(["c64-config-item", "Audio Output Settings", "Volume"], { stale: true });
      queryClient.setQueryData(["something-else"], { stale: true });
      // A query key that is not an array cannot be produced through `useQuery`, so it is built on
      // the cache directly to exercise the predicate's own guard.
      queryClient.getQueryCache().build(queryClient, { queryKey: "not-an-array" as never });

      await act(async () => {
        await result.current.apply(COOL);
      });

      const invalidated = queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.isInvalidated)
        .map((query) => (Array.isArray(query.queryKey) ? query.queryKey[0] : query.queryKey));
      expect(invalidated).toEqual(expect.arrayContaining(["c64-config-item", "c64-config-items"]));
      expect(invalidated).not.toContain("something-else");
      expect(invalidated).not.toContain("not-an-array");
    });
  });

  describe("the selection", () => {
    it("hands the choice back to the machine when following it", async () => {
      const { result } = renderScreenColors();
      await act(async () => {
        await result.current.apply(COOL);
      });
      expect(result.current.following).toBe(false);
      expect(result.current.selectedId).toBe("cool");

      act(() => result.current.followDevice());

      expect(result.current.selectedId).toBe(DEVICE_VIC_PALETTE_ID);
      expect(result.current.following).toBe(true);
    });

    it("persists a new target and reports it back", () => {
      const { result } = renderScreenColors();

      act(() => result.current.setTarget("both"));

      expect(loadPaletteTarget()).toBe("both");
      expect(result.current.target).toBe("both");
    });
  });

  describe("what the machine reports", () => {
    it("derives the filenames and the current file from an items-wrapped response", () => {
      mocks.configItem.mockReturnValue({
        data: configResponse("mine.vpl", ["", "mine.vpl", " spaced.vpl "]),
      });
      const { result } = renderScreenColors();

      expect(result.current.deviceFilename).toBe("mine.vpl");
      expect(result.current.installedFilenames).toEqual(["mine.vpl", "spaced.vpl"]);
    });

    it("derives the same from a response without an items wrapper", () => {
      mocks.configItem.mockReturnValue({
        data: {
          [PALETTE_CATEGORY]: {
            [PALETTE_ITEM]: { value: "direct.vpl", details: { presets: ["", "direct.vpl"] } },
          },
        },
      });
      const { result } = renderScreenColors();

      expect(result.current.deviceFilename).toBe("direct.vpl");
      expect(result.current.installedFilenames).toEqual(["direct.vpl"]);
    });

    it("reports no filenames at all when the config item is unavailable", () => {
      mocks.configItem.mockReturnValue({ error: new Error("no configuration") });
      const { result } = renderScreenColors();

      expect(result.current.deviceFilename).toBe("");
      expect(result.current.installedFilenames).toEqual([]);
      expect(result.current.devicePalettes).toEqual([]);
    });
  });

  describe("which palette the machine itself is on", () => {
    /**
     * A different question from which palette is selected. With the Remote target the app's own
     * selection does not move, so this is the only thing that says where the palette landed.
     */
    const byId = (id: string) => VIC_PALETTES.find((palette) => palette.id === id)!;

    it("matches a built-in palette against the file name the machine reports", () => {
      mocks.configItem.mockReturnValue({ data: configResponse("night.vpl", ["", "night.vpl"]) });
      const { result } = renderScreenColors();

      expect(result.current.isOnDevice(byId("night"))).toBe(true);
      expect(result.current.isOnDevice(byId("cool"))).toBe(false);
    });

    it("treats an empty setting as Default, because that is the palette the firmware renders", () => {
      mocks.configItem.mockReturnValue({ data: configResponse("", [""]) });
      const { result } = renderScreenColors();

      expect(result.current.isOnDevice(byId("default"))).toBe(true);
      expect(result.current.isOnDevice(byId("night"))).toBe(false);
    });

    it("matches a palette read off the machine by the file behind its id", () => {
      mocks.configItem.mockReturnValue({ data: configResponse("mine.vpl", ["", "mine.vpl"]) });
      const { result } = renderScreenColors();
      const fromDevice = { ...byId("cool"), id: "device:mine.vpl" };
      const otherDevicePalette = { ...byId("cool"), id: "device:other.vpl" };

      expect(result.current.isOnDevice(fromDevice)).toBe(true);
      expect(result.current.isOnDevice(otherDevicePalette)).toBe(false);
    });
  });

  describe("the palettes already on the machine", () => {
    it("reads the files the app does not ship and drops one it cannot read", async () => {
      mocks.configItem.mockReturnValue({
        data: configResponse("mine.vpl", ["", "cool.vpl", "mine.vpl", "broken.vpl", "other.vpl"]),
      });
      mocks.readDevicePalette.mockImplementation(async (filename: string) => {
        if (filename === "broken.vpl") throw new Error("FTP request failed");
        return devicePalette(filename.replace(/\.vpl$/, ""));
      });
      const { result } = renderScreenColors();

      await waitFor(() => expect(result.current.devicePalettes).toHaveLength(2));
      expect(result.current.devicePalettes.map((palette) => palette.id)).toEqual(["mine", "other"]);
      // `cool.vpl` is a built-in the app already lists, so it is never read.
      expect(mocks.readDevicePalette).not.toHaveBeenCalledWith("cool.vpl");
      expect(mocks.addLog).toHaveBeenCalledWith("warn", "Could not read a palette installed on the C64", {
        filename: "broken.vpl",
        message: "FTP request failed",
      });
    });

    it("does not read anything when the machine lists no palette files", async () => {
      const { result } = renderScreenColors();

      await waitFor(() => expect(result.current.devicePalettesLoading).toBe(false));
      expect(result.current.devicePalettes).toEqual([]);
      expect(mocks.readDevicePalette).not.toHaveBeenCalled();
    });

    it("does not read anything while the control is closed", async () => {
      mocks.configItem.mockReturnValue({ data: configResponse("mine.vpl", ["", "mine.vpl"]) });
      const { result } = renderScreenColors({ enabled: false });

      await waitFor(() => expect(result.current.devicePalettesLoading).toBe(false));
      expect(result.current.devicePalettes).toEqual([]);
      expect(mocks.readDevicePalette).not.toHaveBeenCalled();
    });

    it("reports the read as in progress until the files arrive", async () => {
      mocks.configItem.mockReturnValue({ data: configResponse("mine.vpl", ["", "mine.vpl"]) });
      let resolveRead!: (palette: VicPalette) => void;
      mocks.readDevicePalette.mockReturnValue(
        new Promise<VicPalette>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const { result } = renderScreenColors();

      await waitFor(() => expect(result.current.devicePalettesLoading).toBe(true));
      await act(async () => {
        resolveRead(devicePalette("mine"));
      });
      await waitFor(() => expect(result.current.devicePalettesLoading).toBe(false));
      expect(result.current.devicePalettes.map((palette) => palette.id)).toEqual(["mine"]);
    });
  });

  describe("while a device apply is in flight", () => {
    const deferApply = () => {
      let settle!: { resolve: () => void; reject: (error: Error) => void };
      mocks.applyPaletteToDevice.mockReturnValue(
        new Promise<string>((resolve, reject) => {
          settle = { resolve: () => resolve("cool.vpl"), reject };
        }),
      );
      return settle;
    };

    it("names the palette being applied and clears it when the apply succeeds", async () => {
      savePaletteTarget("remote");
      const settle = deferApply();
      const { result } = renderScreenColors();

      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.apply(COOL);
      });
      await waitFor(() => expect(result.current.applying).toBe("cool"));

      await act(async () => {
        settle.resolve();
        await pending;
      });
      expect(result.current.applying).toBeNull();
    });

    it("clears it when the apply fails, and lets the failure through", async () => {
      savePaletteTarget("remote");
      const settle = deferApply();
      const { result } = renderScreenColors();

      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.apply(COOL);
      });
      await waitFor(() => expect(result.current.applying).toBe("cool"));

      await act(async () => {
        settle.reject(new Error("device refused"));
        await expect(pending).rejects.toThrow("device refused");
      });
      expect(result.current.applying).toBeNull();
    });

    it("never marks a local-only choice as applying", async () => {
      const { result } = renderScreenColors();

      await act(async () => {
        await result.current.apply(COOL);
      });

      expect(result.current.applying).toBeNull();
    });
  });
});
