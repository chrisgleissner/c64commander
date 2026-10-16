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
import type { GuideChapter, GuideContext } from "@/lib/docs/guide/types";

/** The guide in reading order: first steps, music, disks and the machine, then help. */
export const buildGuideChapters = (context: GuideContext): GuideChapter[] => [
  gettingStartedChapter(context),
  ...musicChapters(context),
  ...machineChapters(context),
  ...helpChapters(context),
];
