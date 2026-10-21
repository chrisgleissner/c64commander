/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Activity, CircleDot, Keyboard, MonitorSmartphone, Wifi, WifiOff } from "lucide-react";
import { appDeviceName, isKeypadEdition, targetDeviceDescription, targetDeviceShortName } from "@/lib/docs/deviceNames";
import { backKeyName, menuKeyName } from "@/lib/docs/guide/keyNames";
import type { GuideBlock, GuideChapter, GuideContext } from "@/lib/docs/guide/types";
import { OK_KEY_WORDS } from "@/lib/input/guidance";
import { getKeyLabels } from "@/lib/variant/keyLabels";

export const gettingStartedChapter = ({ variantId, flags }: GuideContext): GuideChapter => ({
  id: "getting-started",
  title: "Get started",
  navLabel: "Get started",
  icon: Wifi,
  blocks: [
    {
      kind: "text",
      text: `The app controls ${targetDeviceDescription(variantId)} over your home network. Your ${appDeviceName(variantId)} and your C64 must be on the same network.`,
    },
    {
      kind: "steps",
      heading: "On your C64",
      items: [
        "Open the machine's own menu and choose **Network Services & Timezone**.",
        "Turn on **Web Remote Control Service**. The app cannot work without it.",
        "Turn on **FTP File Service** to browse files, build playlists and mount disks.",
        "Note the IP address shown under the network setup, in case the app cannot find the machine itself.",
      ],
    },
    {
      kind: "steps",
      heading: "In the app",
      items: [
        "Start the app. It looks for your C64 on the network.",
        "In **Choose your C64**, choose **Use** to connect, or **Save** to keep a machine for later.",
        "If it shows **No C64 found**, type a name such as `c64u` or an IP address in **Host or IP**, then choose **Connect**.",
        "Enter the network password if the machine asks for one.",
        "The badge at the top right turns into a green dot once your C64 answers.",
      ],
    },
    {
      kind: "text",
      text: "The six pages are **Home**, **Play**, **Disks**, **Config**, **Settings** and **Docs**. Number keys `1` to `6` open them in that order.",
    },
    ...(flags.demo_mode_enabled === false
      ? []
      : [
          {
            kind: "text",
            text: `With no network at all, the app offers **Demo Mode**, a simulated C64 on your ${appDeviceName(variantId)}. Choose **Continue in Demo Mode** to try everything; the badge then reads **DEMO**.`,
          } satisfies GuideBlock,
        ]),
    {
      kind: "tip",
      text: "**Take the tour**, at the top of this page, walks through each page in a minute.",
    },
  ],
});

export const devicesChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "devices",
  title: "Connect, switch and add devices",
  navLabel: "Connect devices",
  icon: MonitorSmartphone,
  blocks: [
    {
      kind: "text",
      text: "Every machine you use is kept under **Saved devices** in Settings → **Connection**.",
    },
    {
      kind: "steps",
      heading: "Connect to a machine by hand",
      items: [
        "Open **Settings**, then the **Connection** card.",
        `Type the host name or IP address in **C64U hostname / IP**.`,
        "Fill in **Network Password** if the machine has one.",
        "Choose **Save & Connect**. The app checks that the machine answers before it keeps a new address.",
      ],
    },
    {
      kind: "steps",
      heading: "Add another machine",
      items: [
        "In **Saved devices**, choose **Add device**.",
        "Enter a **Device name** of up to 10 characters and the **C64U hostname / IP**.",
        "Choose **Add**. The app connects once the machine answers.",
        "If it needs a password, choose it in the list to switch to it, fill in **Network Password**, and choose **Save & Connect**.",
      ],
    },
    {
      kind: "steps",
      heading: "Switch between machines",
      items: [
        isKeypadEdition(variantId)
          ? "Press `#`, long-press the badge, or choose **Switch device** in the Quick menu."
          : "Long-press the badge, press `#` on a keyboard, or choose **Switch device** in the Quick menu.",
        "Each row shows **Selected**, **Verifying**, **Offline** or **Mismatch**, and checks refresh every 10 seconds.",
        "Choose a machine to switch to it. The app first lets go of any keys held on the old one.",
      ],
    },
    {
      kind: "text",
      text: "To look for machines again, choose **Discover devices** on the **Connection** card. To remove one, choose it in the list, then **Delete device**.",
    },
    {
      kind: "tip",
      text: "Switching needs at least two saved devices. With only one, `#` says there is no other device.",
    },
  ],
});

