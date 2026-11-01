/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { gettingStartedChapter, helpChapters } from "@/lib/docs/guide/helpChapters";
import { machineChapters } from "@/lib/docs/guide/machineChapters";
import { musicChapters } from "@/lib/docs/guide/musicChapters";
import { sidPlayerChapter } from "@/lib/docs/guide/sidPlayerChapter";
import { isSectionVisible } from "@/lib/appMode/surfaces";
import type { GuideChapter, GuideContext } from "@/lib/docs/guide/types";

/** The guide in reading order: first steps, music, disks and the machine, then help; chapters the mode hides are left out. */
export const buildGuideChapters = (context: GuideContext): GuideChapter[] =>
  [
    gettingStartedChapter(context),
    ...musicChapters(context),
    sidPlayerChapter(context),
    ...machineChapters(context),
    ...helpChapters(context),
  ].filter((chapter) => isSectionVisible("docs", chapter.id, context.appMode ?? "full"));
