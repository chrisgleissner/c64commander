/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { VicPalette } from "@/generated/vicPalettes";
import { getC64API } from "@/lib/c64api";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import { listFtpDirectory, makeFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { resolveFtpConnectionOptions } from "@/lib/ftp/ftpConfig";
import { addLog } from "@/lib/logging";
import { REFERENCE_VIC_PALETTE } from "@/lib/streams/vicPalette";
import { parseVpl } from "@/lib/streams/vpl";

/**
 * The machine's own palette: how it is stored, read and changed.
 *
 * The C64's video output carries real colors, unlike the mirror the app paints, so this is the
 * only palette anyone in the room sees. The firmware keeps it as ONE config item plus ONE file:
 *
 *   `U64 Specific Settings` / `Palette Definition` holds a bare FILENAME — never a path — naming a
 *   `.vpl` inside `/flash/data`, and an empty value means the built-in palette. The option list the
 *   device reports is that directory, enumerated (`U64Config::list_palettes`). Writing the item
 *   applies the palette immediately: the REST handler ends at `at_close_config()`, which
 *   effectuates, and effectuating reloads the file into the palette registers — both the RGB bank
 *   and the YUV bank, so HDMI and the analog outputs change together.
 *
 * Two consequences shape everything below.
 *
 * The value is a filename, so reading the machine's palette means reading `/flash/data/<value>`.
 * Treating it as a path — which is how it looks — silently fails on every real device, because no
 * such relative path resolves, and leaves the app painting the built-in palette while claiming to
 * follow the machine.
 *
 * `/flash/data` need not exist. The firmware creates it only when a palette is applied from the
 * machine's own file browser, and an upload into a directory that is not there fails rather than
 * creating it, so installing a palette has to create the directory first.
 */

export const PALETTE_CATEGORY = "U64 Specific Settings";
export const PALETTE_ITEM = "Palette Definition";

/**
 * `/flash/data` as the FTP server spells it.
 *
 * The firmware writes the constant lower-case, but the FileManager root entry is registered as
 * `Flash` and listings echo the node's real name, so this is the spelling a user sees.
 */
export const DEVICE_PALETTE_DIRECTORY = "/Flash/data";

/** Empty means the firmware's own built-in palette, which is what `Default` renders. */
export const DEVICE_FIRMWARE_PALETTE_VALUE = "";

/**
 * The firmware truncates `Palette Definition` at 30 characters and marks the cut with `*`, so a
 * longer name would name a file that does not exist and silently do nothing.
 */
export const DEVICE_PALETTE_FILENAME_MAX = 30;

/**
 * How a palette read off the machine is identified once it is in the app.
 *
 * These palettes are not in the built-in table, so their id has to say where to get them from
 * again. A stored id of `device:mine.vpl` is enough to re-read the file on the next cold start,
 * which is what lets a device palette be a lasting choice rather than one that survives only until
 * the app is closed.
 */
export const DEVICE_PALETTE_ID_PREFIX = "device:";

export const devicePaletteId = (filename: string): string => `${DEVICE_PALETTE_ID_PREFIX}${filename}`;

/** The file behind a device palette id, or "" for any other id. */
export const devicePaletteIdFilename = (id: string): string =>
  id.startsWith(DEVICE_PALETTE_ID_PREFIX) ? id.slice(DEVICE_PALETTE_ID_PREFIX.length) : "";

export const devicePaletteFilePath = (filename: string): string =>
  `${DEVICE_PALETTE_DIRECTORY}/${filename.replace(/^\/+/, "")}`;

export const devicePaletteFileName = (palette: VicPalette): string => `${palette.id}.vpl`;

/**
 * True when a palette is the one the machine already renders without any file.
 *
 * `Default` is the C64 Ultimate palette, byte for byte, so installing it would upload a file to say
 * what an empty setting already says. Selecting the empty value instead leaves nothing behind in
 * flash and is what the firmware itself does.
 */
export const isFirmwareDefaultPalette = (palette: VicPalette): boolean => palette.id === REFERENCE_VIC_PALETTE.id;

/** Renders a palette as a VICE `.vpl` file, the only format the machine reads. */
export const formatVpl = (palette: VicPalette): string => {
  const lines = [
    "# VICE Palette file",
    "#",
    "# Syntax:",
    "# Red Green Blue",
    "#",
    "# TYPE:VICII",
    `# NAME:${palette.name}`,
    `# DESC:${palette.description}`,
    "# Written by C64 Commander",
    "",
  ];
  palette.rgb.forEach((entry) => {
    lines.push(entry.map((channel) => channel.toString(16).toUpperCase().padStart(2, "0")).join(" "));
  });
  return `${lines.join("\n")}\n`;
};

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (base64: string): string => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

/** The filename `Palette Definition` currently holds, or "" for the firmware's own palette. */
export const readDevicePaletteFilename = (response: unknown): string => {
  if (!response || typeof response !== "object") return DEVICE_FIRMWARE_PALETTE_VALUE;
  const category = (response as Record<string, unknown>)[PALETTE_CATEGORY];
  if (!category || typeof category !== "object") return DEVICE_FIRMWARE_PALETTE_VALUE;
  const categoryRecord = category as Record<string, unknown>;
  const items = categoryRecord.items;
  const item =
    items && typeof items === "object"
      ? (items as Record<string, unknown>)[PALETTE_ITEM]
      : categoryRecord[PALETTE_ITEM];
  const value = extractConfigValue(item);
  return typeof value === "string" ? value.trim() : DEVICE_FIRMWARE_PALETTE_VALUE;
};

/**
 * The `.vpl` files installed on the machine, from the device's own option list.
 *
 * Enumerating over FTP would work too, but the device already reports exactly the set it is willing
 * to accept, and a file it does not list is a file selecting it would not load. The empty entry
 * that always leads the list is the built-in palette and is dropped here — it is not a file.
 */
export const readDevicePaletteFilenames = (response: unknown): string[] => {
  if (!response || typeof response !== "object") return [];
  const category = (response as Record<string, unknown>)[PALETTE_CATEGORY];
  if (!category || typeof category !== "object") return [];
  const categoryRecord = category as Record<string, unknown>;
  const items = categoryRecord.items;
  const item =
    items && typeof items === "object"
      ? (items as Record<string, unknown>)[PALETTE_ITEM]
      : categoryRecord[PALETTE_ITEM];
  if (item === undefined) return [];
  const normalized = normalizeConfigItem(item);
  const presets = normalized.details?.presets ?? [];
  return presets.map((preset) => preset.trim()).filter((preset) => preset.length > 0);
};

/** Reads and parses one `.vpl` from the machine. */
export const readDevicePalette = async (filename: string, timeoutMs = 3_000): Promise<VicPalette> => {
  const connection = await resolveFtpConnectionOptions();
  const path = devicePaletteFilePath(filename);
  const result = await readFtpFile({
    ...connection,
    path,
    timeoutMs,
    __c64uIntent: "background",
  });
  return parseVpl(fromBase64(result.data), devicePaletteId(filename));
};

const directoryExists = async (
  connection: Awaited<ReturnType<typeof resolveFtpConnectionOptions>>,
): Promise<boolean> => {
  try {
    await listFtpDirectory({ ...connection, path: DEVICE_PALETTE_DIRECTORY });
    return true;
  } catch {
    return false;
  }
};

/**
 * Puts a palette file on the machine, and reports the filename to select it by.
 *
 * Skips the upload when the device already lists a file of that name, so choosing the same palette
 * twice costs one config write rather than a second flash-filesystem write.
 */
export const installPaletteOnDevice = async (
  palette: VicPalette,
  alreadyInstalled: readonly string[] = [],
): Promise<string> => {
  const filename = devicePaletteFileName(palette);
  if (filename.length > DEVICE_PALETTE_FILENAME_MAX) {
    throw new Error(
      `Palette file name "${filename}" is longer than the ${DEVICE_PALETTE_FILENAME_MAX} characters the C64 can store`,
    );
  }
  if (alreadyInstalled.includes(filename)) return filename;

  const connection = await resolveFtpConnectionOptions();
  if (!(await directoryExists(connection))) {
    await makeFtpDirectory({ ...connection, path: DEVICE_PALETTE_DIRECTORY });
    addLog("info", "Created the C64's palette folder", { path: DEVICE_PALETTE_DIRECTORY });
  }
  await writeFtpFile({
    ...connection,
    path: devicePaletteFilePath(filename),
    data: toBase64(formatVpl(palette)),
  });
  return filename;
};

/**
 * Makes the machine render this palette.
 *
 * Installs the file first when one is needed, then writes the config item, which effectuates on the
 * device and changes the picture on the television straight away. Whether the choice outlives a
 * power cycle is not decided here — that is the app-wide flash-persistence setting, applied by the
 * same funnel every other config write goes through.
 */
export const applyPaletteToDevice = async (
  palette: VicPalette,
  alreadyInstalled: readonly string[] = [],
): Promise<string> => {
  const value = isFirmwareDefaultPalette(palette)
    ? DEVICE_FIRMWARE_PALETTE_VALUE
    : await installPaletteOnDevice(palette, alreadyInstalled);
  await getC64API().setConfigValue(PALETTE_CATEGORY, PALETTE_ITEM, value);
  return value;
};
