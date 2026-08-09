/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { VicPalette } from "@/generated/vicPalettes";
import { loadPaletteTarget, loadVicPaletteId, savePaletteTarget, type PaletteTarget } from "@/lib/config/appSettings";
import { useC64ConfigItem, useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { addLog } from "@/lib/logging";
import {
  PALETTE_CATEGORY,
  PALETTE_ITEM,
  applyPaletteToDevice,
  devicePaletteFileName,
  devicePaletteIdFilename,
  isFirmwareDefaultPalette,
  readDevicePalette,
  readDevicePaletteFilename,
  readDevicePaletteFilenames,
} from "@/lib/palettes/devicePalettes";
import {
  DEVICE_VIC_PALETTE_ID,
  VIC_PALETTES,
  activeVicPalette,
  setActiveVicPalette,
  setActiveVicPaletteDefinition,
  subscribeVicPalette,
} from "@/lib/streams/vicPalette";
import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

export type ScreenColorsSelection = typeof DEVICE_VIC_PALETTE_ID | string;

/**
 * Everything the "Screen colors" control needs, in one place.
 *
 * The two palettes it deals with are genuinely separate things and are kept separate here: the one
 * the app paints the mirror with, which is instant and local, and the one the machine renders,
 * which reaches the television and everyone in the room. `target` says which of them a choice
 * lands on — the same question the Play page's "Listen on" asks about a tune.
 */
export const useScreenColors = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const selectedId = useSyncExternalStore(subscribeVicPalettePreference, loadVicPaletteId, loadVicPaletteId);
  const target = useSyncExternalStore(subscribeVicPalettePreference, loadPaletteTarget, loadPaletteTarget);
  const painted = useSyncExternalStore(subscribeVicPalette, activeVicPalette, activeVicPalette);
  const routingEpoch = useConnectionRoutingEpoch();
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState<string | null>(null);

  const config = useC64ConfigItem(PALETTE_CATEGORY, PALETTE_ITEM, enabled, {
    intent: "background",
    staleTime: 60_000,
  });
  const installedFilenames = readDevicePaletteFilenames(config.data);
  const deviceFilename = readDevicePaletteFilename(config.data);

  /**
   * The `.vpl` files on the machine that the app does not already ship.
   *
   * Read one at a time rather than in parallel: the C64U's network stack is unhappy under bursts,
   * and this list is short — most machines have none at all. A file that cannot be read is dropped
   * rather than failing the list, so one bad palette does not hide the rest.
   */
  const devicePalettes = useQuery({
    queryKey: ["device-vic-palette-library", routingEpoch, installedFilenames.join("|")],
    queryFn: async () => {
      const builtInFilenames = new Set(VIC_PALETTES.map((palette) => devicePaletteFileName(palette)));
      const results: VicPalette[] = [];
      for (const filename of installedFilenames) {
        if (builtInFilenames.has(filename)) continue;
        try {
          results.push(await readDevicePalette(filename));
        } catch (error) {
          addLog("warn", "Could not read a palette installed on the C64", {
            filename,
            message: (error as Error).message,
          });
        }
      }
      return results;
    },
    enabled: enabled && installedFilenames.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const setTarget = useCallback((next: PaletteTarget) => {
    savePaletteTarget(next);
  }, []);

  /**
   * Applies a palette to whichever screens the target names.
   *
   * The app half cannot fail and is done first, so a device that has dropped out never costs the
   * user the change they can actually have. The device half reports its own failure.
   */
  const apply = useCallback(
    async (palette: VicPalette): Promise<boolean> => {
      if (target === "local" || target === "both") {
        setActiveVicPalette(palette.id);
        // A palette read off the machine is not in the built-in table, so storing its id is not
        // enough to paint it — `setActiveVicPalette` would resolve the unknown id to Default and
        // the picture would disagree with the tick in the list. Paint the definition we already
        // have; the stored id is what `useDeviceVicPalette` re-reads on the next cold start.
        if (!VIC_PALETTES.some((builtIn) => builtIn.id === palette.id)) {
          setActiveVicPaletteDefinition(palette);
        }
      }
      if (target === "local") return true;

      setApplying(palette.id);
      try {
        await applyPaletteToDevice(palette, installedFilenames);
        await queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            (query.queryKey[0] === "c64-config-item" || query.queryKey[0] === "c64-config-items") &&
            query.queryKey[1] === PALETTE_CATEGORY,
        });
        return true;
      } finally {
        setApplying(null);
      }
    },
    [installedFilenames, queryClient, target],
  );

  /** Hands the choice back to the machine: the app paints whatever the C64 is set to. */
  const followDevice = useCallback(() => {
    setActiveVicPalette(DEVICE_VIC_PALETTE_ID);
  }, []);

  /**
   * Whether the machine itself is currently rendering this palette.
   *
   * Distinct from the selection, and worth showing separately: with the Remote target the app's own
   * choice does not move, so without this nothing in the list would say where the palette landed.
   * An empty `Palette Definition` means the firmware's built-in palette, which is what `Default`
   * renders, so that pair matches too.
   */
  const isOnDevice = useCallback(
    (palette: VicPalette): boolean => {
      const fromDevice = devicePaletteIdFilename(palette.id);
      if (fromDevice) return fromDevice === deviceFilename;
      if (!deviceFilename) return isFirmwareDefaultPalette(palette);
      return devicePaletteFileName(palette) === deviceFilename;
    },
    [deviceFilename],
  );

  return {
    /** `"device"` when the app is following the machine, otherwise a palette id. */
    selectedId: selectedId as ScreenColorsSelection,
    following: selectedId === DEVICE_VIC_PALETTE_ID,
    /** The palette actually on screen right now, device-resolved when following. */
    painted,
    target,
    setTarget,
    apply,
    followDevice,
    applying,
    builtInPalettes: VIC_PALETTES,
    devicePalettes: devicePalettes.data ?? [],
    devicePalettesLoading: devicePalettes.isLoading,
    /** What the machine itself is set to: a `.vpl` filename, or "" for its built-in palette. */
    deviceFilename,
    isOnDevice,
    installedFilenames,
  };
};