export const connectionProblemsChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "connection-problems",
  title: "Fix connection problems",
  navLabel: "Connection help",
  icon: WifiOff,
  blocks: [
    {
      kind: "text",
      text: "When your C64 stops answering, a notice says **C64 Ultimate not reachable**, and the app reconnects by itself when the machine is back.",
    },
    {
      kind: "steps",
      items: [
        `Check that your ${appDeviceName(variantId)} and the C64 are on the same network.`,
        "On the machine, check that **Web Remote Control Service** is on. File browsing also needs **FTP File Service**.",
        "Tap the badge. While the app is offline, that also tries to connect again.",
        "If a host name does not work, enter the IP address in Settings → **Connection** and choose **Save & Connect**.",
        "If the app asks for a **Network password**, enter the one set on the machine.",
        "Open Diagnostics and choose **Run health check** to see which service fails.",
      ],
    },
    {
      kind: "text",
      text: `If the web, FTP and Telnet services all refuse while the machine still answers a ping, switch ${targetDeviceShortName(variantId)} off and on again.`,
    },
    {
      kind: "text",
      text: "A change of CPU speed can drop the network for a moment. Wait for the badge to recover before changing more settings.",
    },
    {
      kind: "text",
      text: "Settings → **Device Safety** sets how hard the app pushes the machine. Leave **Safety mode** on its recommended **Auto** choice; for a fragile Wi-Fi link, choose **Conservative (maximum safety)**.",
    },
  ],
});

const joinWords = (words: readonly string[]): string =>
  `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;

/** The same three rows as the manual's "The two keys under the screen", worded as the guidance bar words them. */
const keypadSoftKeysBlock = (variantId: string): GuideBlock => {
  const keys = getKeyLabels(variantId);
  return {
    kind: "keys",
    heading: "The two keys under the screen",
    items: [
      {
        key: keys.leftSoft,
        action: `The bar says ${joinWords([keys.backWord, "Exit", "Done", keys.closeWord])}. Leaves the current dialog, field, group or page. In Remote Input it gives the keypad back to your C64.`,
      },
      {
        key: keys.center,
        action: `The bar says ${joinWords(OK_KEY_WORDS)}. Goes in or presses the selected control.`,
      },
      {
        key: keys.rightSoft,
        action: `The bar says ${keys.menuWord}, or ${keys.deleteWord} in a text field. Opens the menu of the selected item, or the Quick menu when it has none. In a text field that holds text it deletes the last character.`,
      },
    ],
  };
};

export const keypadChapter = ({ variantId }: GuideContext): GuideChapter => {
  const keypad = isKeypadEdition(variantId);
  return {
    id: "keypad",
    title: "Keypad cheat sheet",
    navLabel: "Keypad keys",
    icon: Keyboard,
    blocks: [
      {
        kind: "text",
        text: keypad
          ? "Every control can be reached with the keys alone. A bar along the bottom names what Back, OK and Menu do right now."
          : "With a keypad or keyboard, every control can be reached with keys alone. A bar along the bottom names what Back, OK and Menu do right now.",
      },
      {
        kind: "steps",
        heading: "Move around",
        items: [
          "Press Up or Down to move through the page. Left and Right adjust sliders and tabs.",
          "Press OK on a closed card to open it, and OK again to go into it.",
          `Press the ${backKeyName(variantId)} to leave a card, close a dialog, or go back.`,
          `Press the ${menuKeyName(variantId)} for the selected item's menu, or the Quick menu where it has none.`,
        ],
      },
      ...(keypad
        ? [
            keypadSoftKeysBlock(variantId),
            {
              kind: "tip" as const,
              text: "Android's system file picker uses its own key map: right soft key = Back, left soft key = menu. Press the right soft key again if Back first closes a menu or leaves a folder; repeat until the app returns. C= opens Home and does not cancel the picker.",
            },
          ]
        : []),
      {
        kind: "keys",
        heading: "Keys",
        items: [
          { key: "`1` to `6`", action: "Home, Play, Disks, Config, Settings, Docs" },
          { key: "`7`", action: "Search" },
          { key: "`8`", action: "Pause or resume the machine" },
          { key: "`9`", action: "Reset the machine, after you confirm" },
          { key: "`0`", action: "Game Mode" },
          { key: "`*`", action: "Diagnostics" },
          { key: "`#`", action: "Switch device, when more than one is saved" },
          keypad
            ? {
                key: "F1 and F3",
                action: "Play/Pause and Next tune; change them in Settings → **Remote function keys**",
              }
            : { key: "F1 and F3", action: "Play or pause, and the next tune, on the Play page" },
        ],
      },
      ...(keypad
        ? [
            {
              kind: "keys",
              heading: "In a text field",
              items: [
                { key: "OK", action: "Start typing in the field, and OK again when you are done" },
                { key: "`2` to `9`", action: "Letters: press again for the next letter, then pause" },
                { key: "`0`", action: "A space" },
                { key: "`1`", action: "Punctuation, such as `.` `@` and `-`" },
                { key: "`#`", action: "Switch between letters and digits" },
                { key: "`*`", action: "Change the case of the last letter; in host fields, cycle `.` `:` `-`" },
                { key: menuKeyName(variantId), action: "Delete the last character" },
              ],
            } satisfies GuideBlock,
          ]
        : []),
      {
        kind: "tip",
        text: "Number keys belong to an open dialog first. Close it to use them as shortcuts again.",
      },
    ],
  };
};

