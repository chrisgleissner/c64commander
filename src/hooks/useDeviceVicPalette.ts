/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { loadVicPaletteId } from "@/lib/config/appSettings";
import { addLog } from "@/lib/logging";
import { useC64ConfigItem, useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { useAppVisibilityState } from "@/hooks/useScreenActivity";
import {
  PALETTE_CATEGORY,
  PALETTE_ITEM,
  devicePaletteIdFilename,
  readDevicePalette,
  readDevicePaletteFilename,
} from "@/lib/palettes/devicePalettes";
import {
  DEVICE_VIC_PALETTE_ID,
  U64_FIRMWARE_DEFAULT_VIC_PALETTE,
  setActiveVicPalette,
  setActiveVicPaletteDefinition,
} from "@/lib/streams/vicPalette";
import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

export const useDeviceVicPalette = (): void => {
  const paletteId = useSyncExternalStore(subscribeVicPalettePreference, loadVicPaletteId, loadVicPaletteId);
  const automatic = paletteId === DEVICE_VIC_PALETTE_ID;
  /**
   * A palette that lives on the machine, pinned by the user rather than followed.
   *
   * Its colors are not in the built-in table, so the id alone cannot paint it — the file has to be
   * read again. Doing that here is what makes the choice survive closing the app: on a cold start
   * only the id is in storage, and without this the app would quietly paint Default while the UI
   * showed the device palette as the selected one.
   */
  const pinnedFilename = devicePaletteIdFilename(paletteId);
  const routingEpoch = useConnectionRoutingEpoch();
  const appVisible = useAppVisibilityState();
  const queryClient = useQueryClient();
  const config = useC64ConfigItem(PALETTE_CATEGORY, PALETTE_ITEM, automatic, {
    intent: "background",
    staleTime: 60_000,
  });
  // A FILENAME, not a path: `Palette Definition` names a file inside `/flash/data`, so it only
  // resolves once that directory is put back in front of it. Reading the raw value as an FTP path
  // fails on every real device and quietly falls back to the built-in palette, which looks exactly
  // like the machine having no palette set.
  const paletteFilename = automatic ? readDevicePaletteFilename(config.data) : pinnedFilename;
  const devicePalette = useQuery({
    queryKey: ["device-vic-palette", routingEpoch, paletteFilename],
    queryFn: () => readDevicePalette(paletteFilename),
    enabled: Boolean(paletteFilename),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!automatic || !appVisible) return;
    void queryClient.invalidateQueries({ queryKey: ["c64-config-item", PALETTE_CATEGORY, PALETTE_ITEM] });
    void queryClient.invalidateQueries({ queryKey: ["device-vic-palette", routingEpoch] });
  }, [appVisible, automatic, queryClient, routingEpoch]);

  useEffect(() => {
    if (devicePalette.data) {
      // Covers both a pinned device palette and the followed one; either way the colors have to
      // come from the file, because the id is not in the built-in table.
      setActiveVicPaletteDefinition(devicePalette.data);
      return;
    }
    if (!automatic && !pinnedFilename) {
      setActiveVicPalette(paletteId);
      return;
    }
    // Following the machine with nothing selected, or a pinned file that is not readable yet or at
    // all. The machine's own built-in palette is the honest answer in every one of those cases.
    setActiveVicPaletteDefinition(U64_FIRMWARE_DEFAULT_VIC_PALETTE);
  }, [automatic, devicePalette.data, paletteId, pinnedFilename]);

  useEffect(() => {
    if (!automatic || !config.error) return;
    addLog("warn", "Device palette configuration unavailable; using Default", {
      message: config.error.message,
    });
  }, [automatic, config.error]);

  useEffect(() => {
    if (!paletteFilename || !devicePalette.error) return;
    addLog("warn", "Device palette unavailable; using Default", {
      filename: paletteFilename,
      message: devicePalette.error.message,
    });
  }, [devicePalette.error, paletteFilename]);
};
