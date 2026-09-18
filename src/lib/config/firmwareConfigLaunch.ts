/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether a playlist item has to be launched in a way that keeps the firmware out of its settings.
 *
 * `runners:run_prg` and `runners:load_prg` make the firmware load the program's own `.cfg` (or
 * `.usr`) after the app has applied its settings, so on that one endpoint the firmware has the last
 * word. See {@link firmwareOverridesAppConfig} for the measurement. Uploading the program's bytes
 * instead of naming its path gives the firmware a temporary file with no settings file beside it,
 * which is how the user's choice survives.
 *
 * The associated file is read out of the item's own discovery result rather than from a fresh
 * listing: discovery already looked in that directory and recorded every `.cfg` beside the program
 * plus the `.usr` the firmware falls back to, so the names are there and no launch-time round trip
 * is needed. An item restored from the playlist repository has no discovery result — candidates are
 * not persisted — and {@link firmwareOverridesAppConfig} reads that as "the firmware will find
 * one", so a choice made before a restart survives the restart.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { firmwareOverridesAppConfig } from "@/lib/config/firmwareAssociatedConfig";
import type { ConfigCandidate, ConfigValueOverride } from "@/lib/config/playbackConfig";
import type { ConfigFileReference } from "@/lib/config/configFileReference";

export type FirmwareConfigLaunchItem = {
  category: PlayFileCategory;
  path: string;
  configRef?: ConfigFileReference | null;
  configOverrides?: ConfigValueOverride[] | null;
  configCandidates?: ConfigCandidate[] | null;
};

/** `split` on a non-empty separator always yields at least one part, so the last one is the name. */
const fileNameOf = (path: string) => path.split("/").at(-1) as string;

export const firmwareOverridesItemConfig = (item: FirmwareConfigLaunchItem) =>
  firmwareOverridesAppConfig({
    fileName: fileNameOf(item.path),
    category: item.category,
    siblingFileNames:
      item.configCandidates
        ?.filter((candidate) => candidate.distance === 0)
        .map((candidate) => candidate.ref.fileName) ?? null,
    appConfigFileName: item.configRef?.fileName ?? null,
    hasOverrides: Boolean(item.configOverrides?.length),
  });
