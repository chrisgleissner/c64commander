/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Headphones } from "lucide-react";
import { menuKeyName } from "@/lib/docs/guide/keyNames";
import type { GuideBlock, GuideChapter, GuideContext } from "@/lib/docs/guide/types";

export const sidPlayerChapter = ({ variantId, appMode = "full" }: GuideContext): GuideChapter => {
  const inSidPlayer = appMode === "sid-player";
  const blocks: GuideBlock[] = [
    {
      kind: "text",
      text: inSidPlayer
        ? "SID Player plays C64 music on this phone. It needs no C64 Ultimate and sends nothing to one."
        : "SID Player turns this app into a music player for C64 tunes. It hides everything that needs a C64 Ultimate and sends nothing to one.",
    },
    {
      kind: "steps",
      heading: "Listen",
      items: [
        "Open **Play**.",
        "Add tunes from the free music collection, from your own SID files, or start a **SID Radio** station.",
        "Choose a tune to play it. It plays on this phone.",
      ],
    },
    {
      kind: "text",
      text: "In SID Player the machine controls, disks, configuration, Live View and Remote Input are put away. Your playlists, settings and saved devices are kept, and come back when you leave.",
    },
    {
      kind: "steps",
      heading: inSidPlayer ? "Leave SID Player" : "Use SID Player",
      items: inSidPlayer
        ? [
            `Press the ${menuKeyName(variantId)} or open the **Quick menu**, then choose **Leave SID Player**.`,
            "Or open **Settings**, then **App mode**, and choose **Full App**.",
            "Or tap the **SID Player** badge at the top of the screen.",
          ]
        : [
            "Open **Settings**, then **App mode**, and choose **SID Player**.",
            "While no C64 Ultimate is connected, the **Quick menu** also offers **Use SID Player**.",
          ],
    },
  ];
  return { id: "sid-player", title: "SID Player", navLabel: "SID Player", icon: Headphones, blocks };
};
