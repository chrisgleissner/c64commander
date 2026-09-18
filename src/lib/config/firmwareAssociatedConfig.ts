/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the Ultimate firmware itself does with a settings file that sits next to a launched file.
 *
 * The firmware gained this before the app did, so the app has to agree with it rather than invent a
 * second rule. `ConfigIO::S_load_associated_config` takes the launched file's name, replaces
 * everything after the last dot with `.cfg`, looks for that file in the same directory and
 * effectuates it. For a PRG it then tries `.usr` when no `.cfg` is there.
 *
 * Over REST the firmware only does this for `runners:run_prg` and `runners:load_prg`, which go
 * through `FileTypePRG::start_prg`. `runners:run_crt` and `drives:mount` call the cartridge loader
 * and the mounter directly and load no settings file at all, even though the on-screen menu does.
 * Measured on a C64 Ultimate running firmware 1.2RC: setting a config item over REST and then
 * running a PRG with a sibling `.cfg` left the item at the `.cfg` value, while the same test around
 * `run_crt` left it at the value the app had set.
 *
 * So the app resolves settings files for every category and the firmware resolves them for one, and
 * on that one category the firmware gets the last word because it loads its file after the app has
 * finished. {@link firmwareOverridesAppConfig} is what the launch path uses to decide whether it has
 * to keep the firmware out of the decision.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";

/** Tried first, and the only extension the firmware tries for anything other than a program. */
export const FIRMWARE_ASSOCIATED_CONFIG_EXTENSION = "cfg";

/** Tried for a program when no `.cfg` sits beside it. */
export const FIRMWARE_ASSOCIATED_FALLBACK_EXTENSION = "usr";

/** The categories the firmware loads a settings file for when the app launches them over REST. */
export const firmwareAppliesAssociatedConfig = (category: PlayFileCategory | null | undefined) => category === "prg";

/**
 * The firmware's `set_extension`: drop everything from the last dot, then append the new extension.
 * A name with no dot keeps all of itself, so `README` becomes `README.cfg`.
 */
export const replaceFileExtension = (fileName: string, extension: string) =>
  `${fileName.replace(/\.[^.]*$/, "")}.${extension}`;

/**
 * The settings files the firmware would look for beside this file, in the order it tries them.
 * Empty for a category the firmware loads nothing for, so a caller cannot accidentally act on a
 * file the firmware will never read.
 */
export const firmwareAssociatedConfigNames = (fileName: string, category: PlayFileCategory | null | undefined) => {
  if (!firmwareAppliesAssociatedConfig(category)) return [] as string[];
  return [
    replaceFileExtension(fileName, FIRMWARE_ASSOCIATED_CONFIG_EXTENSION),
    replaceFileExtension(fileName, FIRMWARE_ASSOCIATED_FALLBACK_EXTENSION),
  ];
};

/**
 * The name of the file the firmware would actually load, given what is in the directory, or null
 * when it would load nothing. `siblingFileNames` is every file name in the launched file's own
 * directory; matching ignores case because the device's FAT volumes do.
 */
export const firmwareAssociatedConfigFor = ({
  fileName,
  category,
  siblingFileNames,
}: {
  fileName: string;
  category: PlayFileCategory | null | undefined;
  siblingFileNames: readonly string[];
}) => {
  const present = new Set(siblingFileNames.map((name) => name.trim().toLowerCase()));
  return firmwareAssociatedConfigNames(fileName, category).find((name) => present.has(name.toLowerCase())) ?? null;
};

/**
 * Whether launching this file by path would let the firmware undo the app's own settings decision.
 *
 * True when the firmware would load a settings file and that is not exactly what the app was going
 * to do: the user declined a settings file, or chose a different one, or kept the associated file
 * and edited values on top of it. In all three the firmware's load lands after the app's and wins,
 * so the launch has to reach the machine some other way for the user's choice to survive.
 *
 * `siblingFileNames` is every file name in the launched file's own directory, or null when the
 * caller does not know — a playlist item restored from storage carries its settings choice but not
 * the discovery result behind it. Not knowing is read as "the firmware will find one", because the
 * cost of being wrong that way is one upload and the cost of being wrong the other way is a user's
 * choice being silently undone.
 */
export const firmwareOverridesAppConfig = ({
  fileName,
  category,
  siblingFileNames,
  appConfigFileName,
  hasOverrides,
}: {
  fileName: string;
  category: PlayFileCategory | null | undefined;
  siblingFileNames?: readonly string[] | null;
  appConfigFileName: string | null | undefined;
  hasOverrides: boolean;
}) => {
  if (!firmwareAppliesAssociatedConfig(category)) return false;
  const isAppChoice = (name: string) => (appConfigFileName ?? "").toLowerCase() === name.toLowerCase();

  if (!siblingFileNames) {
    // Any of the names the firmware would try is the app's own choice, so either file it finds is
    // the file the app was going to apply.
    return hasOverrides || !firmwareAssociatedConfigNames(fileName, category).some(isAppChoice);
  }

  const firmwareFileName = firmwareAssociatedConfigFor({ fileName, category, siblingFileNames });
  if (!firmwareFileName) return false;
  return hasOverrides || !isAppChoice(firmwareFileName);
};