export const badgeChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "status-badge",
  title: "What the status badge colors mean",
  navLabel: "Badge colors",
  icon: CircleDot,
  blocks: [
    {
      kind: "text",
      text: "The badge at the top right shows how your C64 is doing. Each state has its own shape as well as its own color.",
    },
    {
      kind: "keys",
      items: [
        { key: "Green dot", action: "Healthy: the machine answers normally" },
        { key: "Amber triangle", action: "Degraded: a check or a recent request had trouble" },
        { key: "Red diamond", action: "Unhealthy: the machine is not answering correctly" },
        { key: "Gray ring", action: "Idle: the app has not connected yet" },
        { key: "Gray dotted ring", action: "Offline, or the machine wants its network password" },
        { key: "**DEMO**", action: "The simulated device of Demo Mode, not your C64" },
      ],
    },
    {
      kind: "text",
      text: "A number beside the shape counts the problems found. With several saved devices, the device's short name comes first.",
    },
    {
      kind: "steps",
      items: [
        "Tap the badge, or press `*`, to open Diagnostics. While offline, the tap also tries to reconnect.",
        isKeypadEdition(variantId)
          ? "Long-press it, or press `#`, to switch device."
          : "Long-press it to switch device when more than one is saved.",
      ],
    },
  ],
});

export const diagnosticsChapter = ({ variantId }: GuideContext): GuideChapter => ({
  id: "diagnostics",
  title: "Diagnostics and sharing logs",
  navLabel: "Diagnostics",
  icon: Activity,
  blocks: [
    {
      kind: "text",
      text: "Diagnostics records what the app asked your C64 and what came back. Open it when a control does nothing or the badge is not green.",
    },
    {
      kind: "steps",
      heading: "Find the problem",
      items: [
        "Tap the badge or press `*`. It also opens from Settings → **Diagnostics** and from **Details** on a notice.",
        "Choose **Run health check**. It tests the web, FTP and Telnet services and three signals from the C64.",
        "Open **Filters** and choose **Errors only** or **Problems only**.",
        "Choose a row in **Activity** for its full details.",
      ],
    },
    {
      kind: "steps",
      heading: "Share a report",
      items: [
        "Do this before you clear anything or restart the app.",
        "Open the three-dot menu at the top of Diagnostics.",
        "Choose **Share all** for the full report, or **Share filtered** for the rows on screen.",
        `Pick an app on your ${appDeviceName(variantId)} to send or save the file.`,
      ],
    },
    {
      kind: "text",
      text: "The report is a ZIP of logs, traces and recent actions, with a health snapshot. It can contain your C64's host name or address, so send it only to people you trust.",
    },
    {
      kind: "text",
      text: "**Clear all**, in the same menu, removes the entries after asking.",
    },
  ],
});

export const helpChapters = (context: GuideContext): GuideChapter[] => [
  devicesChapter(context),
  connectionProblemsChapter(context),
  ...(context.flags.keypad_input_enabled === false ? [] : [keypadChapter(context)]),
  badgeChapter(context),
  diagnosticsChapter(context),
];
