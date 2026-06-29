#!/usr/bin/env node
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { marked } from "marked";
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

const buildToc = (markdown) => {
  slugCounts.clear();
  return markdown
    .split("\n")
    .flatMap((line) => {
      const match = /^(#{2,3})\s+(.+)$/.exec(line);
      if (!match) return [];
      const title = stripMarkdown(match[2]);
      if (title === "Table of Contents") return [];
      return [{ depth: match[1].length, title, id: slugify(match[2]) }];
    })
    .filter((entry) => entry.depth === 2 || entry.depth === 3);
};

const addHeadingIds = (html, toc) => {
  let headingIndex = 0;
  return html.replace(/<h([23])>(.*?)<\/h\1>/g, (full, depth, content) => {
    const entry = toc[headingIndex];
    headingIndex += 1;
    if (!entry) return full;
    return `<h${depth} id="${entry.id}">${content}</h${depth}>`;
  });
};

const pdfCss = `
  @page { size: A4; margin: 18mm 15mm 20mm; }
  * { box-sizing: border-box; }
  body {
    color: #1c1b18;
    font: 11pt/1.55 "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    margin: 0;
  }
  .cover {
    break-after: page;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 245mm;
    text-align: center;
  }
  .cover h1 { border: 0; font-size: 34pt; margin: 0 0 8mm; }
  .cover p { color: #555047; font-size: 15pt; margin: 0; }
  .toc {
    border: 1px solid #ded8ce;
    border-radius: 8px;
    break-after: page;
    padding: 12mm;
  }
  .toc h2 { margin-top: 0; }
  .toc ol { margin: 0; padding-left: 18px; }
  .toc li { margin: 3px 0; }
  .toc .depth-3 { font-size: 10pt; margin-left: 18px; }
  h1, h2, h3 { color: #15130f; line-height: 1.18; }
  h1 { font-size: 24pt; margin: 0 0 6mm; }
  h2 {
    border-bottom: 1px solid #ded8ce;
    font-size: 17pt;
    margin: 12mm 0 4mm;
    padding-bottom: 2mm;
  }
  h3 { font-size: 13pt; margin: 7mm 0 2mm; }
  p, ul, ol, table { margin: 0 0 4mm; }
  li { margin: 1.2mm 0; }
  a { color: #245f9e; text-decoration: none; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ded8ce; padding: 5px 7px; vertical-align: top; }
  th { background: #f4f0e8; font-weight: 700; }
  img {
    border: 1px solid #d8d0c5;
    border-radius: 8px;
    display: block;
    margin: 5mm auto 7mm;
    max-height: 145mm;
    max-width: 92mm;
    object-fit: contain;
  }
  code {
    background: #f4f0e8;
    border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, monospace;
    padding: 1px 4px;
  }
`;

const markdownToc = [
  "Welcome",
  "Before You Start",
  "First Connection",
  "Your First Tour",
  "Everyday Flows",
  "Safe Device Use",
  "Troubleshooting",
  "Feature Reference",
  "Keyboard and Directional Input Reference",
  "File and Source Reference",
  "Status and Safety Reference",
];

const profileImage = (profile, imagePath) => `../../img/app/${imagePath.replace("{profile}", profile)}`;

const image = (alt, profile, imagePath) => `![${alt}](${profileImage(profile, imagePath)})`;
const docsImage = (alt, imagePath) => `![${alt}](../../img/${imagePath})`;

const dataUriForImage = async (imagePath, manualDir) => {
  const absolutePath = path.resolve(manualDir, imagePath);
  const relativeToRoot = path.relative(rootDir, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`manual image path escapes repository: ${imagePath}`);
  }
  const extension = path.extname(absolutePath).slice(1).toLowerCase();
  const contentType =
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
  const imageBuffer = await readFile(absolutePath);
  return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
};

export const inlineImageSources = async (html, manualDir) => {
  const imageSrcPattern = /<img([^>]*?)src="([^"]+)"([^>]*?)>/g;
  const replacements = [];
  for (const match of html.matchAll(imageSrcPattern)) {
    const source = match[2];
    if (/^(data:|https?:)/.test(source)) continue;
    replacements.push({ full: match[0], source });
  }

  let rendered = html;
  for (const replacement of replacements) {
    const dataUri = await dataUriForImage(replacement.source, manualDir);
    rendered = rendered.replace(
      replacement.full,
      replacement.full.replace(`src="${replacement.source}"`, `src="${dataUri}"`),
    );
  }
  return rendered;
};

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

