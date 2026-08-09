/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { loadVicPaletteId } from "@/lib/config/appSettings";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { resolveFtpConnectionOptions } from "@/lib/ftp/ftpConfig";
import { addLog } from "@/lib/logging";
import { useC64ConfigItem, useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { useAppVisibilityState } from "@/hooks/useScreenActivity";
import {
  DEVICE_VIC_PALETTE_ID,
  U64_FIRMWARE_DEFAULT_VIC_PALETTE,
  setActiveVicPalette,
  setActiveVicPaletteDefinition,
} from "@/lib/streams/vicPalette";
import { parseVpl } from "@/lib/streams/vpl";
import { subscribeVicPalettePreference } from "@/lib/streams/vicPalettePreference";

const PALETTE_CATEGORY = "U64 Specific Settings";
const PALETTE_ITEM = "Palette Definition";

const readPalettePath = (response: unknown): string => {
  if (!response || typeof response !== "object") return "";
  const category = (response as Record<string, unknown>)[PALETTE_CATEGORY];
  if (!category || typeof category !== "object") return "";
  const categoryRecord = category as Record<string, unknown>;
  const items = categoryRecord.items;
  const item =
    items && typeof items === "object"
      ? (items as Record<string, unknown>)[PALETTE_ITEM]
      : categoryRecord[PALETTE_ITEM];
  const value = extractConfigValue(item);
  return typeof value === "string" ? value.trim() : "";
};

const decodeBase64Text = (base64: string) => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export const useDeviceVicPalette = (): void => {
  const paletteId = useSyncExternalStore(subscribeVicPalettePreference, loadVicPaletteId, loadVicPaletteId);
  const automatic = paletteId === DEVICE_VIC_PALETTE_ID;
  const routingEpoch = useConnectionRoutingEpoch();
  const appVisible = useAppVisibilityState();
  const queryClient = useQueryClient();
  const config = useC64ConfigItem(PALETTE_CATEGORY, PALETTE_ITEM, automatic, {
    intent: "background",
    staleTime: 60_000,
  });
  const palettePath = automatic ? readPalettePath(config.data) : "";
  const devicePalette = useQuery({
    queryKey: ["device-vic-palette", routingEpoch, palettePath],
    queryFn: async () => {
      const connection = await resolveFtpConnectionOptions();
      const result = await readFtpFile({
        ...connection,
        path: palettePath,
        timeoutMs: 3_000,
        __c64uIntent: "background",
      });
      return parseVpl(decodeBase64Text(result.data), `device:${palettePath}`);
    },
    enabled: automatic && Boolean(palettePath),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!automatic || !appVisible) return;
    void queryClient.invalidateQueries({ queryKey: ["c64-config-item", PALETTE_CATEGORY, PALETTE_ITEM] });
    void queryClient.invalidateQueries({ queryKey: ["device-vic-palette", routingEpoch] });
  }, [appVisible, automatic, queryClient, routingEpoch]);

  useEffect(() => {
    if (!automatic) {
      setActiveVicPalette(paletteId);
      return;
    }
    if (devicePalette.data) {
      setActiveVicPaletteDefinition(devicePalette.data);
      return;
    }
    setActiveVicPaletteDefinition(U64_FIRMWARE_DEFAULT_VIC_PALETTE);
  }, [automatic, devicePalette.data, paletteId]);

  useEffect(() => {
    if (!automatic || !config.error) return;
    addLog("warn", "Device palette configuration unavailable; using Default", {
      message: config.error.message,
    });
  }, [automatic, config.error]);

  useEffect(() => {
    if (!automatic || !palettePath || !devicePalette.error) return;
    addLog("warn", "Device palette unavailable; using Default", {
      path: palettePath,
      message: devicePalette.error.message,
    });
  }, [automatic, devicePalette.error, palettePath]);
};
