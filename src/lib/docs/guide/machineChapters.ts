/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Disc, Keyboard as KeyboardIcon, MonitorPlay, Save, Sliders } from "lucide-react";
import { JOYSTICK_ICON } from "@/lib/ui/joystickIcon";
import { appDeviceName, isKeypadEdition } from "@/lib/docs/deviceNames";
import { backKeyName, menuKeyName } from "@/lib/docs/guide/keyNames";
import type { GuideBlock, GuideChapter, GuideContext } from "@/lib/docs/guide/types";

export const diskChapter = ({ variantId, flags }: GuideContext): GuideChapter => ({
  id: "disks",
  title: "Mount and run a disk",
  navLabel: "Mount a disk",
  icon: Disc,
  blocks: [
    {
      kind: "text",
      text: "**Disks** holds the drives and your disk collection. It reads D64, G64, D71, G71 and D81 images.",
    },
    {
      kind: "steps",
      heading: "Start a disk in one go",
      items: [
        "Open **Play** and choose **Add items**.",
        "Pick a source and tick one disk image.",
        "Choose **Play**. The app mounts the disk and starts its first program.",
      ],
    },
    {
      kind: "steps",
      heading: "Mount a disk yourself",
      items: [
        "Open **Disks**: the Disks tab, or `3` on the keypad.",
        "Choose **Add disks**, pick a source, tick images or a folder, and choose **Add to library**.",
        "Choose **Mount** on a disk, then the drive, such as **Drive A (#8, 1541)**. A drive that is off is switched on for you.",
        'On your C64, type `LOAD"*",8,1` and then `RUN`. Remote Input can type it for you.',
        "To take the disk out, choose the disc button in the drive card's header.",
      ],
    },
    ...(flags.disk_explorer_enabled === false
      ? []
      : [
          {
            kind: "text",
            text: "To start one program from a disk, open the disk's menu, choose **Open (Disk Explorer)…**, then **Run** beside the program.",
          } satisfies GuideBlock,
        ]),
    {
      kind: "steps",
      heading: "Swap disks in a multi-disk title",
      items: [
        "Add the title's folder: disks with similar names join one group by themselves.",
        "To group by hand, open a disk's menu and choose **Set group…**.",
        "Mount the first disk.",
        "When the program asks for the next disk, choose the next-disk arrow on the drive card.",
      ],
    },
    {
      kind: "text",
      text: `A disk from your ${appDeviceName(variantId)} is copied to the machine first. What a program saves to it comes back to your file when you eject it.`,
    },
  ],
});

export const remoteInputChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "remote-input",
  title: "Type on the C64 with Remote Input",
  navLabel: "Remote Input",
  icon: KeyboardIcon,
  blocks: [
    {
      kind: "text",
      text: `Remote Input turns your ${appDeviceName(variantId)} into a keyboard and joystick for the C64.`,
    },
    {
      kind: "steps",
      items: [
        "On **Home**, choose **Input** in **Quick actions**. On **Play**, choose **Remote Input** while something plays.",
        "Choose **Keys** at the top for the C64 keyboard, with its SHIFT, CTRL, C= and function keys.",
        "Tap a modifier once to apply it to the next key, or hold it while you press another.",
        "Choose **Release all** at any time to let go of every key.",
        "Close Remote Input when you are done. Every key is released.",
      ],
    },
    ...(isKeypadEdition(variantId)
      ? [
          {
            kind: "keys",
            heading: "Typing with the keypad",
            items: [
              { key: "`2` to `9`", action: "Letters by multi-tap, as in a text field" },
              { key: "`0` and `1`", action: "A space, and punctuation" },
              { key: "`#`", action: "Switch between letters and digits" },
              { key: "OK", action: "RETURN" },
              { key: "D-pad", action: "The cursor keys" },
              { key: menuKeyName(variantId), action: "Delete" },
              { key: backKeyName(variantId), action: "The menu, with **Close Remote Input**" },
            ],
          } satisfies GuideBlock,
        ]
      : []),
    {
      kind: "text",
      text: "The **Joystick** tab and keys such as RUN/STOP and RESTORE need firmware with machine input support. Without it, **Keys** types into BASIC only, which is fine for `LOAD` and `RUN` but not for most games.",
    },
  ],
});

export const gameModeChapter = ({ variantId }: GuideContext): GuideChapter => {
  const keypad = isKeypadEdition(variantId);
  return {
    id: "game-mode",
    title: keypad ? "Play a game with Game Mode and the keypad" : "Play a game with Game Mode",
    navLabel: "Game Mode",
    icon: JOYSTICK_ICON,
    blocks: [
      {
        kind: "text",
        text: "Game Mode is Remote Input set up for playing: the C64's picture fills the screen, and the keys steer the joystick.",
      },
      {
        kind: "steps",
        items: [
          "Start a game on **Play**.",
          keypad
            ? "Game Mode opens by itself while Settings → **Play and disk** → **Enter Game Mode when a game starts** is on. Otherwise press `0`, or choose **Game** in Home's **Quick actions**."
            : "Press `0`, choose **Game** in Home's **Quick actions**, or **Game Mode** on **Play**.",
          "Steer with the number keys or the D-pad, and fire as shown below.",
          "Press `#` to show or hide RETURN, SPACE, the other quick keys, and **Watch** and **Listen**.",
          `Press the ${backKeyName(variantId)} to leave. Everything you held is let go.`,
        ],
      },
      {
        kind: "keys",
        heading: "Number keys",
        items: keypad
          ? [
              { key: "`5`", action: "Up" },
              { key: "`7` and `9`", action: "Left and right" },
              { key: "`0`", action: "Down" },
              { key: "`8` or OK", action: "Fire" },
              { key: "`*`", action: "Switch between steering and moving the picture" },
            ]
          : [
              { key: "`2`", action: "Up" },
              { key: "`4` and `6`", action: "Left and right" },
              { key: "`8`", action: "Down" },
              { key: "`5` or OK", action: "Fire" },
              { key: "`*`", action: "Switch between steering and moving the picture" },
            ],
      },
      {
        kind: "text",
        text: "Most games read the joystick in port 2, which is where it starts. **Show joystick**, on the Game Mode toolbar, brings up the stick and its **Port 1** / **Port 2** switch.",
      },
      {
        kind: "text",
        text: "Settings → **Play and disk** → **Joystick keys** offers **Diamond (8-centered)**, **Classic T9** and **Custom**.",
      },
    ],
  };
};

