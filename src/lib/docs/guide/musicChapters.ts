/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Headphones, ListMusic, Music, Radio, Search } from "lucide-react";
import { appDeviceName, isKeypadEdition } from "@/lib/docs/deviceNames";
import type { GuideBlock, GuideChapter, GuideContext } from "@/lib/docs/guide/types";

export const playFromHvscChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "play",
  title: "Play a tune from HVSC",
  navLabel: "Play from HVSC",
  icon: Music,
  blocks: [
    {
      kind: "text",
      text: `HVSC, the High Voltage SID Collection, holds tens of thousands of C64 tunes. The app downloads it once and keeps it on your ${appDeviceName(variantId)}.`,
    },
    {
      kind: "steps",
      items: [
        "Open **Play**: the Play tab, or `2` on the keypad.",
        "Choose **Add items**. It reads **Add more items** once the playlist has something in it.",
        "Choose **HVSC**. The first time, the app downloads and prepares the collection, which takes a few minutes.",
        "Open a folder. Composers are under **MUSICIANS**, by the first letter of their name.",
        "Tick the tunes or folders you want. **Include subfolders** decides whether a folder brings everything beneath it.",
        "Confirm with **Add to playlist**. On a small screen it reads **Add** and a count.",
        "Choose a tune's title in the playlist to start it.",
      ],
    },
    {
      kind: "text",
      text: "The **HVSC** card at the foot of Play shows the installed version and offers **Download** and **Ingest** by hand. Settings → **HVSC** sets where updates come from.",
    },
    {
      kind: "text",
      text: "One SID file can hold several tunes. While it plays, choose the tune position under the title, such as **1/19**, to pick one, or **Play all 19 tunes** to add them all.",
    },
    {
      kind: "tip",
      text: isKeypadEdition(variantId)
        ? "In the picker, Up and Down move through the list, OK opens a folder or ticks a file, and Back goes up a folder."
        : `On a ${appDeviceName(variantId)} with a keypad or keyboard, Up and Down move through the picker, OK opens a folder or ticks a file, and Back goes up a folder.`,
    },
  ],
});

export const findTuneChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "find-tune",
  title: "Find a tune fast",
  navLabel: "Find a tune",
  icon: Search,
  blocks: [
    {
      kind: "text",
      text: "Three tools find music, from the widest to the narrowest.",
    },
    {
      kind: "steps",
      heading: "Search the whole collection",
      items: [
        "On **Play**, choose **Find a tune**.",
        "Type part of a title or a composer's name. Upper or lower case and accents do not matter.",
        "Add a second word to narrow it down, such as `hubbard commando`.",
        "Pick a result and it plays at once.",
      ],
    },
    {
      kind: "steps",
      heading: "Search the app",
      items: [
        "Press `7`, or choose **Search** at the top of the Quick menu.",
        "Type two or three letters.",
        "Move through the results with Up and Down while you type, and press OK to open one.",
      ],
    },
    {
      kind: "steps",
      heading: "Narrow the playlist",
      items: [
        "On **Play**, open **View all** when the playlist is long.",
        "Type in the filter box. It matches the title, the path, the source and the kind of file.",
        "Use the type filters to show only songs, programs or disks.",
        "Clear the box to see the whole list again. A filter never removes anything.",
      ],
    },
    {
      kind: "text",
      text: "While a tune plays, choose the composer's name under its title to search for more by them.",
    },
    ...(isKeypadEdition(variantId)
      ? [
          {
            kind: "tip",
            text: "Type with the number keys: press a key again for its next letter, and `0` for a space.",
          } satisfies GuideBlock,
        ]
      : []),
  ],
});