const featureSettingGroup = (feature) => (feature.group === "stable" ? "Stable Features" : "Experimental Features");

const featureAvailability = (feature) => {
  if (!feature?.isMentionable) return null;
  if (feature.enabled && feature.isUserToggleable) {
    return `On by default. You can change it in Settings > ${featureSettingGroup(feature)}.`;
  }
  if (feature.enabled) return "Always enabled in this variant.";
  return `Optional. Enable it in Settings > ${featureSettingGroup(feature)}.`;
};

const includeFeature = (features, id) => Boolean(features[id]?.isMentionable);

const featureRows = ({ features, variant }) => {
  const rows = [
    [
      "Connect to a device",
      "**Startup discovery**, Settings > Connection",
      "Use startup discovery first. Use Settings for later edits.",
    ],
    [
      "Manual host/IP entry",
      "**Startup prompt when no devices are found**, Settings > Connection",
      "Startup prompt is fastest on first run; Settings is best for saved-device maintenance.",
    ],
    ["Network password", "**Startup prompt or auth popup**, Settings > Connection", "The app asks only when needed."],
    [
      "Switch saved device",
      "**Header badge long-press / `#`**, Settings > Connection",
      "Use Device Switcher for fast switching; Settings for editing.",
    ],
    ["Reset / Reboot / Pause / Menu", "**Home > Quick Actions**", "Main daily control path."],
  ];

  if (includeFeature(features, "home_telnet_power_cycle_enabled")) {
    rows.push([
      "Power Cycle",
      "**Home > Quick Actions**",
      featureAvailability(features.home_telnet_power_cycle_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_clear_ram_reboot_enabled")) {
    rows.push([
      "Clear-RAM reboot",
      "**Home > Quick Actions**",
      featureAvailability(features.home_telnet_clear_ram_reboot_enabled),
    ]);
  }
  if (includeFeature(features, "ram_snapshots_enabled")) {
    rows.push(["Save / Load RAM", "**Home > Quick Actions**", featureAvailability(features.ram_snapshots_enabled)]);
  }
  if (includeFeature(features, "home_telnet_reu_snapshot_enabled")) {
    rows.push([
      "Save / Restore REU",
      "**Home > Quick Actions**",
      featureAvailability(features.home_telnet_reu_snapshot_enabled),
    ]);
  }

  rows.push(
    ["CPU speed and turbo", "**Home > Quick Config**, Config", "Home is preferred for common changes."],
    ["Video mode and scan lines", "**Home > Quick Config**, Config", "Home is preferred."],
    ["Joystick, serial bus, cartridge, user port", "**Home > Quick Config**, Config", "Home is preferred."],
  );

  if (includeFeature(features, "lighting_studio_enabled")) {
    rows.push(["Lighting Studio", "**Home > Lighting**", featureAvailability(features.lighting_studio_enabled)]);
  }

  rows.push(
    [
      "Drive power, bus, type, reset",
      "**Disks**, Home > Drives",
      "Disks is preferred for drive work; Home is good for quick checks.",
    ],
    ["Mount/eject disks", "**Disks**, Home > Drives", "Disks gives the clearest disk collection view."],
    ["Disk groups and rotation", "**Disks**", "Set a group in the disk collection, then rotate from drive controls."],
    ["Printer controls", "**Home > Printer**, Config", "Home is preferred."],
    ["SID mixer", "**Home > SID / Audio mixer**, Config > Audio Mixer", "Home is preferred for live mixing."],
    ["Streams", "**Home > Streams**, Config", "Visible when the device exposes streaming support."],
    [
      "Save/load device config",
      "**Home > Config actions**",
      "Use Save to flash when device settings should survive a reboot or power cycle.",
    ],
    ["App-stored config snapshots", "**Home > Config actions**", "Local app snapshots, separate from device flash."],
  );

  if (includeFeature(features, "home_telnet_config_actions_enabled")) {
    rows.push([
      "Advanced config file actions",
      "**Home > Config actions**",
      featureAvailability(features.home_telnet_config_actions_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_drive_actions_enabled")) {
    rows.push([
      "Advanced drive shortcuts",
      "**Home > Drives**",
      featureAvailability(features.home_telnet_drive_actions_enabled),
    ]);
  }
  if (includeFeature(features, "home_telnet_printer_actions_enabled")) {
    rows.push([
      "Advanced printer shortcuts",
      "**Home > Printer**",
      featureAvailability(features.home_telnet_printer_actions_enabled),
    ]);
  }

  rows.push(["Full configuration tree", "**Config**", "Use search, open a category, edit rows."]);

  const sources = ["Local", "C64U"];
  if (includeFeature(features, "hvsc_enabled")) sources.push("HVSC");
  if (includeFeature(features, "commoserve_enabled")) sources.push("CommoServe");
  rows.push(["Add playlist items", "**Play > Add items**", `Sources: ${sources.join(", ")}.`]);
  rows.push(["Playback controls", "**Play**", "Play, pause, previous/next, shuffle, repeat, duration, and volume."]);

  if (includeFeature(features, "hvsc_enabled")) {
    rows.push(["HVSC preparation", "**Play**, Settings > HVSC", featureAvailability(features.hvsc_enabled)]);
  }
  if (includeFeature(features, "commoserve_enabled")) {
    rows.push([
      "CommoServe",
      "**Play > Add items**, Disks > Add disks, Settings > Online Archive",
      featureAvailability(features.commoserve_enabled),
    ]);
  }
  if (includeFeature(features, "demo_mode_enabled")) {
    rows.push(["Demo Mode", "**Settings > Connection**", featureAvailability(features.demo_mode_enabled)]);
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
      "Display profile and theme",
      "**Settings > Appearance**",
      `${variant.id === "c64u-remote" ? "Compact" : "Medium"} screenshots in this manual match this guide's presentation.`,
    ],
    ["Device Safety", "**Settings > Device Safety**", "Use Balanced normally; Conservative for unstable networks."],
    ["Diagnostics", "**Header badge / `*`**, Settings > Diagnostics", "Badge is preferred for fast access."],
    ["Logs, traces, errors, health checks", "**Diagnostics**", "Use filters and Share for support."],
    ["Built-in help", "**Docs**", "Good for quick reminders inside the app."],
  );

  return rows;
};

const sourceRows = (features) => {
  const rows = [
    ["Local", "Play, Disks", "Files and folders available to the Android device running the app."],
    ["C64U", "Play, Disks", "Files on the C64 Ultimate through FTP."],
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
    "## Keyboard and Directional Input Reference",
    "",
    `${featureAvailability(features.keypad_input_enabled)} Directional navigation works with D-pad keys, arrow keys, and compatible hardware keyboards.`,
    "",
    "### Directional Pad",
    "",
    table(
      ["Key", "What it does"],
      [
        ["Up / Down", "Move through the current page, card, list, or dialog."],
        ["Left / Right", "Adjust sliders, tabs, and segmented controls. Otherwise move to a nearby control."],
        ["OK / Center / Enter", "Enter a group, open a select, press a button, or toggle a switch."],
        ["Back / Escape", "Close the top dialog, leave a field, leave a group, or go back."],
        ["Menu / Context Menu", "Open the focused item menu; if none exists, open the Quick Menu."],
      ],
    ),
    "",
    "The rule is simple: **OK goes in, Back comes out**.",
    "",
    "### Number Keys",
    "",
    "Outside text fields, number keys jump to pages:",
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
      ],
    ),
    "",
    "### Star and Pound",
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
          "Open Device Switcher",
          variant.runtime.defaultT9InputEnabled ? "Toggle T9 mode" : "Type `#` when the field accepts it",
        ],
      ],
    ),
  ];

  if (variant.runtime.defaultT9InputEnabled) {
    sections.push(
      "",
      "### T9 Text Entry",
      "",
      "Use T9 in text fields such as hostnames and filters.",
      "",
      "1. Focus a text field.",
      "2. Press `#` if you need to toggle T9 mode.",
      "3. Press number keys to enter letters.",
      "4. Press `*` in host fields to cycle separators.",
      "5. Use Back to leave the field.",
      "",
      "For hostnames, this makes entries such as `c64u`, `u64`, and `192.168.1.64` practical without a touchscreen.",
    );
  }

  sections.push(
    "",
    "### Quick Menu",
    "",
    "Press Menu when no focused control has its own menu. The Quick Menu offers page jumps, Diagnostics, and Device Switcher when more than one device is saved.",
  );

  return sections.join("\n");
};