export const liveViewChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "live-view",
  title: "Watch your C64 with Live View",
  navLabel: "Live View",
  icon: MonitorPlay,
  blocks: [
    {
      kind: "text",
      text: `Live View brings the C64's picture and sound to your ${appDeviceName(variantId)} over the network. Nothing is sent until you ask for it.`,
    },
    {
      kind: "steps",
      items: [
        "On **Home**, choose **Live** in **Quick actions**, or open the **Live View** card below them.",
        "Choose **Watch** for the picture, **Listen** for the sound, or both.",
        "Choose the chevron beside the preview to make it bigger.",
        "For the full screen you can zoom, open **Remote Input** while **Watch** is on.",
        "Choose **Stop** in the card's header to end both.",
      ],
    },
    {
      kind: "keys",
      heading: "Keys on the full screen",
      items: [
        { key: "`*`", action: "Switch between driving the C64 and adjusting the view" },
        { key: "`2` `4` `6` `8`", action: "Pan, while adjusting the view" },
        { key: "`3` or `9`, `1` or `7`", action: "Zoom in, zoom out" },
        { key: "`0` or `5`", action: "Fit the whole screen again" },
      ],
    },
    {
      kind: "text",
      text: "Live View keeps playing on other pages. While it does, the status badge carries a small screen or speaker mark, and **Stop Live View** in the Quick menu ends it from any page.",
    },
    {
      kind: "text",
      text: "The machine sends the stream from its Ethernet port, so a C64 on Wi-Fi alone cannot send it.",
    },
  ],
});

export const configChapter = (): GuideChapter => ({
  id: "config",
  title: "Change a setting in Config",
  navLabel: "Change a setting",
  icon: Sliders,
  blocks: [
    {
      kind: "text",
      text: "**Config** holds every setting your machine reports, in cards such as **Video setup**. Common ones are also on Home, in cards such as **Video** and **Audio**.",
    },
    {
      kind: "steps",
      items: [
        "Open **Config**: the Config tab, or `4` on the keypad.",
        "Type part of the setting's name in **Search categories...**, or open its card.",
        "Change the value with its control: a list, a slider, a check box or a text field. A text field takes the value when you leave it.",
        "A notice says the setting was updated. Let it finish before changing a related one.",
      ],
    },
    {
      kind: "text",
      text: "A change lasts until the machine is switched off. To keep it, see **Save and restore configs and snapshots**.",
    },
    {
      kind: "tip",
      text: "Search on Config also finds a setting by its own name, so you need not know which menu holds it.",
    },
  ],
});

export const saveRestoreChapter = ({ variantId, flags }: GuideContext): GuideChapter => ({
  id: "save-restore",
  title: "Save and restore configs and snapshots",
  navLabel: "Save and restore",
  icon: Save,
  blocks: [
    {
      kind: "text",
      text: "Your machine uses live settings now, and loads a saved copy from its flash memory when it starts.",
    },
    {
      kind: "steps",
      heading: "Keep the settings in the machine",
      items: [
        "On **Home**, open the **Config** card.",
        "Choose **Save**, the tile marked **To flash**.",
        "**Load**, marked **From flash**, goes back to the saved copy. **Revert** puts back the settings the machine had when the app connected.",
      ],
    },
    {
      kind: "steps",
      heading: "Keep several setups in the app",
      items: [
        "Choose **Save** marked **To app**, type a **Config name**, and choose **Save**.",
        "Later, choose **Load** marked **From app** and pick it.",
        "**Manage**, marked **App configs**, renames or deletes them.",
      ],
    },
    {
      kind: "text",
      text: "Settings → **Device Safety** → **Keep device settings after a restart** saves every change for you. If a saved setting makes the machine hard to use, hold RESTORE while you switch it on.",
    },
    ...(flags.ram_snapshots_enabled === false
      ? []
      : [
          {
            kind: "steps",
            heading: "Save the C64's memory",
            items: [
              "On **Home**, choose **Backup** in **Quick actions**.",
              "Choose what to keep. **Program snapshot** suits most programs.",
              `Later, choose **Restore**, pick the snapshot, and confirm with **Restore**. Snapshots stay on your ${appDeviceName(variantId)}.`,
            ],
          } satisfies GuideBlock,
        ]),
  ],
});

export const machineChapters = (context: GuideContext): GuideChapter[] => {
  const remoteInput = context.flags.remote_input_enabled !== false;
  return [
    diskChapter(context),
    ...(remoteInput ? [remoteInputChapter(context), gameModeChapter(context)] : []),
    ...(context.flags.live_view_enabled === false ? [] : [liveViewChapter(context)]),
    configChapter(),
    saveRestoreChapter(context),
  ];
};