export const playlistChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "playlist",
  title: "Build and order a playlist",
  navLabel: "Build a playlist",
  icon: ListMusic,
  blocks: [
    {
      kind: "text",
      text: "There is one playlist. It holds songs, programs, cartridges and disk images from any source, side by side, and it is kept when you close the app.",
    },
    {
      kind: "steps",
      heading: "Build it",
      items: [
        "On **Play**, choose **Add items**.",
        `Choose a source: **Local** for files on your ${appDeviceName(variantId)}, **C64U** for files on your C64, **HVSC**, or **CommoServe**.`,
        "Tick files or folders. To search instead of browsing, type in the box and switch it from **This folder** to **Everywhere**.",
        "Confirm. A single program or disk confirms with **Play** and starts at once; anything else is added to the end of the list.",
      ],
    },
    {
      kind: "steps",
      heading: "Choose the order",
      items: [
        "Items play in the order you added them. Rows cannot be moved, so add folders in the order you want to hear them.",
        "Tick **Shuffle** to play in a random order; **Reshuffle** picks a new one. The list itself keeps its order.",
        "Tick **Repeat** to start again after the last item.",
      ],
    },
    {
      kind: "steps",
      heading: "Trim it",
      items: [
        "Open **View all** when the list is long.",
        "Tick the rows you do not want, or **Select all**.",
        "Choose **Remove selected items**. **Clear playlist** empties it after asking.",
      ],
    },
    {
      kind: "text",
      text: "A row's menu, the three dots, shows its **Details** and its playback config: device settings the app applies just before that item runs.",
    },
    {
      kind: "tip",
      text: "With the keys, move to a row's three dots and press OK to open its menu.",
    },
  ],
});

export const sidRadioChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "sid-radio",
  title: "Use SID Radio",
  navLabel: "SID Radio",
  icon: Radio,
  blocks: [
    {
      kind: "text",
      text: "SID Radio plays HVSC like a radio station: pick a mood and the app keeps finding more music of the same kind. Nothing downloads while you listen.",
    },
    {
      kind: "steps",
      items: [
        "Install HVSC first, as in **Play a tune from HVSC**.",
        "On **Play**, choose **SID Radio**, or **Radio** in Home's Quick actions.",
        "Pick a mood such as **Chill / Ambient** or **Melodic**, a collection, or **Surprise me**.",
        "While a tune plays, choose the heart to like it, or the cross to skip it and hear less like it.",
        "Choose **More like this** to follow the tune that is playing now.",
        "Choose **Stop** beside the station name, above the title, to end the station. Your playlist comes back.",
      ],
    },
    {
      kind: "text",
      text: `Likes stay on your ${appDeviceName(variantId)}. Once five tunes carry a heart, **From tunes you like** builds a station from them.`,
    },
    {
      kind: "tip",
      text: "Set a **Sleep timer** under the transport controls if you listen at bedtime. A station never stops on its own.",
    },
  ],
});

export const audioOutputChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "audio-output",
  title: "Listen here or on your C64",
  navLabel: "Listen here or on C64",
  icon: Headphones,
  blocks: [
    {
      kind: "text",
      text: `A SID tune can play on your C64's own chip or on your ${appDeviceName(variantId)}. Programs and disks always run on the C64.`,
    },
    {
      kind: "steps",
      items: [
        "Start a SID tune on **Play**.",
        "Choose the output button beside the volume slider. It names where the sound goes now.",
        `Choose **Here** to play on your ${appDeviceName(variantId)}, **C64** to play on the machine, or **Both**.`,
        "**Mute** and the volume slider follow whichever machine makes the sound.",
      ],
    },
    {
      kind: "text",
      text: "**Here** works with your C64 switched off. The first time, the app copies the C64's KERNAL and BASIC from your own machine, which many tunes need.",
    },
    {
      kind: "text",
      text: "**Both** needs Live View and a C64 on Ethernet: the machine plays the tune and also sends its sound across the network.",
    },
    {
      kind: "text",
      text: "Settings → **SID Radio** holds **Crossfade** and **SID emulation**. Crossfade works only when the sound plays **Here**.",
    },
  ],
});

export const musicChapters = (context: GuideContext): GuideChapter[] => {
  const hvsc = context.flags.hvsc_enabled !== false;
  return [
    ...(hvsc ? [playFromHvscChapter(context), findTuneChapter(context)] : []),
    playlistChapter(context),
    ...(hvsc ? [sidRadioChapter(context)] : []),
    audioOutputChapter(context),
  ];
};
