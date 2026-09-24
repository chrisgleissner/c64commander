#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFeatureFlagOverlaySource,
  parseVariantSource,
  resolveVariantFeatureRegistry,
} from "./generate-variant.mjs";
import { parseRegistrySource } from "./compile-feature-flags.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const manualsRoot = path.join(rootDir, "docs/manual");
const variantsFile = path.join(rootDir, "variants/variants.yaml");
const baseFeatureFlagsFile = path.join(rootDir, "src/lib/config/feature-flags.yaml");
const overlaysDir = path.join(rootDir, "variants/feature-flags");

const readText = (filePath) => readFile(filePath, "utf8");

const slugCounts = new Map();

const stripMarkdown = (value) =>
  value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_#>~]/g, "")
    .trim();

const slugify = (value) => {
  const base =
    stripMarkdown(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  const count = slugCounts.get(base) ?? 0;
  slugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
};

// One accent hue per top-level chapter. Shown in the running header, the chapter
// heading, and that chapter's Table of Contents entries, so the color tells you
// at a glance which part of the manual you are in. Chosen for legibility on the
// warm off-white page and to echo a friendly retro palette.
const CHAPTER_COLORS = [
  "#2a6f97", // 1 blue
  "#1f7a6d", // 2 teal
  "#6d597a", // 3 muted purple
  "#b5651d", // 4 ochre
  "#8a6a3b", // 5 bronze
  "#40655e", // 6 slate green
  "#9c4722", // 7 burnt orange
  "#a4243b", // 8 crimson
  "#34568b", // 9 indigo
];

const chapterAccent = (chapter) => CHAPTER_COLORS[(Math.max(chapter, 1) - 1) % CHAPTER_COLORS.length];

// Walks every H2/H3/H4, assigning a hierarchical number (1, 1.1, 1.1.1) and the
// index of the top-level chapter it belongs to. The Table of Contents is skipped
// so it never consumes a chapter number.
const buildToc = (markdown) => {
  slugCounts.clear();
  const counters = [0, 0, 0]; // depth 2, 3, 4
  return markdown.split("\n").flatMap((line) => {
    const match = /^(#{2,4})\s+(.+)$/.exec(line);
    if (!match) return [];
    const title = stripMarkdown(match[2]);
    if (title === "Table of Contents") return [];
    const depth = match[1].length;
    const idx = depth - 2;
    counters[idx] += 1;
    for (let i = idx + 1; i < counters.length; i += 1) counters[i] = 0;
    return [
      {
        depth,
        title,
        id: slugify(match[2]),
        number: counters.slice(0, idx + 1).join("."),
        chapter: counters[0],
      },
    ];
  });
};

// Stamps each body heading with its anchor id, its hierarchical number, and the
// accent color of its chapter (as a CSS variable), so headings, running headers,
// and the ToC share one color and numbering system. The number is baked into the
// text (not a CSS counter) so it survives Paged.js pagination unchanged.
const addHeadingIds = (html, toc) => {
  let headingIndex = 0;
  return html.replace(/<h([234])>(.*?)<\/h\1>/g, (full, depth, content) => {
    const entry = toc[headingIndex];
    headingIndex += 1;
    if (!entry) return full;
    return `<h${depth} id="${entry.id}" data-chapter="${entry.chapter}" style="--accent:${chapterAccent(
      entry.chapter,
    )}"><span class="secnum">${entry.number}</span> ${content}</h${depth}>`;
  });
};

/**
 * Trim size and the four margins, in millimeters.
 *
 * Held in one place because they are the decision the rest of the print layout
 * follows: the measure (page width minus the two side margins) is what sets the
 * line length, and the line length is what makes a page of prose comfortable or
 * tiring to read. 210 − 33 − 42 leaves a 135 mm measure, which at 10.5 pt runs
 * to roughly 70 characters a line — the range long-form text is set in.
 *
 * `inner` is the bound edge and is narrower than `outer` on purpose: the gutter
 * of a bound book swallows part of the inner margin, so equal margins look
 * lopsided once the book is closed. The two are mirrored across recto and verso
 * by the `@page :left` / `@page :right` rules below.
 *
 * Change `width`/`height` here to move the manual to another trim size (A5 is
 * 148 × 210); nothing else in the layout is pinned to A4.
 */
const PAGE = { width: 210, height: 297, top: 24, bottom: 26, inner: 33, outer: 42 };
const MEASURE_MM = PAGE.width - PAGE.inner - PAGE.outer;

const markdownToc = [
  "Welcome",
  "Before You Start",
  "First Connection",
  "Your First Tour",
  "Everyday Flows",
  "In Depth",
  "Safe Device Use",
  "Troubleshooting",
  {
    title: "Appendices",
    children: [
      "Feature Reference",
      "Keyboard and Directional Input Reference",
      "File and Source Reference",
      "Network Ports and Services",
      "Device Safety Modes",
      "Drive Types and Disk Formats",
      "Snapshot Types and Memory Ranges",
      "Health Check Probes",
      "Status and Safety Reference",
    ],
  },
];

const anchorFor = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const renderMarkdownToc = (entries) =>
  entries.flatMap((entry) => {
    if (typeof entry === "string") return [`- [${entry}](#${anchorFor(entry)})`];
    return [
      `- [${entry.title}](#${anchorFor(entry.title)})`,
      ...entry.children.map((child) => `  - [${child}](#${anchorFor(child)})`),
    ];
  });

const profileImage = (profile, imagePath) => `../../img/app/${imagePath.replace("{profile}", profile)}`;

const image = (alt, profile, imagePath) => `![${alt}](${profileImage(profile, imagePath)})`;
const docsImage = (alt, imagePath) => `![${alt}](../../img/${imagePath})`;

const table = (headers, rows) => {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  return [header, divider, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
};

const choiceList = (values) => {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
};

const normalizeFeatureFlags = (registry) =>
  Object.fromEntries(
    registry.features.map((feature) => [
      feature.id,
      {
        ...feature,
        isUserToggleable: feature.visible_to_user && !feature.developer_only,
        isMentionable: feature.enabled || (feature.visible_to_user && !feature.developer_only),
      },
    ]),
  );

/** The same fact as {@link featureAvailability}, set apart for use as its own paragraph. */
const availabilityNote = (feature) => {
  const availability = featureAvailability(feature);
  return availability ? `_Availability: ${availability.charAt(0).toLowerCase()}${availability.slice(1)}_` : null;
};

const featureSettingGroup = (feature) => (feature.group === "stable" ? "Stable Features" : "Experimental Features");

const featureAvailability = (feature) => {
  if (!feature?.isMentionable) return null;
  if (feature.enabled && feature.isUserToggleable) {
    return `On by default. Turn it off under **${feature.title}** in Settings → ${featureSettingGroup(feature)}.`;
  }
  if (feature.enabled) return "Always on.";
  return `Off to begin with. Turn it on under **${feature.title}** in Settings → ${featureSettingGroup(feature)}.`;
};

const includeFeature = (features, id) => Boolean(features[id]?.isMentionable);

const isC64uRemoteVariant = (variant) => variant.id === "c64u-remote";

// The device that runs the app. C64U Remote is an Android-only variant built for
// a compact, keypad-first phone, so its manual always speaks of a "phone" and
// never names a model. The broad C64 Commander edition also runs on tablets, so
// it keeps the wider "phone or tablet" phrasing unchanged.
const appDeviceName = (variant) => (isC64uRemoteVariant(variant) ? "phone" : "phone or tablet");

// Subject noun for the device the app runs on, e.g. "on your phone". The broad
// edition ships for Android, iOS and as a self-hosted web build, so it must not
// name one of them.
const appDeviceSubject = (variant) => (isC64uRemoteVariant(variant) ? "your phone" : "the device running the app");

const targetDeviceDescription = (variant) =>
  isC64uRemoteVariant(variant)
    ? "a Commodore 64 Ultimate"
    : "a Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, or Ultimate-II";

/**
 * The line under the manual's title, and the line the PDF's cover repeats.
 *
 * It leads with what someone opens the app to do — listen to SID music, run games and demos, get at
 * the disks — because that is what a reader is deciding about on page 1. Diagnostics are in here and
 * are covered in their own chapter, but naming them on the cover made the app sound like a
 * fault-finding tool rather than something to enjoy a C64 with.
 *
 * Defined once, because the markdown title block and the PDF cover both set it and had drifted apart
 * before.
 */
const manualSubtitle = (variant) =>
  `Play SID music, run games and demos, mount disks, and control ${targetDeviceDescription(variant)} from one app.`;

const targetDeviceShortName = (variant) =>
  isC64uRemoteVariant(variant) ? "the Commodore 64 Ultimate" : "the connected Ultimate-family device";

const targetDevicePasswordName = (variant) =>
  isC64uRemoteVariant(variant)
    ? "the network password set on the Commodore 64 Ultimate"
    : "the network password set on the device";

const t9HostnameExamples = (variant) =>
  isC64uRemoteVariant(variant)
    ? "entries such as `c64u` and `192.168.1.64`"
    : "entries such as `c64u`, `u64`, `u2`, and `192.168.1.64`";

const supportedMachinesSection = ({ appName, variant }) =>
  isC64uRemoteVariant(variant)
    ? [
        "### Your C64 Ultimate",
        "",
        `${appName} is made for controlling a Commodore 64 Ultimate on your local network. It runs on a compact, keypad-first phone, which this guide simply calls your phone.`,
      ]
    : [
        "### Supported Machines",
        "",
        `${appName} works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II.`,
        "",
        "In lists and pickers, the source called **C64U** means the storage on your connected Ultimate-family device, reached through FTP.",
      ];

// Balanced becomes safe once the firmware carries the network-stability fixes.
//
// The figures quoted to the reader are 1.2.0 and 3.15, deliberately one release
// above the point at which `resolveAutoSafetyMode` (src/lib/config/deviceSafetySettings.ts)
// will itself pick BALANCED — 1.1.0 and 3.14d. The manual is advice a reader
// acts on by hand, so it names the firmware the fixes are known good on rather
// than the earliest build that carries them.
const balancedFirmwareNote = (variant) =>
  isC64uRemoteVariant(variant)
    ? "A Commodore 64 Ultimate on firmware later than 1.1.0."
    : "A Commodore 64 Ultimate on firmware later than 1.1.0, or an Ultimate 64-family device on 3.14d or newer.";

// What Auto resolves to, per `resolveAutoSafetyMode`. A machine it has not yet
// identified — and, in the broad edition, every Ultimate-II — stays on
// Conservative.
const autoSafetyModeNote = (variant) =>
  isC64uRemoteVariant(variant)
    ? "The one to leave it on. Reads the firmware and picks Conservative or Balanced, and stays on Conservative until it knows."
    : "The one to leave it on. Reads the model and firmware and picks Conservative or Balanced. Every Ultimate-II stays on Conservative, and so does a machine whose firmware it cannot yet read. A model it does not recognize at all starts on Balanced.";

const deviceSafetyGuidance = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Leave it on Auto. Auto keeps a Commodore 64 Ultimate on Conservative until its firmware is known to be safe. See Device Safety Modes."
    : "Leave it on Auto. It reads the model and the firmware, then chooses the profile that suits them. See Device Safety Modes.";

const safeDeviceUseIntro = ({ appName, variant }) =>
  `${appName} talks to ${targetDeviceShortName(
    variant,
  )} with ordinary REST, FTP and Telnet requests. Even so, the firmware can stop answering under some network conditions. The app lowers that risk by pacing its requests and telling you when something fails.`;

const safeDeviceUseHabits = (variant) =>
  isC64uRemoteVariant(variant)
    ? [
        "- Give a busy device time. Do not send the same command again while it is still working.",
        "- Drop to Conservative for a first setup, for Wi-Fi, or for firmware you do not yet trust.",
        "- If the web, FTP and Telnet services all stop answering while ping still works, power-cycle the Commodore 64 Ultimate.",
      ]
    : [
        "- Give a busy device time. Do not send the same command again while it is still working.",
        "- Drop to Conservative for a first setup, for Wi-Fi, or for older or unknown firmware.",
        "- If the web, FTP and Telnet services all stop answering while ping still works, power-cycle the device.",
      ];

const discoveryTargetDescription = (variant) =>
  isC64uRemoteVariant(variant) ? "a Commodore 64 Ultimate" : "supported devices";

const autoSaveConfigLocation = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Set it on the Commodore 64 Ultimate at **C= + RESTORE → User interface → Auto save config**; the same setting appears in Config as **User interface → Auto save config**."
    : "On a Commodore 64 Ultimate, set it at **C= + RESTORE → User interface → Auto save config**. C64 Commander mirrors that menu in Config as **User interface → Auto save config**. On other supported devices, search Config for **Auto Save Config** if the menu naming differs.";

/**
 * The machine's `Auto save config` governs the machine's OWN setup menu, and nothing else.
 *
 * The firmware reads it in one place, when you leave that menu on screen. A setting changed over
 * the network is applied and then left unsaved whatever it says, so the manual must not send anyone
 * to it expecting their app changes to stick. That is what the app's own setting is for.
 */
const autoSaveConfigGuidance = (variant) =>
  `The machine's own **Auto save config** does not cover this. It decides whether the machine saves changes you make in its on-screen setup menu, and has no effect on changes made from the app.\n\n${autoSaveConfigLocation(
    variant,
  )}`;

const saveToFlashGuidance = (variant) =>
  `Turn on **Keep device settings after a restart** in **Settings → Device Safety** to have the app save every device setting it changes, or use **Save** in the Config card to write the current settings to flash once.\n\n${autoSaveConfigGuidance(
    variant,
  )}`;

// Remote Input's Joystick tab relays over the `machine:input` REST endpoint,
// which arrives in Commodore 64 Ultimate firmware 1.2.0 and (C64 Commander
// only) Ultimate 64-family firmware 3.15. On anything older, or on the
// Ultimate-II which has no such endpoint, the app falls back to Keys only.
const remoteInputKeyboardImage = (profile) =>
  profile === "compact" ? "home/remote-input/03-keyboard-compact.png" : "home/remote-input/04-keyboard-medium.png";

const remoteInputFallbackExplainer =
  "Keys on its own types by placing characters in the C64's KERNAL keyboard buffer. That is ideal for BASIC: type a command, then `LOAD` and `RUN`. Most games, though, read the keyboard and joystick hardware directly and never notice it. RUN/STOP and RESTORE do not work this way either.";

const remoteInputJoystickFirmware = (variant) =>
  isC64uRemoteVariant(variant)
    ? `The **Joystick** tab needs the device's \`machine:input\` REST endpoint. The app simply asks for it. If your machine answers, the tab appears; if not, you get **Keys** only. The endpoint arrives with Commodore 64 Ultimate firmware **1.2.0**.\n\n${remoteInputFallbackExplainer}\n\nIf the device has a password, enter it in Settings first. Joystick and Keys both need it.`
    : `The **Joystick** tab needs the device's \`machine:input\` REST endpoint. The app simply asks for it. If your machine answers, the tab appears; if not, you get **Keys** only. The endpoint arrives with Commodore 64 Ultimate firmware **1.2.0**, and with Ultimate 64, Ultimate 64 Elite and Ultimate 64 Elite II firmware **3.15**.\n\nThe Ultimate-II cannot relay a joystick at all. It is a cartridge, and it cannot change the state of the C64's CIA 1 input chip, so it has no \`machine:input\` support.\n\n${remoteInputFallbackExplainer}\n\nIf the device has a password, enter it in Settings first. Joystick and Keys both need it.`;

const remoteInputFirmwareShort = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Joystick appears where the machine offers the `machine:input` endpoint, which arrives with firmware 1.2.0; otherwise only Keys are available."
    : "Joystick appears where the machine offers the `machine:input` endpoint, which arrives with firmware 1.2.0 on a Commodore 64 Ultimate and 3.15 on an Ultimate 64; otherwise only Keys are available.";

const remoteInputTroubleshootFirmware = (variant) =>
  isC64uRemoteVariant(variant)
    ? "- Confirm the Commodore 64 Ultimate is running firmware 1.2.0 or newer, which is where the endpoint arrives."
    : "- Confirm the firmware offers the endpoint: it arrives with 1.2.0 on a Commodore 64 Ultimate and 3.15 on an Ultimate 64. The Ultimate-II has no joystick relay at all.";

const featureRows = ({ features, variant }) => {
  const rows = [
    [
      "Connect to a device",
      "**Startup discovery**, Settings → Connection",
      "Let startup discovery find it first. Use Settings for later changes.",
    ],
    [
      "Manual host/IP entry",
      "**No C64 found** at startup, Settings → Connection",
      "The startup prompt is quickest the first time. Settings is for looking after saved devices.",
    ],
    ["Network password", "**Startup prompt or auth popup**, Settings → Connection", "The app asks only when needed."],
    [
      "Switch saved device",
      "**Header badge long-press / `#`**, Settings → Connection",
      "**Switch device** to change; Settings to edit.",
    ],
    ["Menu / Pause / Reset", "**Home → Quick Actions**", "The everyday controls."],
    ["Reboot", "**Home → Quick Actions → Power**", "In the Power sheet, with the other heavier controls."],
    [
      "Power Off",
      "**Home → Quick Actions → Power**",
      "Shown where the device can do it. To turn it back on, use the machine itself.",
    ],
  ];

  if (includeFeature(features, "home_telnet_power_cycle_enabled")) {
    rows.push([
      "Power Cycle",
      "**Home → Quick Actions → Power**",
      featureAvailability(features.home_telnet_power_cycle_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_clear_ram_reboot_enabled")) {
    rows.push([
      "Clear-RAM reboot",
      "**Home → Quick Actions → Power**",
      featureAvailability(features.home_telnet_clear_ram_reboot_enabled),
    ]);
  }
  if (includeFeature(features, "ram_snapshots_enabled")) {
    rows.push(["Backup / Restore", "**Home → Quick Actions**", featureAvailability(features.ram_snapshots_enabled)]);
  }
  if (includeFeature(features, "remote_input_enabled")) {
    rows.push([
      "Game Mode",
      "**Home → Quick Actions**, Play (while an item plays), `0`",
      "In the first band of Quick Actions, labeled **Game**. Opens the controller with the picture and sound as you last left them.",
    ]);
    rows.push([
      "Remote Input",
      "**Home → Quick Actions**, Play (while an item plays)",
      `${featureAvailability(features.remote_input_enabled)} ${remoteInputFirmwareShort(variant)}`,
    ]);
  }
  if (includeFeature(features, "home_telnet_reu_snapshot_enabled")) {
    rows.push([
      "Save / Restore REU",
      "**Home → Quick Actions**",
      featureAvailability(features.home_telnet_reu_snapshot_enabled),
    ]);
  }

  rows.push(
    ["CPU speed and turbo", "**Home → CPU & RAM**, Config", "Home is preferred for common changes."],
    ["Video mode and scan lines", "**Home → Video**, Config", "Home is preferred."],
    ["Joystick, serial bus, cartridge, user port", "**Home → Ports**, Config", "Home is preferred."],
  );

  // The Lighting card is named only for the variant that has lighting hardware to
  // control; the other edition describes this row by its contents instead, since naming
  // the card would put a lighting-only term in a manual for a variant with no such
  // hardware.
  rows.push([
    "Case and keyboard lights",
    isC64uRemoteVariant(variant) ? "**Home**, Config" : "**Home → Lighting**, Config",
    "Shown for machines that have them.",
  ]);
  if (includeFeature(features, "lighting_studio_enabled")) {
    rows.push(["Lighting Studio", "**Home → Lighting**", featureAvailability(features.lighting_studio_enabled)]);
  }

  rows.push(
    [
      "Drive power, bus, type, reset",
      "**Disks**, Home → Drives",
      "Disks for the drives themselves; Home for a quick look.",
    ],
    ["Mount and eject disks", "**Disks**, Home → Drives", "Disks shows the collection most clearly."],
    ["Disk groups and rotation", "**Disks**", "Groups are assigned as you add a folder; rotate from the drive card."],
    ["Soft IEC folder", "**Disks**", "Read loose files from a folder on the device, with no disk image at all."],
    ["Printer controls", "**Home → Printers**, Config", "Home is preferred."],
    ["SID mixer", "**Home → Audio**, Config → Audio Mixer", "Home is preferred for live mixing."],
    ["Streams", "**Home → Streams**, Config", "Visible when the device exposes streaming support."],
    [
      "Save/load device config",
      "**Home → Config**",
      "Save writes the current settings to flash. Keep device settings after a restart does it for you.",
    ],
    ["App-stored config snapshots", "**Home → Config**", "Named setups kept by the app, apart from the device flash."],
  );

  if (includeFeature(features, "disk_explorer_enabled")) {
    rows.push([
      "Disk Explorer (launch a program inside a disk)",
      "**Disks → disk menu → Open (Disk Explorer)**",
      featureAvailability(features.disk_explorer_enabled),
    ]);
  }
  if (includeFeature(features, "new_disk_enabled")) {
    rows.push(["Create a blank disk", "**Disks → New disk**", featureAvailability(features.new_disk_enabled)]);
  }
  if (includeFeature(features, "in_image_search_enabled")) {
    rows.push([
      "Search inside disk images",
      "**Settings → Play and Disk**, once In-image search is on",
      featureAvailability(features.in_image_search_enabled),
    ]);
  }
  if (includeFeature(features, "launch_safety_enabled")) {
    rows.push([
      "Launch Safety (cartridge parking)",
      "Automatic; boot-menu answer in **Settings → Play and Disk**",
      featureAvailability(features.launch_safety_enabled),
    ]);
  }
  if (includeFeature(features, "live_view_enabled")) {
    rows.push([
      "Live View (hear and see the machine)",
      "**Home → Live View**, Play, Remote Input",
      featureAvailability(features.live_view_enabled),
    ]);
  }
  if (includeFeature(features, "audio_mirror_enabled")) {
    rows.push([
      "Live View: Listen",
      "**Home → Live View**; switch in Settings → Experimental Features",
      featureAvailability(features.audio_mirror_enabled),
    ]);
  }
  if (includeFeature(features, "video_mirror_enabled")) {
    rows.push([
      "Live View: Watch",
      "**Home → Live View**; switch in Settings → Experimental Features",
      featureAvailability(features.video_mirror_enabled),
    ]);
  }
  if (includeFeature(features, "av_sync_tests_enabled")) {
    rows.push([
      "Live View checks (A/V sync, tap latency, tone ladder)",
      "**Home → Live View**",
      featureAvailability(features.av_sync_tests_enabled),
    ]);
  }

  if (includeFeature(features, "home_telnet_config_actions_enabled")) {
    rows.push([
      "Advanced config file actions",
      "**Home → Config**",
      featureAvailability(features.home_telnet_config_actions_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_drive_actions_enabled")) {
    rows.push([
      "Advanced drive shortcuts",
      "**Home → Drives**",
      featureAvailability(features.home_telnet_drive_actions_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_printer_actions_enabled")) {
    rows.push([
      "Advanced printer shortcuts",
      "**Home → Printers**",
      featureAvailability(features.home_telnet_printer_actions_enabled),
    ]);
  }

  rows.push(["Full configuration tree", "**Config**", "Use search, open a category, edit rows."]);

  const sources = ["Local", "C64U"];
  if (includeFeature(features, "hvsc_enabled")) sources.push("HVSC");
  if (includeFeature(features, "commoserve_enabled")) sources.push("CommoServe");
  rows.push(["Add playlist items", "**Play → Add items**", `Sources: ${sources.join(", ")}.`]);
  rows.push([
    "Playback controls",
    "**Play**",
    "Play, stop, pause, previous and next, shuffle, repeat, reshuffle, volume.",
  ]);
  rows.push(["Sleep timer, default duration, songlengths file", "**Play**", "Beneath the transport controls."]);
  rows.push([
    "Per-item playback config",
    "**Play → item menu**",
    "Apply a device configuration before one playlist item runs.",
  ]);

  if (includeFeature(features, "hvsc_enabled")) {
    rows.push([
      "HVSC preparation",
      "**Play → Add items**, card at the foot of Play",
      `${featureAvailability(features.hvsc_enabled)} Settings → HVSC holds the mirror and the update check.`,
    ]);
    rows.push([
      "SID Radio",
      "**Play → SID Radio**",
      "Endless stations of similar tunes. Settings → SID Radio tunes it.",
    ]);
  }
  if (includeFeature(features, "commoserve_enabled")) {
    rows.push([
      "CommoServe",
      "**Play → Add items**, Disks → Add disks, Settings → Online Archive",
      featureAvailability(features.commoserve_enabled),
    ]);
  }
  if (includeFeature(features, "demo_mode_enabled")) {
    rows.push([
      "Demo Mode",
      "**Settings → Connection**",
      `${featureAvailability(features.demo_mode_enabled)} Offered when no C64 Ultimate can be reached; see Starting With No Network. **Preview Demo Mode**, in the same section, switches to it at any time, and **Use the simulated device** appears behind the connectivity badge whenever the app is offline.`,
    ]);
  }
  if (includeFeature(features, "background_execution_enabled")) {
    rows.push([
      "Background playback scheduling",
      "**Play**, Android app permissions",
      featureAvailability(features.background_execution_enabled),
    ]);
  }

  rows.push(
    [
      "Display profile, theme, style, text size, card descriptions, orientation",
      "**Settings → Appearance**",
      isC64uRemoteVariant(variant)
        ? "Screenshots in this manual use the compact profile, the smallest screen the app supports."
        : "Screenshots in this manual use the medium profile.",
    ],
    [
      "Settings transfer (export and import)",
      "**Settings → Diagnostics**",
      "App settings, feature switches and safety tuning. Saved devices and passwords stay behind.",
    ],
    ["Notification style and duration", "**Settings → Notifications**", "Show everything, or errors alone."],
    ["Device Safety", "**Settings → Device Safety**", deviceSafetyGuidance(variant)],
    [
      "Keep device settings after a restart",
      "**Settings → Device Safety**",
      "Off at first: changes apply at once, and a power cycle undoes them. See Making settings stick.",
    ],
    ["Screen colors (palette)", "**Home → Video → Screen colors**", "Apply to this device, the C64, or both."],
    ["Diagnostics", "**Header badge / `*`**, Settings → Diagnostics", "The badge is quickest."],
    ["Logs, traces, errors, health checks", "**Diagnostics**", "Filter to find it; Share to send it."],
    ["Built-in help", "**Docs**", "Quick reminders inside the app."],
  );

  return rows;
};

const sourceRows = ({ features, variant }) => {
  const rows = [
    [
      "Local",
      "Play, Disks",
      isC64uRemoteVariant(variant)
        ? "Files and folders available on your phone."
        : "Files and folders available on the device running the app.",
    ],
    [
      "C64U",
      "Play, Disks",
      isC64uRemoteVariant(variant)
        ? "Files on the Commodore 64 Ultimate through FTP."
        : "Files on the connected Ultimate-family device through FTP.",
    ],
  ];
  if (includeFeature(features, "hvsc_enabled")) {
    rows.push([
      "HVSC",
      "Play",
      `${featureAvailability(features.hvsc_enabled)} SID library browsing after preparation.`,
    ]);
  }
  if (includeFeature(features, "commoserve_enabled")) {
    rows.push([
      "CommoServe",
      "Play, Disks",
      `${featureAvailability(features.commoserve_enabled)} Online archive search.`,
    ]);
  }
  return rows;
};

const renderKeyboardReference = ({ features, variant }) => {
  if (!includeFeature(features, "keypad_input_enabled")) return "";

  const sections = [
    "### Keyboard and Directional Input Reference",
    "",
    `${featureAvailability(features.keypad_input_enabled)} Directional navigation answers to D-pad keys, arrow keys, and hardware keyboards.`,
    "",
    "While you are steering by keys, a bar along the bottom shows where you are and what the keys under your thumb will do: Back, Exit, Done or Close on the left; Open, Activate, Edit, Select, Toggle, Adjust or Switch in the middle; Menu on the right where there is one; and, on Home and Play, a reminder that `0` starts Game Mode.",
    "",
    "#### Directional Pad",
    "",
    table(
      ["Key", "What it does"],
      [
        ["Up / Down", "Move through the current page, card, list, or dialog in reading order; the tab bar comes last."],
        ["Left / Right", "Adjust sliders, tabs, and segmented controls. Otherwise move to a nearby control."],
        ["OK / Center / Enter", "Enter a group, open a select, press a button, or toggle a switch."],
        ["Back / Escape", "Close the top dialog, leave a field, leave a group, or go back."],
        ["Menu / Context Menu", "Open the focused item menu; if none exists, open the Quick menu."],
      ],
    ),
    "",
    isC64uRemoteVariant(variant)
      ? "Two keys carry most of it: **D-pad Center/OK goes in, Left Soft Key comes out**, and **Right Soft Key opens choices**. F1 and F3 are separate shortcuts you can set yourself; they never stand in for the soft keys."
      : "Two keys carry most of it: **OK goes in, Back comes out**. **F2** acts as the Menu soft key, and **F1** and **F3** are the transport keys on every keyboard (below).",
    "",
    "#### Number Keys",
    "",
    "Outside text fields, the number keys jump to pages, and **0** goes straight to playing. An open dialog or sheet keeps them for itself:",
    "",
    table(
      ["Key", "Page"],
      [
        ["1", "Home"],
        ["2", "Play"],
        ["3", "Disks"],
        ["4", "Config"],
        ["5", "Settings"],
        ["6", "Docs"],
        ["7", "Search"],
        ["0", "Game Mode"],
      ],
    ),
    "",
    "`7` opens search even with directional navigation switched off.",
    "",
    isC64uRemoteVariant(variant) ? "#### Function Keys" : "#### Transport Keys",
    "",
    table(
      ["Key", "What it does"],
      [
        ["F1", isC64uRemoteVariant(variant) ? "Run its normal-navigation assignment (default: Play/Pause)" : "Play or pause, from any page"],
        ["F3", isC64uRemoteVariant(variant) ? "Run its normal-navigation assignment (default: Next tune)" : "Next tune, from any page"],
      ],
    ),
    "",
    isC64uRemoteVariant(variant)
      ? "Change either one in **Settings → Play and Disk → Remote function keys**. A function-key shortcut acts without changing page. While a C64 keyboard or joystick screen has the keypad, it sends the C64 key with the same label instead. **The Commodore key is not bound yet.** To see what your own keys send, open **Diagnostics → Key Explorer** and press one."
      : "Press either from any page and the app takes you to Play and does it there. **The Commodore key is not bound yet.** To see what your own keys send, open **Diagnostics → Key Explorer** and press one.",
    "",
    "#### Star and Pound",
    "",
    table(
      ["Key", "Outside text fields", "Inside text fields"],
      [
        [
          "`*`",
          "Open Diagnostics",
          variant.runtime.defaultT9InputEnabled
            ? "Cycle separators such as `.`, `:`, `-`, `_`, `/` in host fields"
            : "Type `*` when the field accepts it",
        ],
        [
          "`#`",
          "Open **Switch device**",
          variant.runtime.defaultT9InputEnabled ? "Toggle T9 mode" : "Type `#` when the field accepts it",
        ],
      ],
    ),
  ];

  if (variant.runtime.defaultT9InputEnabled) {
    sections.push(
      "",
      "#### T9 Text Entry",
      "",
      "T9 lets you type letters on the number keys, in fields such as hostnames and filters.",
      "",
      "1. Focus a text field.",
      "2. Press `#` if you need to toggle T9 mode.",
      "3. Press number keys to enter letters.",
      "4. Press `*` in host fields to cycle separators.",
      "5. Use Back to leave the field.",
      "",
      `For hostnames, this makes ${t9HostnameExamples(variant)} practical without a touchscreen.`,
    );
  }

  sections.push(
    "",
    "#### Quick menu",
    "",
    "There are two ways in. Press **Menu** when the selected control has no menu of its own, and the Quick menu lists the six pages with the number key for each, then Game Mode on `0`, Diagnostics on `*`, and **Switch device** on `#` when more than one device is saved.",
    "",
    "Or tap the three-dot **Quick menu** button in the top bar, beside the health badge. Opened that way, the menu skips the page jumps and offers the actions for the page you are on.",
    "",
    "Either way, **Search** comes first.",
    "",
    "On a page built from cards, both also offer **Expand all sections**, **Collapse all sections**, and **Show card descriptions** (**Hide card descriptions** once they are on). Both section entries are always listed, so each stays in the same place; the one that would do nothing is grayed out.",
  );

  return sections.join("\n");
};

export const renderManualMarkdown = ({ variant, features }) => {
  const appName = variant.displayName;
  const title = `${appName} Manual`;
  const subtitle = manualSubtitle(variant);
  // Each manual illustrates the app at one display profile, and the two manuals do not
  // use the same one: a reader should see the app at the size their own device renders
  // it, not at someone else's. The C64U Remote edition ships on a 320x426 screen and is
  // illustrated at `compact`; the C64 Commander edition is illustrated at `medium`, an
  // ordinary phone.
  //
  // This was briefly hardcoded to "compact" for both, on the reasoning that a reader on a
  // larger screen simply sees more than the picture shows. That is true of the layout but
  // not of the controls: some labels are shortened at compact - "RSTOP" for "RUN/STOP" -
  // so the compact pictures name buttons that a medium-profile reader cannot find. (The
  // Quick Action tiles read "Game" and "Input" on every profile, so they are not an example.)
  //
  // The only images exempt are the ones that exist to demonstrate how the profiles differ.
  // assertSingleDisplayProfile enforces this when the manual is written.
  const profile = variant.id === "c64u-remote" ? "compact" : "medium";
  const sourceLabels = ["Local", "C64U"];
  if (includeFeature(features, "hvsc_enabled")) sourceLabels.push("HVSC");
  if (includeFeature(features, "commoserve_enabled")) sourceLabels.push("CommoServe");
  // Disks draws on fewer sources than Play: HVSC is an archive of music and holds
  // no disk images to add.
  const diskSourceLabels = ["Local", "C64U"];
  if (includeFeature(features, "commoserve_enabled")) diskSourceLabels.push("CommoServe");

  const sections = [
    `# ${title}`,
    "",
    subtitle,
    "",
    image(`${appName} launch screen`, profile, "launch/profiles/{profile}/04-app-ready.png"),
    "",
    "## Table of Contents",
    "",
    ...renderMarkdownToc(markdownToc),
    "",
    "## Welcome",
    "",
    `${appName} puts your C64 at your fingertips: its music, its games, its disks and its settings, over your own home network.`,
    "",
    "- **It plays.** SID music, games, demos and disk images, from your own files, from the machine itself, or from the great free archives.",
    "- **It controls.** Reset, reboot, the menu, the drives, the printer, the SID mixer, memory, and every setting the machine has.",
    "- **It explains.** When something will not answer, health checks, logs and traces show what happened and where.",
    "",
    "New to the app? Start with the next three chapters. They get you connected and then walk you through it one page at a time. Later, when you know what you want, the reference chapters at the back will find it for you quickly.",
    "",
    "## Before You Start",
    "",
    ...supportedMachinesSection({ appName, variant }),
    "",
    `Three things work together: ${appDeviceSubject(variant)}, ${targetDeviceShortName(variant)}, and the network between them.`,
    "",
    "First, put the two on the same Wi-Fi or wired network. Then, on the machine itself, open **Network Services & Timezone**.",
    "",
    docsImage("C64 Ultimate Network Services & Timezone menu", "setup/enable_services.png"),
    "",
    "Turn on the services the app uses:",
    "",
    "- **Web Remote Control Service** carries almost everything: the controls, the status, the settings. The app cannot work without it.",
    "- **FTP File Service** carries the files, so the app can browse the machine, build playlists and mount disks.",
    "- **Telnet Remote Menu Service** carries a few extra actions that reach into the device menu. Turn it on if you want them.",
    "",
    `Now jot down the IP address shown under **Wired Network Setup** or **WI-FI Network Setup**. You will need it if the app cannot find ${targetDeviceShortName(variant)} by itself.`,
    "",
    "## First Connection",
    "",
    `Next, start ${appName}. If no saved device is reachable, it scans the local network for ${discoveryTargetDescription(
      variant,
    )}.`,
    "",
    "If it finds one, the app opens **Choose your C64**:",
    "",
    "1. Choose **Use** to connect now.",
    "2. Choose **Save** to keep the device for later.",
    "3. If the device has a password, enter its network password when asked.",
    "",
    `If it finds nothing, ${appName} opens **No C64 found** so you can set it up by hand.`,
    "",
    isC64uRemoteVariant(variant)
      ? "Enter a hostname such as `c64u` or an IP address such as `192.168.1.64`, then choose **Connect**. If the Commodore 64 Ultimate asks for a password, the same dialog asks you for it before saving and connecting."
      : "Enter a hostname such as `c64u`, `u64`, or `u2`, or an IP address such as `192.168.1.64`, then choose **Connect**. If the device asks for a password, the same dialog asks you for it before saving and connecting.",
    "",
    "Now look at the top right of the screen. A green badge there means your C64 is answering. You are ready to go! To scan again later, use **Settings → Connection → Discover devices**.",
    "",
    "### Starting With No Network",
    "",
    `Start ${appName} on a ${appDeviceName(variant)} with no network at all (airplane mode, or Wi-Fi and mobile data both off), and there is nothing to scan for. Instead, the app offers **Demo Mode**: a built-in simulation of ${targetDeviceDescription(variant)}. Choose **Continue in Demo Mode** and the badge reads **Demo mode**, so you always know which machine you are looking at.`,
    "",
    `Try anything the simulator answers for: Home, the configuration, disks and drives, the playlist, Remote Input, the HVSC collection, and Live View, which shows the simulated screen and plays its sound. There is no real 6502 inside, so a program shows a demonstration screen, and a tune plays on your ${appDeviceName(variant)}'s own SID engine.`,
    "",
    `Close the offer, or choose **Try again** while there is still no network, and the app stays offline without offering Demo Mode again that session. Tunes stored on your ${appDeviceName(variant)} still play there. When your ${appDeviceName(variant)} joins a network where your C64 Ultimate answers, the app connects by itself. **Use the simulated device**, behind the connectivity badge, brings Demo Mode back whenever you like.`,
    "",
    "When you do have hardware, connect to it from **Settings → Connection**. Once the app has reached a real device, it never slips into Demo Mode on its own for the rest of that session. If the network goes away, the device is shown offline, and the app reconnects when the network returns.",
    "",
    "The offer keeps coming until you have seen it once and a C64 Ultimate has connected. After that, the app assumes you are simply away from your machine: it shows the device offline without asking, and connects again when it can. **Use the simulated device** and **Preview Demo Mode** still start Demo Mode when you want it.",
    "",
    "## Your First Tour",
    "",
    "Let's take a walk through the app, one page at a time. First come two things you can reach from anywhere: the badge in the corner, and search.",
    "",
    "### The Header Badge",
    "",
    "The badge at the top right tells you how your C64 is doing: healthy, degraded, unhealthy, or offline. Tap it to open Diagnostics. While the app is offline, the same tap also tries to connect again. Long-press it to open **Switch device**.",
    "",
    "### Finding Your Way",
    "",
    "Search covers the whole app: every page, every card, every app setting, your disk collection, the HVSC archive, and the tunes you have liked or played lately. Type two or three letters and pick what you want.",
    "",
    "Your machine's own settings join in once the Config page has read them. So if you are hunting for a device setting by name, open **Config** first.",
    "",
    "There are three ways to open search:",
    "",
    "- Tap the **search field** at the top of Home.",
    "- Choose **Search**, the first entry of the **Quick menu**.",
    "- Press **`7`**, which works even with directional navigation switched off.",
    "",
    "Keep typing while you look. Up and Down move through the results without touching your text, OK opens the selected result, and Back closes search. The best match comes first, so typing `radio` offers **Start SID Radio** ahead of any tune with that word in its title.",
    "",
    image("Search, one query in", profile, "home/search/profiles/{profile}/01-overlay.png"),
    "",
    '**A result you cannot use yet is still listed, and says what it needs:** "Needs a connected C64 Ultimate", "Needs the HVSC music collection installed", "Live View is turned off in Settings". Pick it, and you land on the setting that turns it on.',
    "",
    "Search finds your music too. Pick a tune from the HVSC collection, and **Find a tune** opens on the Play tab with that title filled in.",
    "",
    "With the box empty, search suggests four good places to start, then lists your recent searches.",
    "",
    "### The Tour",
    "",
    `The first time you open ${appName}, it offers a short guided tour inside the app itself. It visits each page in turn, points at one thing, and explains it in a line or two.`,
    "",
    "**Next** and **Back** move you along, **Skip** ends the tour, and a counter shows how far you have come. On a keypad, Left and Right are Back and Next, OK is Next, and the Back key leaves. Stop whenever you like.",
    "",
    "To take it again, use the card at the top of **Docs**, or go to **Settings \u2192 About \u2192 Take the tour**. If you took the tour before connecting your C64, Home offers the steps you missed as soon as your machine answers.",
    "",
    "### Home",
    "",
    "Home groups the day-to-day controls.",
    "",
    image("Home overview", profile, "home/profiles/{profile}/01-overview.png"),
    "",
    "At the top is the search field, and under it **Quick Actions**, a grid of tiles in four bands:",
    "",
    "- **Watch** first: Live, Game and Input.",
    "- **Listen** next: Radio, Last and Recent.",
    "- Then the everyday controls: Menu, Pause/Resume, and **Backup** and **Restore** for the machine's memory.",
    "- Last come **Reset** and **Power**, which interrupt whatever your C64 is doing.",
    "",
    "Three tiles work with no C64 at all. **Radio** starts a SID Radio station of thousands of tunes, played on this device. **Last** picks up your last tune where it stopped, and names it underneath. **Recent** takes you back to anything you have opened before.",
    "",
    "**Live** does need a machine. It takes you to the card that brings the C64's picture and sound into the app. A tile you cannot use yet is still there, grayed out, telling you what it needs.",
    "",
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "**Game** and **Input** turn the app into a joystick and keyboard for the C64. See [Remote Input](#remote-input).",
          "",
        ]
      : []),
    "**Power** opens a sheet with **Reboot** and, where your device supports it, **Power Off**. Those, and **Reset**, ask you to confirm first.",
    "",
    "Two more actions can join that sheet: **Reboot (Clr Mem)**, which wipes memory on the way, and **Power Cycle**. Both work through the Telnet menu service, so switch Telnet on at the device first. Their switches are **Home clear-RAM reboot action** and **Home power cycle action**, in **Settings → Experimental Features**.",
    "",
    ...(includeFeature(features, "audio_mirror_enabled") || includeFeature(features, "video_mirror_enabled")
      ? [
          "Just below sits the **Live View** card, which brings the running machine's sound and picture into the app. It has a chapter of its own: see [Live View](#live-view).",
          "",
        ]
      : []),
    // The Lighting card is named only for the variant that has lighting hardware to
    // control; the other edition describes it by its contents instead of its name, since
    // naming the card would put a lighting-only term in a manual for a variant with no
    // such hardware.
    `The rest of Home is a stack of cards. Tap a header to open or close one.`,
    "",
    "- **CPU & RAM**: the processor speed, turbo behavior and the RAM expansion.",
    "- **Ports**: the joystick swap, the serial bus, the cartridge preference and the user port.",
    "- **Video**: the output mode, resolution and scan lines.",
    "- **Audio**: the SID mixer's channel strips.",
    "- **User Interface**: the interface type, navigation style and Color Scheme of the machine's own menus.",
    isC64uRemoteVariant(variant)
      ? "- The case and keyboard lights, on a machine that has them."
      : "- **Lighting**: the case and keyboard lights, on a machine that has them.",
    "- Then drives, the printer, streams, and **Config**, which saves and loads the machine's settings. See [Configuration and Saving](#configuration-and-saving).",
    "",
    "The app remembers which cards you left open. On the compact display profile, opening one card closes the others, so the titles stay on screen. **Expand all sections** and **Collapse all sections** in the Quick menu do the whole page at once. Everything here is in Config too; these cards just save you the search.",
    "",
    "At the foot of the page, the system strip shows which app build, device and firmware you are on. Check it before an upgrade, or when something seems wrong.",
    "",
    '**With no C64 connected**, Home rearranges itself. The search field stays, and so do Radio, Last, Recent and Live, set below a card that explains how to connect. Live needs a machine, so it is grayed out and reads "Needs a connected C64 Ultimate".',
    "",
    "The machine's own cards stay as empty titles under a line that says why, and the system strip shows only the app version.",
    "",
    "The moment your C64 answers, your open cards are open again. A brief network hiccup will not shuffle the page under you either: the app waits a few seconds before rearranging, and snaps back the instant your machine returns.",
    "",
    "### Play",
    "",
    "Play is for building a playlist and running it.",
    "",
    image("Play overview", profile, "play/profiles/{profile}/01-overview.png"),
    "",
    "Choose **Add items** (it reads **Add more items** once the list has something in it), then choose a source.",
    "",
    image("Add items source chooser", profile, "play/import/profiles/{profile}/01-import-interstitial.png"),
    "",
    "The picker stays inside the source you chose, so **Up** never wanders off somewhere else. Tick files or folders and confirm. **Include subfolders** decides whether a ticked folder means just that folder or everything beneath it. That can be the difference between adding twelve files and twelve thousand!",
    "",
    "> **Tip.** Tick a single program, cartridge or disk, and the confirm button reads **Play** instead of **Add to playlist**: the machine starts it right away. A tune, several files, a whole folder, or an online archive result are added to the queue as usual.",
    "",
    image("C64U file picker", profile, "play/import/profiles/{profile}/02-c64u-file-picker.png"),
    "",
    "Play handles SID and MOD music, PRG programs, CRT cartridges, and disk images. One SID file can hold several pieces of music, which this guide calls tunes. When the app knows how long a tune is, it shows the length and moves on at the right moment.",
    "",
    image("Playlist view all", profile, "play/profiles/{profile}/02-view-all.png"),
    "",
    "A playlist can hold a single song, or a whole evening's worth.",
    "",
    "A short list fits on the Play page. When it grows, open **View all**. There you have room to scan, filter, select and remove, with the playback controls still in sight. **Settings → Play and Disk → List preview limit** sets how many rows Play shows before you need View all; it starts at 50.",
    "",
    "> **Tip.** Add broadly, then filter narrowly. Add a whole folder, then type a few letters to narrow it down. The filter matches the title, the path, the source and the kind of file.",
    "",
    "A filter only hides rows; it never changes the playlist. Clear the box and the whole queue comes back.",
    "",
    "Every item remembers where it came from. Local files stay local, C64U files point back at the device, archive results remember their source, and SID entries carry their tunes and lengths with them.",
    "",
    "Rows show titles rather than file names: `Bossa_in_Do_2SID.sid` appears as *Bossa in Do*, with a small badge when a tune uses more than one SID chip. Prefer the file names? Turn off **Settings → Play and Disk → Friendly SID names**.",
    "",
    "The transport controls run the show: play, stop, pause and resume, previous and next, shuffle, repeat, reshuffle, and volume. Beneath them sit a **sleep timer**, a **default duration** for anything whose length is unknown, and a **songlengths file** you can choose by hand if you have one.",
    "",
    "Each row has its own menu with the item's details and its **playback config**: settings the app applies to the machine just before that item runs. To take items out, tick them and choose **Remove selected items**.",
    "",
    `Playback carries on when you leave the app or lock your ${appDeviceName(
      variant,
    )}, and your playlist and your place in it are waiting the next time you open it. On Android, a notification names the tune and carries **Pause**, **Next** and **Stop**, so you can run things from the lock screen. When you pause, it stays for ten minutes with **Play** in the first slot; then the session ends, and the next **Play** starts a new one.`,
    "",
    "Play is the quick way to start a disk and see what it does. When the drives or your disk collection are what you are after, go to Disks.",
    "",
    "### Disks",
    "",
    "Disks is where the drives and your disk images live.",
    "",
    image("Disks overview", profile, "disks/profiles/{profile}/01-overview.png"),
    "",
    "At the top are three drive cards: **Drive A**, **Drive B**, and a **Soft IEC Drive** that reads loose files from a folder instead of a disk image. Each card header shows the drive's power and the mounted disk, so you can check and change both without opening it. **Drive A** starts open, the other two closed.",
    "",
    "Below the drives, **Add disks** builds your collection from the sources you have.",
    "",
    image("Disk collection view", profile, "disks/profiles/{profile}/02-view-all.png"),
    "",
    "Add a single image, a folder of them, or a result from the online archive. When you add a folder, the app also groups what it finds, so a multi-disk title usually arrives ready to swap through.",
    "",
    "Filter by name, path or group to find something. A filter never deletes or moves anything.",
    "",
    "Mounting is what the page is for. Choose the disk, choose the drive, mount it; **Eject** empties the drive again. Each disk's menu also offers **Rename disk**, which changes the name in your collection and leaves the file itself alone.",
    "",
    "Come to Disks whenever more than one disk is involved: the collection, the groups and the drives are all on one page. The drives themselves are explained in [Drives and Disk Images](#drives-and-disk-images).",
    "",
    "### Config",
    "",
    "Config holds every setting your machine has, laid out as one searchable tree.",
    "",
    image("Config overview", profile, "config/profiles/{profile}/01-overview.png"),
    "",
    "Every category the device reports has a card of its own. Open one and edit its rows directly. Each item gets the control that suits it: a slider, a select, a checkbox, a text field, or a hidden field for a password. The app remembers which cards you left open.",
    "",
    "Config edits the live machine, not a draft. A change goes to the device the moment you make it. Most take effect at once; a few, such as the cartridge choice, wait for the next reset. To make a change survive a power cycle, see [Configuration and Saving](#configuration-and-saving).",
    "",
    "Come here when you know a setting exists but not where the device menu keeps it. The search box narrows the tree to the pages and groups whose names match. After changing a value, let the write finish before you change a related one. For everyday settings, the cards on Home are quicker.",
    "",
    "### Settings",
    "",
    "Settings controls how the app behaves, and holds your saved devices.",
    "",
    image("Settings overview", profile, "settings/profiles/{profile}/01-overview.png"),
    "",
    "Settings is a list of chapters, each with a one-line summary under its heading. **Connection** is open on your first visit; the rest start closed, and whatever you leave open stays open next time.",
    "",
    "The chapters are **Appearance**, **Connection**, **Diagnostics**, **Play and Disk**, **Stable Features**, **Experimental Features**, **SID Radio**, **HVSC**, **Online Archive**, **Device Safety**, **Notifications**, and **About**. The two feature chapters show how many of their switches are on, **8/9 on** for example. **HVSC** and **Online Archive** disappear if you switch their features off.",
    "",
    "If the device is hard to reach, start in **Connection**. If it answers but seems fragile, start in **Device Safety**.",
    "",
    "**Connection** holds your saved devices: each one's name, host, HTTP, FTP and Telnet ports, and network password. Before keeping a device, the app checks that its web service answers. FTP and Telnet are stored as you typed them, and a health check tests them later.",
    "",
    `**Appearance** is local to the app and never touches your C64. It sets the theme, the style, the text size, the display profile, card descriptions, whether the app runs full screen, and whether it turns with your ${appDeviceName(
      variant,
    )} or stays in portrait or landscape.`,
    "",
    "**Style** is a set of colors, corners and shading. It sits on top of **Theme**, which stays your light-or-dark switch. Pick a style, or choose **Match my device** to follow the Color Scheme your C64 Ultimate is set to.",
    "",
    "Match my device reads your machine each time you connect. If it cannot read it yet, it keeps the current style and shows a note. Two styles come in one shade only; for those, Theme is grayed out and Settings tells you why.",
    "",
    "There are seven styles:",
    "",
    table(
      ["Style", "What it is"],
      [
        ["Cool Grey", "Neutral, with a cool blue lean. The one the app starts with."],
        ["Breadbin Beige", "The warm beige of the original case."],
        ["Ocean Teal", "Deep blue-green with a warm coral highlight."],
        ["Neon Pop", "Translucent covers by day, arcade cabinet by night."],
        ["Amber Glow", "An amber monitor. Dark only."],
        ["Vault Black", "Near-black with a two-tone band. Dark only."],
        ["High Contrast", "Maximum legibility: heavy edges, strong text, no soft fills."],
      ],
    ),
    "",
    "**Text size** makes everything in the app bigger. Choose **Default**, or **Large**, which is 15 percent larger. The display profile beside it changes the layout, not the type.",
    "",
    "If the tab bar along the bottom runs out of room, it scrolls sideways. Reach a page another way, and its tab scrolls into view.",
    "",
    "**Card descriptions** adds a one-line summary under each card's title. It starts off. Turn it on if you would rather read what a card holds than remember it; on a small screen it makes each closed card about half as tall again. The Quick menu switches it too, without leaving the page.",
    "",
    "**Diagnostics** opens the diagnostics panel and switches debug logging on. It also holds **Settings transfer**.",
    "",
    `Settings transfer saves your app settings, feature switches and device-safety tuning to a file you can import on another ${appDeviceName(
      variant,
    )}. Saved devices and passwords are left out, so the file is safe to pass around.`,
    "",
    "**Notifications** decides whether you see every message or only errors, and how long each stays on screen. **About** shows the version and links to the open source licenses.",
    "",
    "Feature switches appear only for features that are safe for anyone to change.",
    "",
    "#### Making settings stick",
    "",
    `A setting you change from the app reaches ${targetDeviceShortName(
      variant,
    )} at once: the colors, the video mode, the LED lights and the rest all change as you go.`,
    "",
    "By default, that is as far as it goes. Switch the machine off and on, and it comes back the way it was. So go ahead and experiment: nothing you try from the app is permanent.",
    "",
    "**Keep device settings after a restart**, in **Settings → Device Safety**, changes that. With it on, every device setting the app changes is also saved in the machine's own storage, just as if you had saved it from the machine's setup menu.",
    "",
    "> **Take care.** Turn this on deliberately. A setting that makes the machine awkward to use will come back every time you switch on.",
    "",
    `If that happens, hold **RESTORE** while you switch ${targetDeviceShortName(
      variant,
    )} on. It starts with its default settings instead of the saved ones, and you have a working machine again. Nothing is erased: your saved values are still there, so you can put the setting right and save again.`,
    "",
    "### Docs",
    "",
    "Docs is the built-in help page: a pocket version of this manual, inside the app.",
    "",
    image("Docs overview", profile, "docs/profiles/{profile}/01-overview.png"),
    "",
    isC64uRemoteVariant(variant)
      ? "It covers setup, Home, Play, Disks, Config, Settings, Diagnostics and disk swapping."
      : "It covers setup, Home, Play, Disks, Config, Settings, Diagnostics and disk swapping, and ends with links to the official device manuals and reference material.",
    "",
    "### Diagnostics",
    "",
    "Diagnostics shows how the connection is doing, what the app has been up to, and anything that has failed.",
    "",
    image("Diagnostics overview", profile, "diagnostics/profiles/{profile}/01-overview.png"),
    "",
    "Open it when a control does nothing, playback will not start, a file transfer stalls, or the badge stops looking healthy. Inside are the health check, four kinds of activity (Problems, Actions, Logs and Traces), filters, latency and heat-map views, Share, and Clear.",
    "",
    "Start with Problems for a plain-language summary. See [Reading Diagnostics](#reading-diagnostics) for the rest, and [Sharing a Diagnostics Report](#sharing-a-diagnostics-report) when you want help.",
    "",
    "### Device Switching",
    "",
    isC64uRemoteVariant(variant)
      ? "**Switch device** is for homes with more than one saved Commodore 64 Ultimate."
      : "**Switch device** is for homes with more than one saved Ultimate-family device.",
    "",
    image("Device switcher", profile, "diagnostics/switch-device/profiles/{profile}/01-picker.png"),
    "",
    "Long-press the badge to open it. [Switching Between Devices](#switching-between-devices) has the details.",
    "",
    image("Device switcher expanded", profile, "diagnostics/switch-device/profiles/{profile}/02-picker-expanded.png"),
    "",
    "## Everyday Flows",
    "",
    "Here are short recipes for the things you will do most. Follow the numbered steps, and that is the whole job. Where the app offers more than one route, the line after the steps says which to take.",
    "",
    "### Connect by Hand",
    "",
    "1. Open **Settings → Connection**, or use the startup prompt when discovery finds nothing.",
    "2. Enter a hostname or IP address.",
    "3. Choose **Save & Connect** or **Connect**.",
    "4. Enter the network password if asked.",
    "",
    "Preferred path: let startup discovery try first, and type the address only if it finds nothing.",
    "",
    "### Maintain Saved Devices",
    "",
    "1. Open **Settings → Connection**.",
    "2. Review the saved-device list.",
    "3. Give each device a name you will recognize, and check its ports.",
    "4. Choose **Save & Connect** after changing the active device.",
    "5. Remove any device that is no longer on your network.",
    "",
    "Preferred path: Settings to edit devices, **Switch device** to move between them.",
    "",
    "### Reboot and Carry On",
    "",
    "1. Open **Home**.",
    "2. Choose **Power**, then **Reboot**.",
    "3. Confirm.",
    "4. Watch the badge until it shows healthy again.",
    "",
    "Preferred path: Home. Open Diagnostics only if the device does not come back.",
    "",
    "### Play a SID or Program",
    "",
    "1. Open **Play**.",
    "2. Choose **Add items**.",
    `3. Choose ${choiceList(sourceLabels)}.`,
    "4. Select files or folders.",
    "5. Confirm, then press Play.",
    "",
    `Preferred path: choose C64U for files already on your C64, and Local for files on ${appDeviceSubject(variant)}.`,
    "",
    "### Build a Playlist from Folders",
    "",
    "1. Open **Play → Add items**.",
    "2. Choose the source that owns the folder.",
    "3. Navigate into the folder.",
    "4. Select the files or folders you want.",
    "5. Confirm the selection.",
    "6. Open **View all** if the list is long.",
    "",
    "To search instead of browsing, type in the box at the top. **This folder** narrows what is on screen. **Everywhere** searches the whole source by title or composer, which for HVSC means all sixty thousand or so files.",
    "",
    "Some sources have to be read one folder at a time, such as a folder on your device or the card in your C64. These offer a **Scan** button instead of searching as you type.",
    "",
    image(
      "Searching the whole of HVSC rather than one folder",
      profile,
      "play/import/profiles/{profile}/09-hvsc-search-scope.png",
    ),
    "",
    "Preferred path: add a whole folder first, then filter the playlist to pick what plays next.",
    "",
    "### Filter and Clean a Playlist",
    "",
    "1. Open **Play → View all**.",
    "2. Type a few characters from the title, the path, the source, or the kind of file.",
    "3. Review the rows that remain.",
    "4. Tick the ones you do not want and choose **Remove selected items**, or clear the filter to bring the whole list back.",
    "",
    "Preferred path: filter first, then remove. The filter alone never removes anything.",
    "",
    "### Choose a Tune Inside a SID",
    "",
    "1. Add one or more SID files to Play and start one.",
    "2. On the Now Playing card, tap the tune position, **1/19**, to list every tune in the file with its name and length.",
    "3. Tap a tune to play it, or use **Play all 19 tunes** to add the whole file to the playlist in order.",
    "",
    "Preferred path: the Now Playing card. The playlist rows have no tune chooser.",
    "",
    "### Mount a Disk",
    "",
    "1. Open **Disks**.",
    "2. Add disks if the collection is empty.",
    "3. Open the drive's mount action.",
    "4. Choose a disk.",
    "",
    "Preferred path: Disks. Home has drive shortcuts too, but Disks shows your whole collection.",
    "",
    "### Build a Disk Collection",
    "",
    "1. Open **Disks → Add disks**.",
    `2. Choose ${choiceList(diskSourceLabels)}.`,
    "3. Select disk images or folders.",
    "4. Confirm the selection.",
    "5. Use **View all** to inspect the collection.",
    "",
    "Preferred path: Disks to build a collection; Play to queue things up and start them.",
    "",
    "### Filter, Group, and Rotate Disks",
    "",
    "1. Open the disk collection view.",
    "2. Filter by name, path, or group.",
    "3. Check the groups the app made when you added the folder, and move any stragglers into the right one.",
    "4. Mount the first disk.",
    "5. When the program asks for the next disk, use the rotate controls on the drive card.",
    "",
    "Preferred path: group related disks before you need to swap them.",
    "",
    "### Mount to a Specific Drive",
    "",
    "1. Open **Disks**.",
    "2. Check that the drive you want is switched on.",
    "3. Check its bus ID and type if the program is particular.",
    "4. Choose the disk image.",
    "5. Mount it to the intended drive.",
    "",
    "Preferred path: set the drive up first, then mount.",
    "",
    "### Change a Common Setting",
    "",
    // Illustrative, not exhaustive - and names the Lighting card only for the variant
    // that has lighting hardware to control.
    `1. Try Home's own cards first: CPU & RAM, Video, Audio, Ports, User Interface${
      isC64uRemoteVariant(variant) ? "" : ", Lighting"
    }.`,
    "2. If the setting is not there, open **Config** and search.",
    "3. Change the value.",
    "4. To make the change survive a power cycle, use **Save** in the **Config** card, unless **Keep device settings after a restart** is already on.",
    "",
    "Preferred path: Home for common settings; Config for everything else.",
    "",
    "### Save Device Configuration",
    "",
    "Use this to save the current settings to flash once, so the machine still has them after its next power-up.",
    "",
    "1. Make the changes you need on Home or Config.",
    "2. Confirm the device is healthy.",
    "3. Open the **Config** card on Home.",
    "4. Choose **Save**.",
    "",
    "Preferred path: turn on **Keep device settings after a restart** in **Settings → Device Safety**, and the app saves for you a moment after your changes settle.",
    "",
    "### Investigate a Problem",
    "",
    "1. Tap the header badge or press `*`. If the app is offline, that tap also tries to connect again, and asks for the password if the device wants one.",
    "2. Run a health check.",
    "3. Look at Problems, then Errors, then Traces if the order of requests matters.",
    "4. To ask for help, share a report before you clear anything or restart the app. See [Sharing a Diagnostics Report](#sharing-a-diagnostics-report).",
    "",
    "Preferred path: Diagnostics from the badge.",
    "",
    "## In Depth",
    "",
    "Some parts of the app have more to them than a recipe can hold. This chapter covers them in full.",
    "",
    "### SID Music",
    "",
    "The **SID**, short for **Sound Interface Device**, is the sound chip in every Commodore 64. It has three voices, and people are still writing music for it today. The files that hold that music are called SIDs too: each is a small program that plays the chip. Tens of thousands of them live in one free archive, the **High Voltage SID Collection**, or **HVSC**.",
    "",
    `Your C64 plays all of it, and your ${appDeviceName(variant)} plays most of it. This section is about choosing the music yourself. The next one, **SID Radio**, lets the app choose for you.`,
    "",
    image(
      "The Now Playing card: the tune, what the file says about it, and the transport",
      profile,
      "play/sid-radio/profiles/{profile}/01-controls.png",
    ),
    "",
    "#### Where the music plays",
    "",
    "While a SID tune plays, the Play page shows an **output button** beside the volume slider. It names where the sound is going. Press it to choose:",
    "",
    `- **Here**: your ${appDeviceName(variant)} plays the tune itself. Your C64 need not even be switched on.`,
    "- **C64**: your C64 plays it on its own SID chip.",
    "- **Both**: your C64 plays it and also sends the sound across your network, so you hear it in both places.",
    "",
    "**Both** is offered when Live View and its audio are switched on, and it disappears if your C64 declines to send the sound. The sound leaves the machine over its **Ethernet** connection, so a C64 on Wi-Fi alone cannot send it.",
    "",
    "The output button is for SID tunes only. Programs and disks always run on the C64.",
    "",
    `To play music by itself, your ${appDeviceName(variant)} needs copies of two programs built into every C64: the **KERNAL** and **BASIC** ROMs. Many tunes call into them; without them, those tunes start and then play nothing.`,
    "",
    `The ROMs are under copyright and cannot be shipped with an app, so ${variant.displayName} reads them from your own machine. It does this by itself, the first time you play a tune here while the C64 is connected. There is nothing to set up.`,
    "",
    `The copies stay on your ${appDeviceName(variant)}. They are never uploaded, never shared, and never put in a diagnostics report. Read them only from a machine that is yours, or that you have permission to use.`,
    "",
    "#### Moving around inside a tune",
    "",
    `These work for tunes playing on your ${appDeviceName(variant)}. On the C64, the buttons only step from one tune to the next.`,
    "",
    "- **Press and hold next or previous** to wind forward or back, about five seconds at a time, for as long as you hold. A short tap still skips.",
    "- **Tap the progress bar** to jump to that spot, or hold and slide along it. The music picks up wherever you let go.",
    "- Jumping *forward* past the part already prepared takes a moment, because the app has to work the music out up to that point. The timer waits at the last note you heard while the bar shows progress. Jumping back is instant.",
    "",
    "#### The sound itself",
    "",
    "**Volume** and **Mute** follow whichever machine is making the sound. Playing here, they change this tune alone and leave your ringer and notifications as they were. Playing on the C64, they move the machine’s own mixer.",
    "",
    `Your ${appDeviceName(
      variant,
    )} plays either its own tune or the sound sent from your C64, never both at once. Whichever you start last wins.`,
    "",
    "The rest is under **Settings → SID Radio**. **Crossfade** blends one tune into the next: **Off** for a clean cut, or **Short** (0.6s), **Medium** (1.5s), **Long** (3s), or **Longest** (4s). It starts at Off.",
    "",
    `Only your ${appDeviceName(
      variant,
    )} can play two tunes at once, so Crossfade is grayed out while the output is set to the C64.`,
    "",
    "The SID chip came in two versions, the **6581** and the **8580**, and music written for one sounds a little different on the other. Most files say which chip the composer used, and those always play on it.",
    "",
    "Many older files say nothing. For those, turn on **Match my Commodore 64** and the app reads the chip from your own machine. Until it has, **Otherwise use** picks 6581 or 8580. A line underneath tells you which is in use.",
    "",
    "#### The SID Audio Mixer",
    "",
    "A C64 can have more than one SID chip. **Home → Audio** gives you a **master volume**, plus a **volume** and **stereo position** for each SID your machine reports. Pan one SID left and another right for stereo, or turn one down so the other leads. You hear each change at once. The same controls are in **Config → Audio Mixer**.",
    "",
    "### SID Radio",
    "",
    "HVSC holds around sixty thousand files, and even more tunes, since many files hold several. That is far too many to browse! SID Radio plays it like a radio station: pick a mood, or a tune you already like, and the app keeps finding more music of the same kind.",
    "",
    "There is no playlist to build, and nothing downloads while you listen. Once the collection is on your device, the app already knows which tunes sound alike.",
    "",
    image(
      "Choosing a station: a mood, your own taste, or anything at all",
      profile,
      "play/sid-radio/profiles/{profile}/02-stations.png",
    ),
    "",
    "#### Starting a station",
    "",
    "Go to the **Play** page, tap **SID Radio**, and pick what you are in the mood for:",
    "",
    "- **A mood.** There are nine: Fast-Paced, Chill / Ambient, Melodic, Experimental, Nostalgic, Composer Deep-Dive, Era Explorer, Deep Cuts, and Game Themes. Each draws on tens of thousands of tunes.",
    "- **From tunes you like.** Once five tunes carry a heart, this builds a station from them.",
    "- **Surprise me.** Anything at all.",
    "",
    "Switch on **Based on my likes** to tilt any mood toward your own taste. The station keeps the mood's name, but reaches for music closer to what you like.",
    "",
    "You can also start from whatever is playing now. Tap **More like this**, and the station follows that tune. The button appears whenever a SID the collection recognizes is playing, even during another station.",
    "",
    "#### Telling it what you like",
    "",
    "While a tune plays, a heart and a cross appear just above its title, at the right of the card. Tap the **heart** to add it to your **Liked Tunes** list. Tap the **cross** to skip it: the station moves on at once and steers away from similar tunes. You need not do either; the station plays happily if you just listen.",
    "",
    `Your choices stay on your ${appDeviceName(variant)}. They belong to the music itself, not to a file name, so they survive an update to the collection even if the tune moves.`,
    "",
    "**Liked Tunes** is an ordinary list: play it, shuffle it, or take a tune off it. To start over, **Settings → SID Radio → Clear my rankings** removes every heart and cross at once.",
    "",
    "#### What a station will and will not do",
    "",
    "**It never repeats itself.** No tune plays twice, and no file gives more than one tune in a session.",
    "",
    "**It skips very short pieces.** The collection holds jingles, sound effects and test tones as well as music. Anything under fifteen seconds is skipped. Change that under **Settings → SID Radio → Shortest tune to play**, or set it to zero to hear everything.",
    "",
    "**It can run out.** A station follows a chain of similar tunes, and now and then it reaches the end, usually after many skips. The app tells you, and you can pick another mood.",
    "",
    "While a station runs, it chooses what comes next, so Shuffle, Repeat and Reshuffle step aside. They come back, settings intact, the moment you stop it.",
    "",
    "The line at the top of the Now Playing card says where the music comes from. Tap it to see why this tune was chosen, or tap **Stop** beside it to end the station. Each station starts fresh, so the same mood brings different music every time.",
    "",
    "#### Finding one particular tune",
    "",
    "To play one particular piece, tap **Find a tune** and type part of a title or a composer's name. The app searches the whole collection, not just one folder. That matters, because the archive is filed by composer.",
    "",
    'Any part of a word will do, in upper or lower case, and accents are ignored: "oorni" finds Lasse Öörni, "mando" finds Commando. Add a second word to narrow it down: "hubbard commando" finds the one that matches both.',
    "",
    "Tap a result and it plays at once. Your station keeps its place and carries on when the tune ends. For more music like it, tap the radio icon beside the result, where there is one.",
    "",
    "With nothing typed, the sheet lists what you heard recently, so you can find your way back to a tune that has already played.",
    "",
    image(
      "Finding one tune by name, anywhere in the collection",
      profile,
      "play/sid-radio/profiles/{profile}/04-find-a-tune.png",
    ),
    "",
    "#### More than one tune per file",
    "",
    "Many SID files hold several tunes: a title screen, a high-score jingle, a loading tune, sometimes twenty more. The second line under the title shows which one is playing and how many there are: **1/19**.",
    "",
    "Tap **Play all 19 tunes** to add them all to your playlist in order, each with its own name and length. From then on they behave like any other tracks, and the button disappears.",
    "",
    "To pick just one, tap that **1/19**. You see every tune in the file with its number, its name where it has one, and its length. Check the lengths before you choose: a five-minute piece and a one-second jingle often share a file.",
    "",
    image(
      "Every tune in one SID file, with its name and length",
      profile,
      "play/sid-radio/profiles/{profile}/07-tunes-in-this-file.png",
    ),
    "",
    "#### What the tune is, and who wrote it",
    "",
    "The line under the title comes from the SID file itself: the composer, the year and publisher, the chip it asks for, whether it was written for **PAL** or **NTSC**, which tune is playing, and its length. Anything the file does not record is left out, never guessed. Tap the composer's name, and search opens with that name filled in.",
    "",
    "The archive's editors have written down two more things a SID file cannot hold. You find them under **About this tune**, below that line, for about a third of the tunes. It starts folded, so the transport and progress bar stay on screen; tap it to open or close it.",
    "",
    "The first is whose music a tune really is. Much C64 music is a cover of a pop record, a film score or an arcade original, and the file names only whoever wrote the C64 version.",
    "",
    "Take Rob Hubbard's *Commando*. He wrote the C64 version, but the music is Tamayo Kawamoto's, from the arcade game. **About this tune** shows it: **BGM1 · music by Tamayo Kawamoto**.",
    "",
    "The second is what the individual tunes inside a file are called. A list of nineteen numbered rows becomes a title screen, a high-score jingle and a game-over sting. Any note the editors left about a tune appears underneath. Long notes are trimmed and marked **Show more**; tap one to read the rest.",
    "",
    "#### Stopping later",
    "",
    "A station never stops on its own, so set a **Sleep timer** if you are listening at bedtime. It sits under the transport controls on Play. Choose **This tune** to stop when the current one ends, or 15, 30, 45 or 60 minutes. It counts down while it waits; **Off** cancels it.",
    "",
    "",
    ...(includeFeature(features, "audio_mirror_enabled") || includeFeature(features, "video_mirror_enabled")
      ? [
          "### Live View",
          "",
          "Your C64 can send its own sound and picture across your network, and Live View brings them into the app. Hear a tune or watch the screen without wiring up a speaker or a second television!",
          "",
          "There is only ever one Live View. Start it in one place, and it keeps playing wherever you go in the app.",
          "",
          `You find it just below the Quick Actions on **Home**, as a card that starts closed; tap its header to open it.${isC64uRemoteVariant(variant) ? "" : " The card appears only where the machine can stream, so an Ultimate-II cartridge does not offer it."} Inside are two switches:`,
          "",
          ...(includeFeature(features, "audio_mirror_enabled")
            ? [
                "- **Listen** turns the sound on. It takes almost no room, just a lit button and a small live dot, so you can keep half an ear on a game or a SID tune while you do something else. On other pages, a matching dot in the top bar reminds you it is playing; tap it to stop everything at once.",
              ]
            : []),
          ...(includeFeature(features, "video_mirror_enabled")
            ? [
                "- **Watch** turns the picture on. A small preview of the C64 screen appears beneath the switches; tap the chevron beside it to make it bigger.",
              ]
            : []),
          "",
          image("Live View on Home", profile, "home/content-explorer/profiles/{profile}/01-live-view.png"),
          "",
          "While either is playing, a **Reset** in the card's header stops both, without opening the card.",
          "",
          `If the stream stops reaching ${appDeviceSubject(
            variant,
          )}, because the network drops out or the machine is switched off, Live View tells you so. You never sit in front of a frozen picture wondering.`,
          "",
          "Live View needs no setting up. Nothing crosses the network until you press **Watch** or **Listen**.",
          "",
          "The device sends to two network ports, 11000 for the picture and 11001 for the sound. If those are already taken on your network, change them in **Settings → Play and Disk**.",
          "",
          "The **Live View** switch in Settings → Stable Features hides the whole feature. **Audio Mirror** and **Video Mirror**, in Experimental Features, choose which of the two feeds it offers.",
          "",
          ...(includeFeature(features, "video_mirror_enabled")
            ? [
                "#### The immersive screen",
                "",
                "Open **Remote Input** while **Watch** is on, and the picture sits above the joystick and keyboard. Now you can see the game you are playing, or the program you are typing. In **Game Mode**, the picture fills the whole sheet.",
                "",
                "On a touchscreen, **pinch** to zoom, **drag** to move the picture about, and **double-tap** to zoom in on a spot. Double-tap again to see the whole screen.",
                "",
                "A small map in the corner shows which part you are looking at; drag its rectangle to jump elsewhere. Switch on **Follow**, and the view drifts by itself to wherever the action is. That keeps the cursor in sight as you type.",
                "",
                "You can also lock the view onto your character. Press and hold the character on the screen. With no touchscreen, use the direction keys to line up the crosshair in the middle of the view, then press **OK**.",
                "",
                "The view now travels with that one character while enemies move around it. It hangs on through flashing, color changes, animation, fast movement, a wrap around the screen edge, and a moment out of sight.",
                "",
                "The status line reads **Hold on your character** until something is locked, then **Locked on**. **Looking…** means it is still searching, and **Lost it** that the character has gone; both are normal. To let go, tap the status line, ask for the whole screen back, or press **OK** again, and the view goes back to ordinary following.",
                "",
                image(
                  "The immersive screen in Remote Input",
                  profile,
                  "home/remote-input/profiles/{profile}/06-av-mirror-immersive.png",
                ),
                "",
                "#### Driving the C64, or adjusting the view",
                "",
                `On a ${appDeviceName(
                  variant,
                )} with a physical keypad, the same keys can either drive the C64 or move the picture. A colored border around the picture, with a matching label in the corner, tells you which.`,
                "",
                "**Blue**, marked **“C64”**, means your keys go straight to the machine. **Amber**, marked **“View”**, means they zoom and pan the picture.",
                "",
                "To switch between them, press `*` or the **menu key**, or the on-screen button that reads **Fit** on the way in and **Done** on the way back. After a short pause, the keys go back to driving by themselves, so your game is never left waiting. While the border is amber, the keypad works like this:",
                "",
                "| Key | What it does |",
                "| --- | --- |",
                "| **2**, or D-pad up | Pan up |",
                "| **8**, or D-pad down | Pan down |",
                "| **4**, or D-pad left | Pan left |",
                "| **6**, or D-pad right | Pan right |",
                "| **3** or **9** | Zoom in |",
                "| **1** or **7** | Zoom out |",
                "| **0** or **5** | Fit the whole screen back on |",
                "| the **center/OK** key | Lock the view onto what is under the crosshair, or let it go |",
                "| the **menu** key | Return to driving the C64 |",
                "",
                "In **Game Mode**, while the border is blue, `#` shows or hides the quick keys and the **Watch** and **Listen** switches over the bottom of the picture. So you can turn the picture and sound on and off without a touchscreen.",
                "",
                "The same moves have on-screen buttons too: **plus** and **minus** to zoom, **fit-to-screen** to see the whole screen, and **follow** to turn Follow on and off. However large you make the game controls, they never cover the picture.",
                "",
                "#### Smooth playback, and what it costs",
                "",
                "Live View puts smooth **sound** first. If a scrap of audio goes missing on the network, it fills the tiny gap so neatly you will not hear a click. And it never lets the picture race ahead and leave the sound behind.",
                "",
                "The sound takes a **fast, low-latency path**, so what you hear follows your keypresses closely.",
                "",
                "Three switches in **Settings → Play and Disk** control this, and all three start on. **Low-latency audio (native)** is that fast path. **Fast video (native assembly)** builds the picture the same way, and reaches the full 50 frames a second of a PAL machine.",
                "",
                "**Input priority (instant joystick)** gives the joystick and keyboard right of way: while you play, the picture drops a few frames so your input lands at once, then catches up. Turn any of the three off to compare, or if one misbehaves on your device.",
                "",
                "Beside them is the **audio network buffer**, 60 milliseconds to begin with. It is how much sound the app keeps in hand for a network that delivers in fits and starts. Lower it for the shortest delay; raise it if the sound breaks up.",
                "",
                "The **picture** is the hard work, and you decide how much of it to draw. Open **Stats**, under Live View while it plays, and choose a **Video frame rate**:",
                "",
                "- **Auto** plays every frame it can, eases off when your device is busy, and returns to full speed as soon as it can. Leave it here.",
                "- **100%**, **50%**, and **25%** cap the picture at the full rate, half, or a quarter of what the C64 sends. A lower rate is kinder to the battery and to older hardware, and leaves more room for the game. Even so, the app may dip below your cap for a moment to keep the sound clean, because the sound always comes first.",
                "",
                "**Stats** also shows how the stream is doing, now and over the last few minutes: the frame rate, how full the audio buffer is, any packets lost on the network and how they were smoothed over, and the app's own load.",
                "",
                "Sound and picture travel as two separate streams, so **More** counts their losses separately: **Dropped pkts** under **Audio**, **Lost pkts** under **Video**. Watching it costs the stream nothing. **Export diagnostics** saves it all as a small file.",
                "",
                "#### Screen colors",
                "",
                `Your C64 sends color *numbers*, not colors, so something has to decide which shade to paint each one. That is **Screen colors**, the first row of the **Video** card on Home. It shows the palette in use with all sixteen colors; tap it to choose another.`,
                "",
                "**Show on** decides where a palette applies, just as the Play page asks where a tune plays.",
                "",
                `**Local** changes only the picture in Live View on your ${appDeviceName(
                  variant,
                )}. **Remote** changes what ${targetDeviceShortName(variant)} itself draws, so the television in the room changes too. **Both** does both.`,
                "",
                `The list begins with **Follow the C64**, the starting choice: Live View paints whatever palette the machine uses, so your ${appDeviceName(
                  variant,
                )} and your television match.`,
                "",
                `Below it are nine bundled palettes (warmer, cooler, monochrome and more), each showing all sixteen colors before you choose. Palettes already installed on ${targetDeviceShortName(variant)} are listed under **Already on this C64**.`,
                "",
                `Sending a palette to the machine copies a small file to its storage and changes the picture at once. Whether it survives a power cycle depends on **Keep device settings after a restart**; see *Making settings stick*.`,
                "",
                "#### Checking the sound and picture yourself",
                "",
                "Under Live View are three checks you can run whenever something seems off. To hide them, turn off **A/V sync tests** in Settings → Experimental Features.",
                "",
                "- **A/V sync** and **Tap latency** answer *when*: how far apart the sound and picture are, and how long a keypress takes to come back to you.",
                "- **Tone & color ladder** answers *what*. It plays a scale on your C64, from C3 up to C4 and back at half a second a note, and changes the screen color with every note, through all sixteen C64 colors. The C64 changes note and color at the very same instant, so anything that arrives out of step got that way on your network.",
                "",
                "The ladder grades what comes back and shows five numbers: how many notes were **in tune**, how far off the **pitch** was, whether notes ran **long or short**, whether the two deliberate **silent gaps** really were silent, and how far apart the **sound and picture** were.",
                "",
                "Wrong pitches, long notes, or a gap that is not silent all mean the same thing: the sound is being damaged on its way to you, which a delay alone would not do. The usual cause is a second machine on your network streaming to the same place, and one run of this check shows it plainly.",
                "",
              ]
            : []),
        ]
      : []),
    "### Streams",
    "",
    "Your C64 can send what it is doing across the network. **Home → Streams** offers three feeds: **VIC**, the picture; **Audio**, the sound of the SID; and **Debug**, a low-level trace for developers. Point a feed at an address and press **Start**; **Stop** ends it. The card appears when the connected device says it can stream.",
    "",
    "Live View uses the same **VIC** and **Audio** feeds. While it plays, it takes charge of the feed it needs: that row shows a small **Live View** badge and ignores changes, so nothing here can pull the picture or sound away from it.",
    "",
    "Your own address is remembered, and the row is yours again the moment you stop Live View.",
    "",
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "### Remote Input",
          "",
          `Remote Input turns your ${appDeviceName(
            variant,
          )} into a joystick and keyboard for the C64. It is handy when you are across the room from the machine, when no joystick is plugged in, or when you just want to type a command.`,
          "",
          "You can open it from two places:",
          "",
          "- On **Home**, tap **Game** or **Input**, the second and third Quick Actions tiles. Both open the same screen: **Game** sets it up for playing (Game Mode), **Input** shows everything (Remote Input).",
          "- On **Play**, tap **Remote Input** or **Game Mode** while an item is playing.",
          "",
          "Each place opens its own copy of the controller, so a key held in one never leaks into the other.",
          "",
          image("Remote Input joystick mode", profile, "home/remote-input/profiles/{profile}/01-joystick.png"),
          "",
          "At the top, choose one of two modes: **Joystick** or **Keys**.",
          "",
          "**Joystick** puts a stick and a big **FIRE** button on the screen. You can:",
          "",
          "- choose how the stick behaves: **Stick**, **D-Pad**, or **Swipe**;",
          "- send it to **Port 1** or **Port 2** with the port toggle (most games read Port 2);",
          "- make the controls bigger or smaller, from M up to XXL, with the **Size** stepper (L to begin with);",
          "- turn on **Autofire**, at 1 to 10 presses a second (5 to begin with). Few C64 games need it, so the button stays hidden until you turn on **Show Autofire button** in **Settings → Play and Disk**, where the rate is set too.",
          "",
          "Beside the joystick, a quick-keys bar keeps the keys you need mid-game one tap away: RUN/STOP, SPACE, RETURN, the function keys f1 to f8, the cursor keys, and the CTRL, C= and SHIFT modifiers. Answer a prompt without letting go of the stick.",
          "",
          "**Keys** shows a full Commodore 64 keyboard, with the SHIFT, CTRL and C= modifiers, SHIFT LOCK, the function keys f1 to f8, and RESTORE. Tap a modifier once to apply it to the next key, or hold it down while you press another.",
          "",
          image("Remote Input keyboard mode", profile, remoteInputKeyboardImage(profile)),
          "",
          remoteInputJoystickFirmware(variant),
          "",
          "No key is ever left stuck down on the real C64. Everything is released when you close the sheet, change mode or port, switch device, or send the app to the background. If a message does not get through, the header shows **Reconnecting…** until the next one does.",
          "",
          "Tap **Release All** at any time to let go of every key and button at once.",
          "",
          availabilityNote(features.remote_input_enabled),
          "",
          "#### Game Mode",
          "",
          "**Game Mode** is the app set up for playing: the picture and sound as you last left them, everything else out of the way, and the controls that suit how you play.",
          "",
          "Start it with the **Game** tile on Home, the **Game Mode** button on Play, or the `0` key from anywhere. Starting a program, cartridge or disk can open it too; **Settings → Play and Disk → Enter Game Mode when a game starts** decides whether it does.",
          "",
          image("Game Mode", profile, "home/remote-input/profiles/{profile}/02-game-mode.png"),
          "",
          isC64uRemoteVariant(variant)
            ? "The picture fills the whole screen. Your phone steers with its number keys, so an on-screen joystick would only be in the way. To bring one up for this game, press **Show joystick** on the Game Mode toolbar. To keep it for good, set **Settings → Play and Disk → On-screen joystick in Game mode** to **Visible**."
            : "The on-screen joystick stays until you pick up the keys. Play by touch and it is there. Steer with a physical key and it steps aside, giving the picture the whole screen; touch the screen and it comes straight back.\n\nNothing else moves it, and opening Game Mode with the `0` key does not count as playing on the keys. To decide for yourself, press **Hide joystick** or **Show joystick** on the Game Mode toolbar for this game, or set **Settings → Play and Disk → On-screen joystick in Game mode** to **Visible** or **Hidden** instead of **Auto**.",
          "",
          image(
            "Game Mode, played on the physical keys",
            profile,
            "home/remote-input/profiles/{profile}/07-game-mode-keys.png",
          ),
          "",
          "With the controls out of the way, three keys still reach everything. `#` shows or hides RETURN, SPACE, the other quick keys and the **Watch** and **Listen** switches over the bottom of the picture. `*`, or the menu key, switches between driving the C64 and adjusting the view. **Back** leaves.",
          "",
          "The floating **cog** at the top of the picture brings the toolbar back.",
          "",
          "Playing on a television instead? Turn **Watch** off once, and Game Mode keeps opening without the picture. The controls fill the space, so it is never blank.",
          "",
          "With the joystick **Hidden** and the picture off, there is nothing to draw, so Game Mode says the picture is off and shows the **Watch** and **Listen** switches and the quick keys, all reachable without a touchscreen. The game keeps taking your keys all the while. Turn **Watch** on and the picture takes the space instead.",
          "",
          "To leave, press **Exit** at the top of the Game Mode toolbar, or your device's Back button. Both let go of everything you were holding. If Game Mode started the picture and sound, leaving stops them; if they were on before, they keep running.",
          "",
          ...(isC64uRemoteVariant(variant)
            ? [
                "#### Steering with the number keys",
                "",
                "The four keys around **8** steer, and **8** itself fires. They form a diamond your thumb can find without looking:",
                "",
                table(
                  ["Key", "Direction"],
                  [
                    ["5", "Up"],
                    ["7", "Left"],
                    ["9", "Right"],
                    ["0", "Down"],
                    ["8", "Fire"],
                  ],
                ),
                "",
                `The mapping turns with your ${appDeviceName(
                  variant,
                )}. Hold it sideways like a gamepad and the keys follow, so up is always up. The picture turns with you, and the rest of the app stays upright:`,
                "",
                table(
                  ["Held", "Up", "Left", "Right", "Down", "Fire"],
                  [
                    ["Upright", "5", "7", "9", "0", "8"],
                    ["Turned right", "7", "0", "5", "9", "8"],
                    ["Turned left", "9", "5", "0", "7", "8"],
                  ],
                ),
                "",
                image(
                  "Game Mode with the picture turned",
                  profile,
                  "home/remote-input/profiles/{profile}/08-game-mode-rotated.png",
                ),
                "",
                "Lying down, or the sensor cannot tell which way up the phone is? The **Orientation** control in Game Mode's toolbar pins the mapping. Choose **Auto**, **0°**, **90°** or **270°**. The choice lasts while the sheet is open, and is forgotten afterward.",
                "",
                "To use different keys, open **Settings → Play and Disk → Joystick keys**. It offers **Diamond (8-centred)**, the layout above; **Classic T9**, with 2, 4, 6 and 8 to steer and 5 to fire; and **Custom**, where you press the key you want for each direction. Set it up holding the phone upright; every other way round follows from that.",
              ]
            : [
                "#### Steering with a physical keyboard",
                "",
                "**Settings → Play and Disk → Joystick keys** decides which keys steer. **Classic T9** steers with 2, 4, 6 and 8, fires with 5, and adds the diagonals on 1, 3, 7 and 9. **Diamond (8-centred)** steers with the four keys around 8 and fires with 8 itself. **Custom** lets you press the key you want for each direction.\n\nA hardware D-pad always steers too, whatever you choose. The mapping turns with your device, so you only need to set it up one way round. If the sensor cannot tell which way up the device is, the **Orientation** control in Game Mode's toolbar pins the mapping to **Auto**, **0°**, **90°** or **270°**.",
              ]),
          "",
        ]
      : []),
    "### File Sources",
    "",
    "Everything you play or mount comes from a **source**. Each source has its own picker, so a wrong turn never lands you somewhere unexpected.",
    "",
    `- **Local**: files and folders on the ${appDeviceName(variant)} running the app.`,
    `- **C64U**: files on ${targetDeviceShortName(variant)}, reached over FTP.`,
    ...(includeFeature(features, "hvsc_enabled")
      ? [
          "- **HVSC**: the High Voltage SID Collection, the great archive of C64 music. Choose it once from **Add items**, and it downloads and indexes itself. A card at the foot of the Play page shows how far it has got, and lets you start, stop or reset it by hand. After that the app watches for updates by itself; **Settings → HVSC** sets where it downloads from and how often it looks. When you browse it, you see song lengths and the tunes inside each file.",
        ]
      : []),
    ...(includeFeature(features, "commoserve_enabled")
      ? [
          "- **CommoServe**: an online archive you search by name. Pull disks and programs straight into a playlist or disk collection. Set its address in **Settings → Online Archive**.",
        ]
      : []),
    "",
    "### A Setting Just for One Item",
    "",
    "Some titles want the machine set up a certain way: no cartridge, a different processor speed, the joystick in the other port. Instead of remembering that every time, attach a device configuration file to the playlist item. The app applies it just before that item runs.",
    "",
    "Open a playlist row's menu and choose **Review playback config**. A `.cfg` file with the same name as the program, or in the same folder, has already been found; the app lists it as a candidate and says how sure it is. Take one, or attach your own file from this device or from your C64.",
    "",
    "The status line says where things stand: **No config**, **Candidates found**, **Config resolved**, **Config edited**, or **Config declined**. **Edit values** changes single settings on top of the file, **Re-discover** looks again after you have moved files, and **No config** tells the app to stop offering.",
    "",
    "### Drives and Disk Images",
    "",
    `${appName} gives your C64 two disk drives and a Soft IEC drive. Each has its own card on the **Disks** page, a small control panel all of its own.`,
    "",
    "- **Power** turns the drive on or off. A drive must be **on** before it can mount anything.",
    "- **Bus ID** is the number software uses to find the drive. The first drive is 8 by tradition; the device tells the app which numbers it accepts.",
    "- **Type** should match the disk: a 1541 for D64 and G64, a 1571 for D71 (it reads D64 too), a 1581 for D81. This list comes from the device, so a machine that offers more types shows them.",
    "- **Reset** restarts the drive's own processor. It is the gentlest way to bring a confused drive back without disturbing the C64.",
    "",
    "You will rarely set any of this by hand. When you start a disk from Play, the app switches the drive on if it is off, and changes its type if the current one cannot read the disk. It tells you as it goes.",
    "",
    `A disk that already lives on ${targetDeviceShortName(
      variant,
    )} mounts where it is. A **Local** disk is copied across first. Whatever a program writes to it comes back to your own file when you eject, so your high scores and saved games are safe.`,
    "",
    "A disk from the online archive has no file of yours to go back to. Its changes last only while the app is running, and ejecting it offers **Save a local copy**.",
    "",
    'Once a disk is mounted, there are two ways to start it, and **Settings → Play and Disk → Disk first-PRG load** chooses between them. **Classic KERNAL load** does what you would type yourself: `LOAD"*",8,1` and `RUN`. **DMA** lifts the first program off the disk and writes it straight into memory, which is much quicker.',
    "",
    "A few loaders do not like arriving that way. If a disk that used to start no longer does, try the classic route.",
    "",
    "For a title that spans several disks, keep the images together in one **group**. Adding a folder does this for you, from the file names or the folder itself; move any stragglers by hand. A group puts **rotate** controls on the drive card, so when a program asks for the next disk, you swap it right there.",
    "",
    "The **Soft IEC** drive works differently. Point it at a folder on the device, and your C64 reads the loose files inside it directly. That suits a big collection that was never packed into disk images.",
    "",
    ...(includeFeature(features, "disk_explorer_enabled") ||
    includeFeature(features, "launch_safety_enabled") ||
    includeFeature(features, "in_image_search_enabled") ||
    includeFeature(features, "new_disk_enabled")
      ? [
          "### Content Explorer",
          "",
          "Content Explorer is this guide's name for four features that reach the programs *inside* a disk image and start them safely. Each has its own switch in Settings; the line at the end of each section tells you whether it is already on. Searching inside images needs Disk Explorer on as well.",
          "",
          ...(includeFeature(features, "disk_explorer_enabled")
            ? [
                "#### Looking Inside a Disk",
                "",
                "Mounting a disk image gives you the whole disk. Disk Explorer looks *inside* it, so you can pick one program and start it. On **Disks**, open the menu of a `.d64`, `.d71` or `.d81` image and choose **Open (Disk Explorer)…**.",
                "",
                "You see every file on the disk with its type, its size in blocks, a padlock if it is write-protected, and, for a program, its load address.",
                "",
                "Each program offers three actions:",
                "",
                "- **Run** loads the program into the C64's memory and starts it.",
                "- **Load** loads it into memory without starting it, handy for monitors and development.",
                "- **Mount & Load** mounts the whole disk, resets the machine, waits for BASIC, then types the LOAD and RUN for you. Choose it for titles that load in several stages.",
                "",
                'Only a proper **PRG** program can be started this way. Other file types show a short note saying why not. An unclosed "splat" file, one that was never finished being written, cannot be started either.',
                "",
                availabilityNote(features.disk_explorer_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "launch_safety_enabled")
            ? [
                "#### Launch Safety",
                "",
                "Some machines have a freezer cartridge set up, such as an Action Replay or Retro Replay. On those, starting a program directly can land you in the cartridge's own menu.",
                "",
                "Launch Safety prevents that. Around a direct **Run** or **Load**, it *parks* the cartridge, then puts it back. It never changes the device's saved settings, so a power cycle always brings the cartridge back. With no cartridge set up, it does nothing at all.",
                "",
                "**Mount & Load** resets the machine anyway, so Launch Safety leaves it alone. All of this happens by itself; there is nothing to press.",
                "",
                "One more option lives in **Settings → Play and Disk**: **Answer cartridge boot menu after reset**. It starts off, and helps in one rare case: a cartridge that shows a boot menu when the machine resets, and so swallows the LOAD that Mount & Load types.",
                "",
                "Turn it on, then choose the **menu key** (F1 to F8, RETURN, or SPACE; F7 to begin with) and a **boot settle** time between 1000 and 8000 milliseconds (2800 to begin with). After the reset, the app presses that key to clear the menu. Leave it off unless you have such a cartridge.",
                "",
                availabilityNote(features.launch_safety_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "in_image_search_enabled")
            ? [
                "#### Searching Inside Disk Images",
                "",
                "Normally, search matches disk images by file name only. Switch **In-image search** on in **Settings → Experimental Features**, and a **Search inside disk images** row appears in **Settings → Play and Disk**. Turn that on, and search also finds the programs *inside* your `.d64`, `.d71`, and `.d81` images.",
                "",
                "A match inside a disk shows as **DISK → PROGRAM**, so you can see which disk holds it. Run or Load it like any other.",
                "",
                availabilityNote(features.in_image_search_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "new_disk_enabled")
            ? [
                "#### Creating a Blank Disk",
                "",
                "Need a fresh disk to save to? Open **Disks** and choose **New disk**, which formats a blank image on the device. Pick the **type**: D64 (1541), D71 (1571), D81 (1581), or DNP (CMD native). Give it a **file name**, and a **disk label** of up to 16 characters, which copies the file name unless you change it.",
                "",
                "For a D64, set the number of **tracks**, 35 to 41; 35 is the usual choice. A DNP needs a number between 1 and 255. D71 and D81 need neither.",
                "",
                "Last, type the **storage folder** on the device. It starts at `/USB0`; the top-level `/` lists drives and holds no files. **Create & mount** builds the image, adds it to your collection, and mounts it in Drive A, ready to use.",
                "",
                availabilityNote(features.new_disk_enabled),
                "",
              ]
            : []),
        ]
      : []),
    ...(includeFeature(features, "ram_snapshots_enabled")
      ? [
          "### RAM Snapshots",
          "",
          `A RAM snapshot is a copy of what is in your C64's memory right now, saved onto your ${appDeviceName(
            variant,
          )} so you can put it back later. Think of it as a save button for programs that have none of their own.`,
          "",
          "You find both buttons in **Home → Quick Actions**: **Backup** to capture, **Restore** to put it back. These are not the same as **Save** and **Load** on the Config card, which store your machine's settings rather than its memory.",
          "",
          "Your device must be connected and idle. The app pauses the machine while the memory crosses the network, then lets it carry on, so a running program is not disturbed.",
          "",
          "When you tap **Backup**, the app asks which part of memory to capture:",
          "",
          "- **CPU + RAM snapshot** freezes the running program and stores the whole 64K of memory together with the processor's registers, so the program can pick up exactly where it stopped. It suits BASIC and unhurried programs; a fast game may not resume cleanly. Some machines and programs will not give up their processor state; the app then says so and suggests a Program snapshot. Once in a while a program stays frozen afterward, and the app tells you that too. Restore it, or reset the machine.",
          "- **Program Snapshot** stores almost all of memory (everything but the stack). A good all-round choice.",
          "- **Basic Snapshot** stores only the BASIC program and its variables.",
          "- **Screen Snapshot** stores the current screen and its colors.",
          "- **Custom Snapshot** lets you type the exact address ranges you want.",
          "",
          `Snapshots live on your ${appDeviceName(
            variant,
          )}, not on the C64. Each is named after its type, date and time; if something is playing, its title becomes the label. You can add or change a **Comment** later. The app keeps a hundred and drops the oldest when it runs out of room.`,
          "",
          "**Restore** opens your snapshot library. Filter it by name or type, then tap a snapshot to put it back. The app asks you to confirm first, because restoring overwrites that memory on the C64.",
          "",
          "It writes only the bytes the snapshot holds, and leaves the CIA timers alone, so the cursor blinks as usual. A CPU + RAM snapshot resumes the program where it stopped; if that proves impossible, the app restores the memory alone and tells you.",
          "",
          "The library is also where you edit comments and delete snapshots you no longer need.",
          "",
          availabilityNote(features.ram_snapshots_enabled),
          "",
        ]
      : []),
    "### The Virtual Printer",
    "",
    "Your C64 prints over the serial bus, and the machine provides the printer itself. There is no box to buy and no cable to connect! **Home → Printers** turns it on, picks the **emulation** (a Commodore MPS, for example), and sets the **bus ID**, the **output type**, the **ink density** and the character sets. **Reset** clears the printer and starts a fresh page.",
    "",
    "One more control, **Flush/Eject**, finishes the current page and sends it on. It works through the Telnet menu service; turn on **Home printer shortcut actions** in Settings → Experimental Features to see it.",
    "",
    "### Configuration and Saving",
    "",
    "Your machine keeps two copies of its settings: the **live** ones it is using now, and a **flash** copy it loads at power-on. Every change you make, on Home, on Disks, or in Config, goes live at once. It survives a reboot or power cycle only once it reaches flash.",
    "",
    saveToFlashGuidance(variant),
    "",
    `Beside **Save** on the **Config** card are **Load** from flash, **Reset** to the factory settings, and **Revert**, which undoes your changes since the last save. The app also keeps its own named **configuration snapshots** on the ${appDeviceName(
      variant,
    )}, apart from the device's flash. Save a setup you like, and load the whole thing back whenever you want it.`,
    "",
    "### Switching Between Devices",
    "",
    `If you have saved more than one ${
      isC64uRemoteVariant(variant) ? "Commodore 64 Ultimate" : "device"
    }, **Switch device** lets you hop between them without opening Settings.`,
    "",
    "With more than one device saved, there are three ways to open it:",
    "",
    "- **Long-press the header badge** (a short tap opens Diagnostics instead).",
    "- Press **`#`** on a hardware keyboard or keypad.",
    "- Choose **Switch device** in the Quick menu.",
    "",
    "The switcher checks each saved device for you, and again every ten seconds while it is open. Each row shows the name, a status pill (**Selected**, **Verifying**, **Offline** or **Mismatch**), a health badge, and a short note, such as how many checks passed or when the device was last seen. The device you are using is highlighted.",
    "",
    "Tap the chevron to open a row and read the checks one by one. That tells a sleeping device from one that cannot be reached at all. These checks are gentle: they try the web and FTP services and read a setting without changing it. For the full round, Telnet included, use **Run health check** in Diagnostics.",
    "",
    "Tap a device to switch to it. First the app lets go of any keys you were holding on the old device and stops following its playback. Then it points itself at the new device's address and ports, and checks that it answers. Meanwhile the new device shows a **Verifying** pill; once it responds, it becomes the active device.",
    "",
    "You add and edit saved devices in **Settings → Connection**, under **Saved devices**. Set each one's **Device name**, **C64U hostname / IP**, **HTTP**, **FTP** and **Telnet** ports, and **Network Password**, or delete one you no longer need.",
    "",
    "**Save & Connect** waits for the device to answer before keeping it. With only one device saved, there is nothing to switch to, and the switcher stays out of your way.",
    "",
    "### Reading Diagnostics",
    "",
    "Diagnostics slides up from the bottom of the screen. Open it by tapping the header badge, pressing `*`, choosing **Diagnostics** in Settings, or tapping any error notification.",
    "",
    "The panel has three parts, from top to bottom:",
    "",
    "- The **health header** shows the state (Healthy, Degraded, Unhealthy or Offline), which device it is about, and when it was last checked. Tap **Run health check** to test the connection now. The check tries the web, FTP and Telnet services, then three signals from the C64 itself: CONFIG, RASTER and JIFFY. Each reports its own result and timing, beside the overall latency. Open the header to read them one by one.",
    "- The **Filters** bar says how much of the activity you are seeing, and opens the filter editor. Filter by device, by kind of activity (Problems, Actions, Logs, Traces), by where it came from (App, REST, FTP, Telnet), or by severity (Errors, Warnings, Info). The editor also has five one-tap shortcuts: **Errors only**, **Problems only**, **REST**, **FTP**, and **Reset**.",
    "- The **Activity** list gathers problems, actions, logs, and traces together. Problems give a plain-language summary; Traces show the timing and order of requests. Tap any row for the full details.",
    "",
    "The CONFIG probe writes as well as reads. It nudges a live setting by a hair, reads it back to make sure the device applied it, then puts the original value back.",
    "",
    "On a machine with lights, in the case or the keyboard, you will see them **pulse once** as the check runs: a little heartbeat that says the connection is alive. On a machine without lights, it nudges a mixer volume instead, for about a twelfth of a second.",
    "",
    "The three-dot menu in the corner holds the rest: connection details, health history, latency, the REST, FTP and Config heat maps, config drift, decision state, **Key Explorer**, a shortcut to **Manage devices**, and Share and Clear.",
    "",
    "### Sharing a Diagnostics Report",
    "",
    "When something goes wrong, the best clues are usually the last few actions before it. So share them before you clear anything or restart the app. The activity list is rebuilt each time you open Diagnostics, and **Clear all** wipes it for good.",
    "",
    "To share a report about a recent error:",
    "",
    "1. Open **Diagnostics**.",
    "2. Tap **Run health check**, so the report includes a fresh connection test.",
    "3. Use the **Errors only** or **Problems only** filter to check the failure is there.",
    "4. Open the three-dot menu and choose **Share all** for the full report, or **Share filtered** for a plain list of just the rows you filtered to.",
    "5. Pick an app in the share sheet (mail, chat, or notes) to send or save the report.",
    "",
    `**Share all** produces a small ZIP file holding the app's logs, traces, errors and recent actions, a health snapshot, and details of your app version, your ${appDeviceName(
      variant,
    )}, and the active C64: its name, host address and firmware. Your network password is never in it. Its hostname or IP address may be, so send it only to people you trust, or to support.`,
    "",
    "Afterward, use **Clear all** for a clean slate. It asks you to confirm, then shows **Diagnostics cleared**.",
    "",
    "## Safe Device Use",
    "",
    safeDeviceUseIntro({ appName, variant }),
    "",
    "A few good habits:",
    "",
    ...safeDeviceUseHabits(variant),
    "",
    "**Device Safety** in Settings decides how hard the app pushes the device. Its five modes trade speed for caution: they limit how many requests run at once, space them out, and set how long the app remembers an answer and how long it waits after a failure.",
    "",
    "Leave it on **Auto**, which reads the model and firmware and picks for you. The full list is in [Device Safety Modes](#device-safety-modes). **Relaxed** asks you to confirm, and shows a banner while it is on.",
    "",
    "The same chapter also lets you change every number behind those modes: discovery windows, timeouts, how many requests may run at once, cooldowns, backoff, and the circuit breaker. Leave them alone unless you are chasing a particular fault.",
    "",
    "Changing the CPU speed can drop the network for a moment while the device applies it. Just wait for the app to reconnect.",
    "",
    "## Troubleshooting",
    "",
    "Find your symptom below. If none fits, open Diagnostics. It records what the app asked for and what came back, and that usually shows where the trouble is.",
    "",
    "### Discovery finds nothing",
    "",
    "- Check that both devices are on the same network.",
    "- Check that Web Remote Control Service is turned on.",
    "- Enter the hostname or IP address by hand.",
    "- If the hostname does not work, try the IP address.",
    "",
    "### Password required",
    "",
    `Enter the network password set on ${targetDeviceShortName(variant)}. If the saved password stops working, the app asks again.`,
    "",
    "### File browsing fails",
    "",
    "- Check that FTP File Service is turned on.",
    "- Check the FTP port in Settings.",
    "- If the device was restarted, reconnect from Settings.",
    "",
    "### Playback does not start",
    "",
    "- Check that the device is connected and healthy.",
    "- Check that the file type is one the app plays.",
    "- For local files, choose the source again if Android storage permission was lost.",
    "- For disk images, check that the drive is switched on.",
    "",
    "### Controls look disabled",
    "",
    "Some controls appear only when the connected device can use them. Others are grayed out while something is running, or when there is nothing for them to act on.",
    "",
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "### Remote Input joystick is unavailable",
          "",
          "The **Joystick** tab appears only when the connected device offers the `machine:input` endpoint. **Keys** is always there.",
          "",
          remoteInputTroubleshootFirmware(variant),
          "- If the device has a password, enter it in Settings; Joystick and Keys both need it.",
          "- Otherwise, **Keys** types through the C64 keyboard buffer, which suits BASIC but not most games.",
          "",
        ]
      : []),
    "### Device stops answering",
    "",
    `Open Diagnostics if you can, and look at the recent REST, FTP and Telnet activity. If HTTP, FTP and Telnet all refuse to connect while ping still works, switch ${targetDeviceShortName(variant)} off and on again.`,
    "",
    "## Appendices",
    "",
    "The rest of this guide is for looking things up: the numbers, the defaults, and exactly where to find each thing.",
    "",
    "### Feature Reference",
    "",
    "The best place to look is listed first, in bold.",
    "",
    table(["Feature", "Where to find it", "Notes"], featureRows({ features, variant })),
    "",
    renderKeyboardReference({ features, variant }),
    "",
    "### File and Source Reference",
    "",
    table(["Source", "Used in", "Meaning"], sourceRows({ features, variant })),
    "",
    "Play accepts SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81 files. The disk collection holds disk images only: D64, G64, D71, G71, and D81.",
    "",
    table(
      ["Format", "Kind", "Notes"],
      [
        ["SID", "Music", "One or more tunes; durations shown when songlength data is available."],
        ["MOD", "Music", "Amiga-style tracker module."],
        ["PRG", "Program", "A single loadable program."],
        ["CRT", "Cartridge", "Cartridge image; started as if you inserted a cartridge."],
        ["D64, G64", "Disk", "1541 single-sided disk image."],
        ["D71, G71", "Disk", "1571 double-sided disk image."],
        ["D81", "Disk", "1581 3.5-inch disk image."],
      ],
    ),
    "",
    "### Network Ports and Services",
    "",
    "These are the defaults the app expects. If yours differ, change them for that device in **Settings → Connection**.",
    "",
    table(
      ["Service", "Default port", "Used for"],
      [
        ["Web Remote Control (REST)", "80", "Control, status, and configuration. Required."],
        ["FTP File Service", "21", "Browsing and transferring files, playlists, and disks."],
        ["Telnet Remote Menu", "23", "Advanced menu-backed actions, when those are enabled."],
      ],
    ),
    "",
    "### Device Safety Modes",
    "",
    "Set the mode in **Settings → Device Safety**. More requests at once is faster, but pushes the device harder. Each mode also sets caching, cooldowns, and backoff.",
    "",
    table(
      ["Mode", "Requests at once", "Use it when"],
      [
        ["Auto", "Chosen for you", autoSafetyModeNote(variant)],
        [
          "Relaxed",
          "Up to 3",
          "The device and network have proved fast and steady, and you accept the higher risk. Asks you to confirm.",
        ],
        ["Balanced", "Up to 2", balancedFirmwareNote(variant)],
        [
          "Conservative",
          "1 at a time",
          "A first setup, Wi-Fi, or firmware you do not yet trust. The safest of the five.",
        ],
        ["Troubleshooting", "1 at a time", "You are chasing a fault and want the extra debug logging."],
      ],
    ),
    "",
    "### Drive Types and Disk Formats",
    "",
    "Set the drive type on the **Disks** page to match the disk you are mounting. The list comes from the connected device, so a machine that offers more types shows them.",
    "",
    table(
      ["Drive type", "Disk images", "Description"],
      [
        ["1541", "D64, G64", "Single-sided 5.25-inch drive, and the one most software expects."],
        ["1571", "D71, G71, D64", "Double-sided 5.25-inch drive. Reads a 1541 disk as well."],
        ["1581", "D81", "High-capacity 3.5-inch drive."],
      ],
    ),
    "",
    "### Snapshot Types and Memory Ranges",
    "",
    `**Backup** offers these capture types. The app keeps up to 100 snapshots on your ${appDeviceName(
      variant,
    )} and drops the oldest once that fills.`,
    "",
    table(
      ["Snapshot", "Captures", "Memory range"],
      [
        [
          "CPU + RAM",
          "All of memory plus the processor registers, so the program can pick up where it stopped. Filed under Program in the library. Some machines and some programs decline; the app says so and suggests a Program snapshot.",
          "$0000–$FFFF + registers",
        ],
        ["Program", "Almost all of memory, skipping the stack. A good all-round choice.", "$0000–$00FF, $0200–$FFFF"],
        ["Basic", "The BASIC program and its variables.", "$002B–$0038, $0801–$9FFF"],
        ["Screen", "The current screen and its colors.", "VIC bank, $D000–$D02E, $D800–$DBFF, $DD00–$DD01"],
        ["Custom", "Exactly the address ranges you type.", "User-defined"],
      ],
    ),
    "",
    "### Health Check Probes",
    "",
    "Run a health check from **Diagnostics**. Each probe reports its own result and timing.",
    "",
    table(
      ["Probe", "What it checks"],
      [
        ["REST", "The Web Remote Control service answers."],
        ["FTP", "The FTP file service answers."],
        ["Telnet", "The Telnet menu service answers."],
        [
          "CONFIG",
          "Writes a live setting, reads it back, and restores it, proving the device applies changes. A machine with lights pulses them once; one without nudges a mixer volume instead.",
        ],
        [
          "RASTER",
          "The VIC-II raster line is moving, so the video chip is running. Recorded as skipped where the device does not expose it.",
        ],
        ["JIFFY", "The KERNAL jiffy clock is ticking, which also reports the machine's uptime."],
      ],
    ),
    "",
    "### Status and Safety Reference",
    "",
    table(
      ["Signal", "Meaning", "Best next step"],
      [
        ["Healthy badge", "The selected device is responding.", "Continue normally."],
        ["Degraded badge", "Some check or recent activity suggests trouble.", "Open Diagnostics."],
        [
          "Unhealthy badge",
          "The selected device is not responding correctly.",
          "Run a health check; verify network services.",
        ],
        [
          "Offline state",
          "No live connection is active.",
          "Use discovery, manual host entry, or Settings → Connection.",
        ],
        [
          "401/403 password prompt",
          "The device requires its network password.",
          `Enter ${targetDevicePasswordName(variant)}.`,
        ],
        [
          "TCP refused while ping works",
          `The network stack on ${isC64uRemoteVariant(variant) ? "the Commodore 64 Ultimate" : "the device"} may be stuck.`,
          "Stop traffic and power-cycle the device.",
        ],
        [
          "CPU-speed network drop",
          "Firmware may briefly drop network while applying clock changes.",
          "Wait for reconnect before changing more settings.",
        ],
      ],
    ),
    "",
  ];

  return `${sections
    .filter((section) => section !== null && section !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
};

/**
 * The back-of-book index.
 *
 * Curated rather than harvested. A machine-built index of every bold phrase runs
 * to a thousand entries and sends the reader to the page they were already on;
 * this is the list of things somebody actually arrives with a question about.
 *
 * `match` holds the literal phrases to look for in the body text. A term with no
 * hit in a given edition — T9 in the broad manual, say — drops out of that
 * edition's index by itself, so one list serves both. `see` makes a
 * cross-reference and takes no page numbers of its own.
 *
 * Matching is case-sensitive and anchored on word boundaries, so "Play" does not
 * catch "playlist" or "played".
 */
export const INDEX_TERMS = [
  { term: "A/V sync check", match: ["A/V sync"] },
  { term: "About this tune", match: ["**About this tune**"] },
  { term: "Appearance settings", match: ["**Appearance**"] },
  { term: "archive, online", see: "CommoServe" },
  { term: "audio network buffer", match: ["**audio network buffer**"] },
  { term: "Auto save config", match: ["Auto save config"] },
  { term: "Autofire", match: ["Autofire"] },
  { term: "Backup", see: "RAM snapshots" },
  { term: "BASIC ROM", match: ["ROMs are under copyright"] },
  { term: "badge, header", match: ["header badge", "The Header Badge"] },
  { term: "bus ID", match: ["bus ID"] },
  { term: "card descriptions", match: ["**Card descriptions**", "card descriptions"] },
  { term: "cartridge, freezer", match: ["freezer cartridge"] },
  { term: "Choose your C64", match: ["**Choose your C64**"] },
  { term: "CommoServe", match: ["CommoServe"] },
  { term: "composer", match: ["composer"] },
  { term: "CONFIG probe", match: ["CONFIG"] },
  { term: "Config page", match: ["Config holds every setting"] },
  { term: "config, per item", match: ["Review playback config", "playback config"] },
  { term: "configuration snapshots", match: ["configuration snapshots"] },
  { term: "Content Explorer", match: ["Content Explorer"] },
  { term: "crossfade", match: ["**Crossfade**"] },
  { term: "D64, D71, D81", see: "disk images" },
  { term: "Debug stream", match: ["**Debug**"] },
  { term: "default duration", match: ["**default duration**"] },
  { term: "Demo Mode", match: ["Demo Mode"] },
  { term: "Device Safety", match: ["Device Safety"] },
  { term: "Switch device", match: ["**Switch device**", "Switch device"] },
  { term: "devices, saved", match: ["Saved devices", "saved devices"] },
  { term: "Diagnostics", match: ["Reading Diagnostics"] },
  { term: "discovery", match: ["Discovery finds nothing", "Discover devices"] },
  { term: "Disk Explorer", match: ["Disk Explorer"] },
  { term: "disk groups", match: ["**group**"] },
  { term: "disk images", match: ["disk images"] },
  { term: "disk, blank", match: ["**New disk**"] },
  { term: "disk, mounting", match: ["Mounting is what the page is for", "Choose a disk from your collection"] },
  { term: "disk, renaming", match: ["**Rename disk**"] },
  { term: "disk, rotating", match: ["rotate", "Rotate Disks"] },
  { term: "Disks page", match: ["Disks is where the drives"] },
  { term: "display profile", match: ["display profile"] },
  { term: "DMA load", match: ["**DMA**"] },
  { term: "Docs page", match: ["Docs is the built-in help page"] },
  { term: "drives", match: ["Drives and Disk Images"] },
  { term: "drive type", match: ["drive type"] },
  { term: "Eject", match: ["**Eject**"] },
  { term: "Ethernet", match: ["**Ethernet**"] },
  { term: "feature switches", match: ["Feature switches", "Stable Features"] },
  { term: "Find a tune", match: ["**Find a tune**"] },
  { term: "firmware", match: ["firmware"] },
  { term: "flash, saving to", match: ["**Keep device settings after a restart**"] },
  { term: "Follow", match: ["**Follow**"] },
  { term: "Friendly SID names", match: ["Friendly SID names"] },
  { term: "FTP", match: ["FTP File Service", "FTP"] },
  { term: "Game Mode", match: ["**Game Mode**"] },
  { term: "health check", match: ["Run health check", "health check"] },
  { term: "heat maps", match: ["heat-map", "heat maps"] },
  { term: "Home page", match: ["Home groups the day-to-day controls"] },
  { term: "Home, with no C64 connected", match: ["**With no C64 connected**"] },
  { term: "hostname", match: ["hostname"] },
  { term: "HVSC", match: ["HVSC"] },
  { term: "immersive screen", match: ["immersive screen"] },
  { term: "Include subfolders", match: ["**Include subfolders**"] },
  { term: "IP address", match: ["IP address"] },
  { term: "JIFFY probe", match: ["JIFFY"] },
  { term: "joystick", match: ["**Joystick**"] },
  { term: "joystick keys", match: ["Classic T9", "Diamond (8-centred)"] },
  { term: "KERNAL", match: ["**KERNAL**", "Classic KERNAL load"] },
  { term: "Key Explorer", match: ["Key Explorer"] },
  { term: "keyboard, on-screen", match: ["**Keys**"] },
  { term: "keyboard, physical", match: ["Steering with a physical keyboard", "hardware keyboards"] },
  { term: "keypad navigation", match: ["Directional navigation", "Directional Pad"] },
  { term: "Launch Safety", match: ["Launch Safety"] },
  { term: "latency", match: ["Tap latency", "latency"] },
  { term: "Lighting", match: ["**Lighting**"] },
  { term: "Liked Tunes", match: ["**Liked Tunes**", "Liked Tunes"] },
  { term: "Listen", match: ["turns the sound on", "Listen"] },
  { term: "Live View", match: ["Live View"] },
  { term: "Local files", match: ["**Local**"] },
  { term: "locking the view", match: ["Locked on"] },
  { term: "low-latency audio", match: ["Low-latency audio"] },
  { term: "machines, supported", match: ["Supported Machines", "Your C64 Ultimate"] },
  { term: "Match my device", match: ["**Match my device**"] },
  { term: "MOD files", match: ["MOD"] },
  { term: "moods", see: "SID Radio" },
  { term: "More like this", match: ["**More like this**"] },
  { term: "Mount & Load", match: ["mounts the whole disk, resets the machine"] },
  { term: "Network Services & Timezone", match: ["Network Services"] },
  { term: "network password", match: ["network password"] },
  { term: "No C64 found", match: ["**No C64 found**"] },
  { term: "Notifications", match: ["**Notifications**"] },
  { term: "Now Playing card", match: ["Now Playing"] },
  { term: "NTSC", match: ["**NTSC**"] },
  { term: "number keys", match: ["Number Keys", "number keys"] },
  { term: "orientation", match: ["**Orientation**", "Orientation"] },
  { term: "output button", match: ["**output button**"] },
  { term: "PAL", match: ["**PAL**"] },
  { term: "palettes", match: ["Screen colors"] },
  { term: "Pause", match: ["Pause/Resume"] },
  { term: "Play page", match: ["Play is for building a playlist"] },
  { term: "playlist", match: ["playlist"] },
  { term: "ports, network", match: ["Network Ports and Services"] },
  { term: "Power Cycle", match: ["**Power Cycle**", "Power Cycle"] },
  { term: "Power Off", match: ["Power Off"] },
  { term: "Power sheet", match: ["where your device supports it"] },
  { term: "PRG programs", match: ["**PRG**", "PRG"] },
  { term: "printer", match: ["The Virtual Printer", "**Home → Printers**"] },
  { term: "Quick Actions", match: ["Quick Actions"] },
  { term: "quick keys", match: ["quick keys"] },
  { term: "Quick menu", match: ["Quick menu"] },
  { term: "RAM expansion", match: ["RAM expansion"] },
  { term: "RAM snapshots", match: ["RAM Snapshots", "**Backup**", "**Restore**"] },
  { term: "RASTER probe", match: ["RASTER"] },
  { term: "Reboot (Clr Mem)", match: ["**Reboot (Clr Mem)**"] },
  { term: "Release All", match: ["**Release All**"] },
  { term: "Remote Input", match: ["**Remote Input**"] },
  { term: "report, diagnostics", match: ["Sharing a Diagnostics Report", "Share all"] },
  { term: "Reset", match: ["**Reset**"] },
  { term: "REST", see: "Web Remote Control Service" },
  { term: "Restore", see: "RAM snapshots" },
  { term: "reboot", match: ["**Reboot**", "Reboot"] },
  { term: "rankings, clearing", match: ["Clear my rankings"] },
  { term: "search", match: ["Search covers the whole app", "Search"] },
  { term: "sections, expand and collapse", match: ["Expand all sections"] },
  { term: "Settings page", match: ["Settings controls how the app behaves"] },
  { term: "Settings transfer", match: ["Settings transfer"] },
  { term: "shuffle", match: ["shuffle"] },
  { term: "SID chip", match: ["**6581**", "6581"] },
  { term: "SID mixer", match: ["The SID Audio Mixer", "SID mixer"] },
  { term: "SID Radio", match: ["SID Radio"] },
  { term: "sleep timer", match: ["**Sleep timer**", "Sleep timer"] },
  { term: "Soft IEC", match: ["Soft IEC"] },
  { term: "songlengths", match: ["songlengths"] },
  { term: "sources, file", match: ["File Sources"] },
  { term: "star and pound keys", match: ["Star and Pound"] },
  { term: "Stats", match: ["**Stats**"] },
  { term: "STIL notes", see: "tunes, names of" },
  { term: "style, appearance", match: ["**Style**"] },
  { term: "streams", match: ["**Home → Streams**"] },
  { term: "system strip", match: ["system strip"] },
  { term: "T9 text entry", match: ["T9 Text Entry", "T9 mode"] },
  { term: "Telnet", match: ["Telnet Remote Menu Service", "Telnet"] },
  { term: "text size", match: ["**Text size**"] },
  { term: "Theme", match: ["**Theme**"] },
  { term: "tone and color ladder", match: ["color ladder"] },
  { term: "tour", match: ["The Tour", "Take the tour"] },
  { term: "traces", match: ["Traces"] },
  { term: "transport keys", match: ["Transport Keys", "transport keys"] },
  { term: "tunes, choosing", match: ["1/19"] },
  { term: "tunes, names of", match: ["what the individual tunes inside a file are called"] },
  { term: "VIC stream", match: ["**VIC**"] },
  { term: "video frame rate", match: ["Video frame rate"] },
  { term: "View all", match: ["**View all**"] },
  { term: "volume", match: ["**Volume**", "volume"] },
  {
    term: "Watch",
    match: ["turns the picture on", "first: Live, Game and Input", "on and the picture takes the space instead"],
  },
  { term: "Web Remote Control Service", match: ["Web Remote Control Service"] },
  { term: "zoom and pan", match: ["pinch", "Zoom in"] },
];

/**
 * Wraps the first hit of each index term, once per H3 section, in an anchor.
 *
 * Once per section rather than once per occurrence: a term like "playlist" appears
 * forty times across six pages, and an index entry listing six identical page
 * numbers helps nobody. A section is the unit a reader is sent to.
 *
 * The walk alternates between tags and text runs and only ever rewrites a text
 * run, so a match can never straddle a tag boundary and the wrap is always well
 * nested. Marks are inline spans carrying no style, so they cannot shift a line.
 */

/**
 * The colophon a bound manual carries on the back of its title page: which
 * edition this is, what it is for, who owns it, and the license. Also the place
 * the Commodore trademark is acknowledged, which a printed product needs and a
 * web page can get away with omitting.
 */
/**
 * The edition printed on the imprint page: the most recent release tag.
 *
 * Not `package.json`'s version. That is the version being *worked toward* and
 * moves with every commit on the way there, so a manual built mid-cycle would
 * claim to describe a release that does not exist yet. The newest tag is the last
 * release that actually shipped, which is the one a reader holding a printed copy
 * can go and install.
 *
 * Falls back to the package version where no tag is reachable — a shallow CI
 * clone, or a source archive with no git history.
 */
export const resolveEdition = () => {
  // The tag being built wins over `git describe`, which cannot tell which of
  // several tags on one commit started this build. 1.0.0 was cut at the commit
  // 0.11.0-rc3 already tagged, and the 1.0.0 manual went out stamped
  // 0.11.0-rc3. APP_VERSION covers a caller that resolves the version itself.
  const ref = (process.env.GITHUB_REF ?? "").trim();
  if (ref.startsWith("refs/tags/")) {
    const tagged = ref.slice("refs/tags/".length).trim();
    if (tagged) return tagged;
  }
  const provided = (process.env.APP_VERSION ?? process.env.VERSION_NAME ?? "").trim();
  if (provided) return provided;
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (tag) return tag;
  } catch {
    // No tags, or no git: fall through to the package version.
  }
  return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
};

const readOverlay = async ({ variantId, featureIds }) => {
  const overlayFile = path.join(overlaysDir, `${variantId}.yaml`);
  if (!fs.existsSync(overlayFile)) return { overrides: {} };
  const source = await readText(overlayFile);
  return parseFeatureFlagOverlaySource(source, { featureIds, variantId });
};

export const buildManualContexts = async () => {
  const variantConfig = parseVariantSource(await readText(variantsFile), { repoRoot: rootDir });
  const baseRegistry = parseRegistrySource(await readText(baseFeatureFlagsFile));
  const featureIds = new Set(baseRegistry.features.map((feature) => feature.id));
  const appVersion = resolveEdition();

  const contexts = [];
  for (const [variantId, variant] of Object.entries(variantConfig.variants)) {
    const overlay = await readOverlay({ variantId, featureIds });
    const featureRegistry = resolveVariantFeatureRegistry(baseRegistry, overlay);
    const features = normalizeFeatureFlags(featureRegistry);
    const manualDir = path.join(manualsRoot, variantId);
    const basename = `${variant.exportedFileBasename}-manual`;
    contexts.push({
      variant,
      features,
      manualDir,
      markdownFile: path.join(manualDir, `${basename}.md`),
      pdfFile: path.join(manualDir, `${basename}.pdf`),
      title: `${variant.displayName} Manual`,
      subtitle: manualSubtitle(variant),
      appVersion,
    });
  }
  return contexts.sort((a, b) => a.variant.id.localeCompare(b.variant.id));
};

/**
 * Every app screenshot a manual embeds must come from that manual's own display profile.
 *
 * The C64U Remote manual is illustrated at `compact`, the C64 Commander manual at `medium`.
 * The generator already chooses between them, but an image path written without a
 * `{profile}` placeholder silently resolves to a single shared rendition, so one of the two
 * manuals ends up showing the other one's screen size. That is what happened to eleven
 * images: both manuals embedded the same compact captures.
 *
 * Checked here rather than by eye, because the failure is invisible in the Markdown - the
 * path simply lacks a directory - and only shows up as a differently proportioned picture.
 */
const ALLOWED_WITHOUT_PROFILE = [
  // A photograph of the hardware, not a screen capture.
  /\/img\/setup\//,
  // Already profile-specific by filename: these exist to show how the profiles differ, so
  // each one deliberately keeps the profile it demonstrates.
  /home\/remote-input\/03-keyboard-compact\.png$/,
  /home\/remote-input\/04-keyboard-medium\.png$/,
];

export const assertSingleDisplayProfile = (markdown, expectedProfile, manualName) => {
  const violations = [];
  for (const [, image] of markdown.matchAll(/\]\(([^)]*\.png)\)/g)) {
    if (ALLOWED_WITHOUT_PROFILE.some((allowed) => allowed.test(image))) continue;
    const match = image.match(/\/profiles\/([^/]+)\//);
    if (!match) violations.push(`${image} has no display profile in its path`);
    else if (match[1] !== expectedProfile)
      violations.push(`${image} is a ${match[1]} capture, but this manual uses ${expectedProfile}`);
  }
  if (violations.length > 0) {
    throw new Error(
      `${manualName} embeds ${violations.length} screenshot(s) from outside its ${expectedProfile} profile:\n` +
        violations.map((line) => `  - ${line}`).join("\n"),
    );
  }
};

export const buildManuals = async () => {
  const contexts = await buildManualContexts();
  const outputs = [];

  for (const context of contexts) {
    await mkdir(context.manualDir, { recursive: true });
    const markdown = renderManualMarkdown(context);
    assertSingleDisplayProfile(
      markdown,
      context.variant.id === "c64u-remote" ? "compact" : "medium",
      context.variant.id,
    );
    await writeFile(context.markdownFile, markdown, "utf8");
    await writeFile(path.join(context.manualDir, ".last-build"), `Generated ${new Date().toISOString()}\n`, "utf8");
    outputs.push({ markdown: path.relative(rootDir, context.markdownFile) });
  }

  return outputs;
};

const main = async () => {
  const outputs = await buildManuals();
  outputs.forEach((output) => {
    console.log(`Generated ${output.markdown}`);
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