export const renderManualMarkdown = ({ variant, features }) => {
  const appName = variant.displayName;
  const title = `${appName} Manual`;
  const subtitle = "Connect, control, play, mount, and diagnose a Commodore 64 Ultimate.";
  const profile = variant.id === "c64u-remote" ? "compact" : "medium";
  const sourceLabels = ["Local", "C64U"];
  if (includeFeature(features, "hvsc_enabled")) sourceLabels.push("HVSC");
  if (includeFeature(features, "commoserve_enabled")) sourceLabels.push("CommoServe");
  const quickConfigItems = [
    "CPU speed",
    "RAM expansion",
    "joystick swap",
    "serial bus mode",
    "video output",
    "scan lines",
    "interface behavior",
  ];
  if (includeFeature(features, "lighting_studio_enabled")) quickConfigItems.push("lighting");

  const sections = [
    `# ${title}`,
    "",
    subtitle,
    "",
    image(`${appName} launch screen`, profile, "launch/profiles/{profile}/04-app-ready.png"),
    "",
    "## Table of Contents",
    "",
    ...markdownToc.map(
      (section) =>
        `- [${section}](#${section
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")})`,
    ),
    "",
    "## Welcome",
    "",
    `${appName} controls a Commodore 64 Ultimate from one app.`,
    "",
    "The main jobs are:",
    "",
    "- **Control**: reset, reboot, menu, drives, printer, SID, streams, RAM, and configuration.",
    `- **Files and playback**: playlists, ${sourceLabels.join(", ")}, and disk collections.`,
    "- **Diagnostics**: health checks, logs, traces, errors, latency, and device switching.",
    "",
    "Start with the walkthrough if you are new to the app. Use the reference sections when you already know what you want to do.",
    "",
    "## Before You Start",
    "",
    "Connection has three parts: the app device, the C64 Ultimate, and the local network between them.",
    "",
    "Put the device running the app and the C64 Ultimate on the same Wi-Fi or wired LAN. Then open **Network Services & Timezone** on the C64 Ultimate.",
    "",
    docsImage("C64 Ultimate Network Services & Timezone menu", "setup/enable_services.png"),
    "",
    "Enable the services the app uses:",
    "",
    "- **Web Remote Control Service**: required for most control and status operations.",
    "- **FTP File Service**: needed for C64U file browsing, playlists, and disk collections.",
    "- **Telnet Remote Menu Service**: used for advanced menu-backed actions when those actions are enabled.",
    "",
    "Note the IP address under **Wired Network Setup** or **WI-FI Network Setup**. You may need it if local discovery cannot see the device.",
    "",
    "## First Connection",
    "",
    `Start ${appName}. If no saved device is reachable, it scans the local network for C64 Ultimate devices.`,
    "",
    "If devices are found:",
    "",
    "1. Choose **Use** to connect now.",
    "2. Choose **Save** to keep the device for later.",
    "3. If the device is password-protected, enter its network password when asked.",
    "",
    `If no devices are found, ${appName} opens a manual setup prompt.`,
    "",
    "Enter a hostname such as `c64u` or an IP address such as `192.168.1.64`, then choose **Connect**. If the device answers but requires a password, the same dialog asks for it before saving and connecting.",
    "",
    "A healthy badge at the top right confirms that the active device is responding. You can scan again later from **Settings > Connection > Discover devices**.",
    "",
    "## Your First Tour",
    "",
    "### The Header Badge",
    "",
    "The top-right badge shows the current device status: healthy, degraded, unhealthy, or offline. Tap it to open Diagnostics. Long-press it, press `#`, or use the Quick Menu to open Device Switcher.",
    "",
    "### Home",
    "",
    "Home groups the day-to-day controls.",
    "",
    image("Home overview", profile, "home/profiles/{profile}/01-overview.png"),
    "",
    "Start at the top. The system strip confirms which app build, device, and firmware you are using. Below it, Quick Actions give you the familiar front-panel moves: Reset, Reboot, Pause/Resume, Menu, RAM snapshots when enabled, and power actions when the device supports them.",
    "",
    `Keep moving down and you reach Quick Config. These are the settings you are likely to touch in the middle of a session: ${choiceList(quickConfigItems)}.`,
    "",
    "The lower cards cover drives, printer, SID mixer, streams, and configuration actions. **Save to flash** writes changed device settings to the C64 Ultimate flash configuration.",
    "",
    "### Play",
    "",
    "Play is for building a playlist and running it.",
    "",
    image("Play overview", profile, "play/profiles/{profile}/01-overview.png"),
    "",
    "Choose **Add items**, then choose a source.",
    "",
    image("Add items source chooser", profile, "play/import/profiles/{profile}/01-import-interstitial.png"),
    "",
    "The picker stays inside that source, so **Up** never escapes into a different place by accident. Select files or folders, confirm, then play from the playlist. Use View all when the playlist grows.",
    "",
    image("C64U file picker", profile, "play/import/profiles/{profile}/02-c64u-file-picker.png"),
    "",
    "Playback supports SID, MOD, PRG, CRT, and disk images. SID files can expose subsongs. When songlength metadata is available, the app shows duration and can advance more predictably.",
    "",
    image("Playlist view all", profile, "play/profiles/{profile}/02-view-all.png"),
    "",
    "A playlist can stay tiny for one song or become a queue for a whole session.",
    "",
    "When the list is short, use the main Play page. When it grows, open **View all**. The larger view gives you room to scan, filter, select, remove, and reorder without losing the playback controls.",
    "",
    "Add broadly, then filter narrowly. Add a folder, an album, or a set of related files. Then filter by title, path, source, type, or archive result.",
    "",
    "The filter changes the visible list, not the playlist itself. Clearing it brings the full queue back.",
    "",
    "Each playlist item keeps its origin. Local files remain local, C64U files point back to the device, archive results remember their source, and SID entries can retain songlength and subsong information.",
    "",
    "Use playback controls for the session: play or pause, previous or next, shuffle, repeat, and volume. Use item actions for one entry: remove it, inspect it, choose a subsong, or apply an item-specific playback setting where available.",
    "",
    "For SID files, watch duration and subsong information. A SID may contain one tune or several. Songlength data makes advancing through the list less like guesswork.",
    "",
    "For disk images, Play is convenient when you are launching or testing. Disks is better when drive setup, grouping, or collection work matters.",
    "",
    "### Disks",
    "",
    "Disks manages drives and disk images.",
    "",
    image("Disks overview", profile, "disks/profiles/{profile}/01-overview.png"),
    "",
    "Use drive cards to turn drives on or off, set bus ID and drive type, mount and eject images, reset drives, and set a Soft IEC path. Use **Add disks** to build a disk collection from the available sources.",
    "",
    image("Disk collection view", profile, "disks/profiles/{profile}/02-view-all.png"),
    "",
    "For multi-disk titles, put related disks in a group. Once grouped, the drive controls can rotate through them.",
    "",
    "Organize the disk collection around the titles you use.",
    "",
    "Add a single image, a folder of images, or an archive search result. Then filter by name, path, source, or group. Filtering helps you find; it does not delete or move anything.",
    "",
    "Mounting is the central Disks action. Choose the disk, choose the target drive, and mount. Eject when you want the drive empty again.",
    "",
    "If a title uses several disks, assign the related entries to the same group. Use rotation later to move to disk 2 or disk 3.",
    "",
    "Drive settings live beside the collection because they shape how mounted images behave. Bus ID, drive type, enable state, reset, and Soft IEC path all matter when software expects a particular drive setup.",
    "",
    "Use Disks for collection work because the collection, filters, grouping, and mount flow are on the same page.",
    "",
    "### Config",
    "",
    "Config is the complete configuration tree.",
    "",
    image("Config overview", profile, "config/profiles/{profile}/01-overview.png"),
    "",
    "Search for a category, open it, and edit rows directly. The app chooses the right control for each item: slider, switch, select, or text field.",
    "",
    "A change is sent to the active device immediately. The firmware applies it and marks the changed configuration store as needing a flash save.",
    "",
    "Use **Save to flash** when the changed device settings should survive a device reboot or power cycle. Until then, they are active for the running device configuration but not written to flash.",
    "",
    "Use Config when you know the setting exists but not where the device menu hides it. Search reduces the tree to matching categories and rows. After changing a value, wait for the write to finish before changing another related setting.",
    "",
    "Config writes to the active device; it does not edit a draft. Use Config for precise or uncommon settings, and page-specific controls for routine changes.",
    "",
    "### Settings",
    "",
    "Settings controls app behavior and saved connection details.",
    "",
    image("Settings overview", profile, "settings/profiles/{profile}/01-overview.png"),
    "",
    "Connection settings live here, along with display profile, full-screen behavior, diagnostics options, feature toggles, archive settings, notifications, and Device Safety.",
    "",
    "If the device is hard to reach, start in **Connection**. If it is reachable but fragile, start in **Device Safety**.",
    "",
    "Settings also holds saved devices. Use it to edit a name, host, HTTP port, FTP port, Telnet port, or password. When you save and connect, the app probes the device and reports whether the chosen services answer.",
    "",
    "Display settings are local to the app. They do not change the C64 Ultimate. Use them to choose the display profile, full-screen behavior, notification style, and how dense the interface should feel.",
    "",
    "Feature toggles appear only when a feature is safe for normal users to change in this variant. If a feature is not supported by this variant, it is absent from Settings and from this manual.",
    "",
    "### Docs",
    "",
    "Docs is the built-in help page.",
    "",
    image("Docs overview", profile, "docs/profiles/{profile}/01-overview.png"),
    "",
    "It covers setup, Home, Play, Disks, Config, Settings, Diagnostics, and disk swapping.",
    "",
    "### Diagnostics",
    "",
    "Diagnostics shows connection health, recent activity, and failures.",
    "",
    image("Diagnostics overview", profile, "diagnostics/profiles/{profile}/01-overview.png"),
    "",
    "Open it when a control fails, playback does not start, a file transfer stalls, or the badge looks unhealthy. It includes Problems, Actions, Logs, Errors, Traces, health checks, latency views, heat maps, filters, Share, and Clear.",
    "",
    "Start with Problems when you want a plain-language summary. Move to Errors when something failed. Use Traces when timing, request order, or endpoint behavior matters. Health checks are the quickest way to confirm whether REST, FTP, and Telnet are alive.",
    "",
    "The Share action packages useful evidence. Use it before restarting the app if you are investigating a recurring issue, because the most useful details are often the last few actions before a failure.",
    "",
    "### Device Switching",
    "",
    "Device Switcher is for homes with more than one saved C64 Ultimate.",
    "",
    image("Device switcher", profile, "diagnostics/switch-device/profiles/{profile}/01-picker.png"),
    "",
    "Open it from the badge long-press, `#`, or Quick Menu. Expand a row for more detail.",
    "",
    image("Device switcher expanded", profile, "diagnostics/switch-device/profiles/{profile}/02-picker-expanded.png"),
    "",
    "## Everyday Flows",
    "",
    "### Connect by Hand",
    "",
    "1. Open **Settings > Connection** or use the startup prompt when discovery finds nothing.",
    "2. Enter a hostname or IP address.",
    "3. Choose **Save & Connect** or **Connect**.",
    "4. Enter the network password if prompted.",
    "",
    "Preferred path: use startup discovery first, then manual host entry if discovery finds nothing.",
    "",
    "### Maintain Saved Devices",
    "",
    "1. Open **Settings > Connection**.",
    "2. Review the saved-device list.",
    "3. Edit names and ports so each device is recognizable.",
    "4. Use **Save & Connect** after changing the active device.",
    "5. Remove stale devices when they are no longer on your network.",
    "",
    "Preferred path: Settings for editing, Device Switcher for choosing.",
    "",
    "### Reboot and Return to Work",
    "",
    "1. Open **Home**.",
    "2. Choose **Reboot**.",
    "3. Confirm.",
    "4. Watch the badge until the device returns healthy.",
    "",
    "Preferred path: Home Quick Actions. Use Diagnostics only if the device does not return.",
    "",
    "### Play a SID or Program",
    "",
    "1. Open **Play**.",
    "2. Choose **Add items**.",
    `3. Choose ${choiceList(sourceLabels)}.`,
    "4. Select files or folders.",
    "5. Confirm and press Play.",
    "",
    "Preferred path: Play. Use C64U source for files already on the device; use Local for files on the Android device.",
    "",
    "### Build a Playlist from Folders",
    "",
    "1. Open **Play > Add items**.",
    "2. Choose the source that owns the folder.",
    "3. Navigate into the folder.",
    "4. Select the files or folders you want.",
    "5. Confirm the selection.",
    "6. Open **View all** if the list is long.",
    "",
    "Preferred path: Add a folder first, then filter the playlist to choose what to play next.",
    "",
    "### Filter and Clean a Playlist",
    "",
    "1. Open **Play > View all**.",
    "2. Type a few characters from the title, path, source, or file type.",
    "3. Review the filtered rows.",
    "4. Remove unwanted rows or clear the filter to return to the full list.",
    "",
    "Preferred path: filter before removing. A filter changes only what you can see.",
    "",
    "### Work with SID Subsongs",
    "",
    "1. Add one or more SID files to Play.",
    "2. Select the SID item.",
    "3. Choose the subsong or playback option if the file exposes one.",
    "4. Use duration information when available to decide whether to repeat, skip, or continue.",
    "",
    "Preferred path: keep SID work in Play; use HVSC preparation only when the library itself needs attention.",
    "",
    "### Mount a Disk",
    "",
    "1. Open **Disks**.",
    "2. Add disks if the collection is empty.",
    "3. Open the drive mount action.",
    "4. Choose a disk.",
    "",
    "Preferred path: Disks. Home also shows drive shortcuts, but Disks gives the clearest collection view.",
    "",
    "### Build a Disk Collection",
    "",
    "1. Open **Disks > Add disks**.",
    `2. Choose ${choiceList(sourceLabels)}.`,
    "3. Select disk images or folders.",
    "4. Confirm the selection.",
    "5. Use **View all** to inspect the collection.",
    "",
    "Preferred path: Disks for collection work; Play for launch-oriented queues.",
    "",
    "### Filter, Group, and Rotate Disks",
    "",
    "1. Open the disk collection view.",
    "2. Filter by title, path, source, or group.",
    "3. Assign related disks to the same group.",
    "4. Mount the first disk.",
    "5. Use rotation controls when the title asks for the next disk.",
    "",
    "Preferred path: group related disks before you need to swap them.",
    "",
    "### Mount to a Specific Drive",
    "",
    "1. Open **Disks**.",
    "2. Confirm the target drive is enabled.",
    "3. Check bus ID and drive type if the software is particular.",
    "4. Choose the disk image.",
    "5. Mount it to the intended drive.",
    "",
    "Preferred path: adjust drive setup before mounting.",
    "",
    "### Change a Common Setting",
    "",
    "1. Try **Home > Quick Config** first.",
    "2. If the setting is not there, open **Config** and search.",
    "3. Change the value.",
    "4. Use **Save to flash** if the change should survive a device reboot or power cycle.",
    "",
    "Preferred path: Home for common settings; Config for the full tree.",
    "",
    "### Save Device Configuration",
    "",
    "1. Make the changes you need on Home or Config.",
    "2. Confirm the device is healthy.",
    "3. Open **Home > Config actions**.",
    "4. Choose **Save to flash**.",
    "",
    "Preferred path: change first, then save once. Avoid repeated flash writes while experimenting.",
    "",
    "### Investigate a Problem",
    "",
    "1. Tap the header badge or press `*`.",
    "2. Run a health check.",
    "3. Review Problems, Errors, and Traces.",
    "4. Share diagnostics if you need support.",
    "",
    "Preferred path: Diagnostics from the badge.",
    "",
    "### Export Useful Diagnostics",
    "",
    "1. Open **Diagnostics**.",
    "2. Check Problems and Errors.",
    "3. Open Traces if request order matters.",
    "4. Use **Share** before clearing logs.",
    "",
    "Preferred path: Share before restart when you are trying to preserve evidence.",
    "",
    "## Safe Device Use",
    "",
    `${appName} uses normal REST, FTP, and Telnet requests, but C64 Ultimate firmware can still become unresponsive under some network conditions. The app reduces risk by pacing traffic and surfacing errors.`,
    "",
    "Good habits:",
    "",
    "- avoid repeating the same command while the device is already busy;",
    "- use Device Safety presets instead of raising concurrency aggressively;",
    "- prefer Conservative when testing unstable firmware or Wi-Fi;",
    "- power-cycle the C64 Ultimate if all TCP services stop responding while ping still works.",
    "",
    "The CPU speed setting can briefly drop the network while the device applies a clock change. Wait for the app to reconnect.",
    "",
    "## Troubleshooting",
    "",
    "### Discovery finds nothing",
    "",
    "- Confirm both devices are on the same network.",
    "- Check that Web Remote Control Service is enabled.",
    "- Enter the hostname or IP address manually.",
    "- Try the IP address if the hostname does not resolve.",
    "",
    "### Password required",
    "",
    "Enter the network password configured on the C64 Ultimate. If the saved password stops working, the app asks again.",
    "",
    "### File browsing fails",
    "",
    "- Confirm FTP File Service is enabled.",
    "- Check the FTP port in Settings.",
    "- Reconnect from Settings if the device was restarted.",
    "",
    "### Playback does not start",
    "",
    "- Check that the device is connected and healthy.",
    "- Confirm the selected file type is supported.",
    "- For local files, reselect the source if Android storage permission was lost.",
    "- For disk images, confirm the target drive is available.",
    "",
    "### Controls look disabled",
    "",
    "Some controls appear only when the connected device reports support. Others are disabled while an operation is running or when no matching item exists.",
    "",
    "### Device stops answering",
    "",
    "Open Diagnostics if possible and check recent REST/FTP/Telnet activity. If HTTP, FTP, and Telnet all refuse connections while ping still works, manually power-cycle the C64 Ultimate.",
    "",
    "## Feature Reference",
    "",
    "Preferred locations are marked first.",
    "",
    table(["Feature", "Where to find it", "Notes"], featureRows({ features, variant })),
    "",
    renderKeyboardReference({ features, variant }),
    "",
    "## File and Source Reference",
    "",
    table(["Source", "Used in", "Meaning"], sourceRows(features)),
    "",
    "Supported playback/import types include SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81. Disk collection workflows focus on disk images: D64, G64, D71, G71, and D81.",
    "",
    "## Status and Safety Reference",
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
          "Use discovery, manual host entry, or Settings > Connection.",
        ],
        [
          "401/403 password prompt",
          "The device requires its network password.",
          "Enter the C64 Ultimate network password.",
        ],
        [
          "TCP refused while ping works",
          "The C64 Ultimate TCP stack may be wedged.",
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

const renderPdf = async ({ markdownFile, pdfFile, manualDir, title, subtitle }) => {
  const markdown = await readText(markdownFile);
  const printableMarkdown = markdown.replace(/\n## Table of Contents\n[\s\S]*?(?=\n## )/, "\n");
  const toc = buildToc(markdown);
  marked.setOptions({ gfm: true });
  const body = await inlineImageSources(addHeadingIds(await marked.parse(printableMarkdown), toc), manualDir);
  const tocHtml = `
    <nav class="toc">
      <h2>Table of Contents</h2>
      <ol>${toc
        .map((entry) => `<li class="depth-${entry.depth}"><a href="#${entry.id}">${entry.title}</a></li>`)
        .join("")}</ol>
    </nav>`;
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>${pdfCss}</style>
      </head>
      <body>
        <section class="cover">
          <h1>${title}</h1>
          <p>${subtitle}</p>
        </section>
        ${tocHtml}
        <main>${body}</main>
      </body>
    </html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: pdfFile,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font: 8px sans-serif; color: #777; width: 100%; padding: 0 15mm; text-align: right;">${title} · <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
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
      subtitle: "Connect, control, play, mount, and diagnose a Commodore 64 Ultimate.",
    });
  }
  return contexts.sort((a, b) => a.variant.id.localeCompare(b.variant.id));
};

export const buildManuals = async () => {
  const contexts = await buildManualContexts();
  const outputs = [];

  for (const context of contexts) {
    await mkdir(context.manualDir, { recursive: true });
    await writeFile(context.markdownFile, renderManualMarkdown(context), "utf8");
    await renderPdf(context);
    await writeFile(path.join(context.manualDir, ".last-build"), `Generated ${new Date().toISOString()}\n`, "utf8");
    outputs.push({
      markdown: path.relative(rootDir, context.markdownFile),
      pdf: path.relative(rootDir, context.pdfFile),
    });
  }

  return outputs;
};

const main = async () => {
  const outputs = await buildManuals();
  outputs.forEach((output) => {
    console.log(`Generated ${output.markdown}`);
    console.log(`Generated ${output.pdf}`);
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
