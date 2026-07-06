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
  "In Depth",
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

const isC64uRemoteVariant = (variant) => variant.id === "c64u-remote";

const targetDeviceDescription = (variant) =>
  isC64uRemoteVariant(variant)
    ? "a Commodore 64 Ultimate"
    : "a Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, or Ultimate-II+(L)";

const targetDeviceShortName = (variant) =>
  isC64uRemoteVariant(variant) ? "the Commodore 64 Ultimate" : "the connected Ultimate-family device";

const targetDevicePasswordName = (variant) =>
  isC64uRemoteVariant(variant) ? "the Commodore 64 Ultimate network password" : "the target device network password";

const t9HostnameExamples = (variant) =>
  isC64uRemoteVariant(variant)
    ? "entries such as `c64u` and `192.168.1.64`"
    : "entries such as `c64u`, `u64`, `u2`, and `192.168.1.64`";

const supportedMachinesSection = ({ appName, variant }) =>
  isC64uRemoteVariant(variant)
    ? ["### Your C64 Ultimate", "", `${appName} is made for controlling a Commodore 64 Ultimate on your local network.`]
    : [
        "### Supported Machines",
        "",
        `${appName} is the broad edition. It works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II+(L).`,
        "",
        "The app may call the device-file source **C64U** in lists and pickers. In that place, read it as storage on the connected Ultimate-family device, reached through FTP.",
      ];

const deviceSafetyGuidance = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Use Conservative as the normal starting point for C64U Remote."
    : "Use Balanced for Ultimate 64-family devices when they run firmware newer than 3.15, where the relevant fixes are available from nightly builds. Otherwise use Conservative.";

const safeDeviceUseIntro = ({ appName, variant }) =>
  `${appName} uses normal REST, FTP, and Telnet requests, but ${targetDeviceShortName(
    variant,
  )} firmware can still become unresponsive under some network conditions. The app reduces risk by pacing traffic and surfacing errors.`;

const safeDeviceUseHabits = (variant) =>
  isC64uRemoteVariant(variant)
    ? [
        "- avoid repeating the same command while the device is already busy;",
        "- use Device Safety presets instead of raising concurrency aggressively;",
        "- keep Conservative selected until your Commodore 64 Ultimate and network have proved steady;",
        "- power-cycle the Commodore 64 Ultimate if all TCP services stop responding while ping still works.",
      ]
    : [
        "- avoid repeating the same command while the device is already busy;",
        "- use Device Safety presets instead of raising concurrency aggressively;",
        "- choose Balanced only for Ultimate 64-family firmware newer than 3.15;",
        "- choose Conservative for older firmware, unknown firmware, Wi-Fi, or a first setup;",
        "- power-cycle the target device if all TCP services stop responding while ping still works.",
      ];

const discoveryTargetDescription = (variant) =>
  isC64uRemoteVariant(variant) ? "a Commodore 64 Ultimate" : "supported devices";

const autoSaveConfigLocation = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Set it on the Commodore 64 Ultimate at **C= + RESTORE > User interface > Auto save config**; the same setting appears in Config as **User interface > Auto save config**."
    : "On a Commodore 64 Ultimate, set it at **C= + RESTORE > User interface > Auto save config**. C64 Commander mirrors that menu in Config as **User interface > Auto save config**. On other supported devices, search Config for **Auto Save Config** if the menu naming differs.";

const autoSaveConfigGuidance = (variant) =>
  `To make configuration changes save themselves, set **Auto save config** to **Yes**. ${autoSaveConfigLocation(
    variant,
  )}`;

const saveToFlashGuidance = (variant) =>
  `Use **Save to flash** when **Auto save config** is **Ask** or **No**, or when you want to force a flash save now. ${autoSaveConfigGuidance(
    variant,
  )}`;

// Remote Input's Joystick tab relays over the `machine:input` REST endpoint,
// which arrives in Commodore 64 Ultimate firmware 1.2.0 and (C64 Commander
// only) Ultimate 64-family firmware 3.15. On anything older, or on the
// Ultimate-II+(L) which has no such endpoint, the app falls back to Keys only.
const remoteInputKeyboardImage = (profile) =>
  profile === "compact"
    ? "home/remote-input/03-keyboard-compact.png"
    : "home/remote-input/04-keyboard-medium.png";

const remoteInputFallbackExplainer =
  "That fallback types by placing characters into the C64's KERNAL keyboard buffer. It is ideal for BASIC, where you can type commands, `LOAD`, and `RUN`, but most games read the keyboard and joystick hardware directly and will not respond to it. RUN/STOP and RESTORE are also unavailable in the fallback.";

const remoteInputJoystickFirmware = (variant) =>
  isC64uRemoteVariant(variant)
    ? `Full Joystick relay uses the device's \`machine:input\` REST endpoint. It needs a Commodore 64 Ultimate running firmware **1.2.0** or newer. On older firmware the app automatically falls back to **Keys** only. ${remoteInputFallbackExplainer} If the device is password-protected, enter its password in Settings first, because both Joystick and Keys need it.`
    : `Full Joystick relay uses the device's \`machine:input\` REST endpoint. It needs recent firmware: a Commodore 64 Ultimate on firmware **1.2.0** or newer, or an Ultimate 64, Ultimate 64 Elite, or Ultimate 64 Elite II on firmware **3.15** or newer. The Ultimate-II+(L) cannot relay a joystick at all: as a cartridge it cannot change the state of the C64's CIA 1 input chip, so it has no \`machine:input\` support. On the Ultimate-II+(L), and on any device running older firmware, the app automatically falls back to **Keys** only. ${remoteInputFallbackExplainer} If the device is password-protected, enter its password in Settings first, because both Joystick and Keys need it.`;

const remoteInputFirmwareShort = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Joystick needs a Commodore 64 Ultimate on firmware 1.2.0 or newer; otherwise only Keys are available."
    : "Joystick needs firmware 1.2.0 or newer on a Commodore 64 Ultimate, or 3.15 or newer on an Ultimate 64; otherwise only Keys are available.";

const remoteInputTroubleshootFirmware = (variant) =>
  isC64uRemoteVariant(variant)
    ? "- Confirm the Commodore 64 Ultimate is running firmware 1.2.0 or newer."
    : "- Confirm the firmware supports it: a Commodore 64 Ultimate on 1.2.0 or newer, or an Ultimate 64 on 3.15 or newer. The Ultimate-II+(L) has no joystick relay.";

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
  if (includeFeature(features, "remote_input_enabled")) {
    rows.push([
      "Remote Input",
      "**Home > Quick Actions**, Play (while an item plays)",
      `${featureAvailability(features.remote_input_enabled)} ${remoteInputFirmwareShort(variant)}`,
    ]);
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
      "Use Save to flash when Auto save config is Ask or No, or when you want to force a flash save now.",
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
    ["Device Safety", "**Settings > Device Safety**", deviceSafetyGuidance(variant)],
    ["Diagnostics", "**Header badge / `*`**, Settings > Diagnostics", "Badge is preferred for fast access."],
    ["Logs, traces, errors, health checks", "**Diagnostics**", "Use filters and Share for support."],
    ["Built-in help", "**Docs**", "Good for quick reminders inside the app."],
  );

  return rows;
};

const sourceRows = ({ features, variant }) => {
  const rows = [
    ["Local", "Play, Disks", "Files and folders available to the Android device running the app."],
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
      `For hostnames, this makes ${t9HostnameExamples(variant)} practical without a touchscreen.`,
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
  const subtitle = `Connect, control, play, mount, and diagnose ${targetDeviceDescription(variant)}.`;
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
    `${appName} controls ${targetDeviceDescription(variant)} from one app.`,
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
    ...supportedMachinesSection({ appName, variant }),
    "",
    `Connection has three parts: the app device, ${targetDeviceShortName(variant)}, and the local network between them.`,
    "",
    `Put the device running the app and ${targetDeviceShortName(variant)} on the same Wi-Fi or wired LAN. Then open **Network Services & Timezone** on the target device.`,
    "",
    docsImage("C64 Ultimate Network Services & Timezone menu", "setup/enable_services.png"),
    "",
    "Enable the services the app uses:",
    "",
    "- **Web Remote Control Service**: required for most control and status operations.",
    "- **FTP File Service**: needed for device file browsing, playlists, and disk collections.",
    "- **Telnet Remote Menu Service**: used for advanced menu-backed actions when those actions are enabled.",
    "",
    "Note the IP address under **Wired Network Setup** or **WI-FI Network Setup**. You may need it if local discovery cannot see the target device.",
    "",
    "## First Connection",
    "",
    `Start ${appName}. If no saved device is reachable, it scans the local network for ${discoveryTargetDescription(
      variant,
    )}.`,
    "",
    "If devices are found:",
    "",
    "1. Choose **Use** to connect now.",
    "2. Choose **Save** to keep the device for later.",
    "3. If the device is password-protected, enter its network password when asked.",
    "",
    `If no devices are found, ${appName} opens a manual setup prompt.`,
    "",
    isC64uRemoteVariant(variant)
      ? "Enter a hostname such as `c64u` or an IP address such as `192.168.1.64`, then choose **Connect**. If the Commodore 64 Ultimate answers but requires a password, the same dialog asks for it before saving and connecting."
      : "Enter a hostname such as `c64u`, `u64`, or `u2`, or an IP address such as `192.168.1.64`, then choose **Connect**. If the device answers but requires a password, the same dialog asks for it before saving and connecting.",
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
    `The lower cards cover drives, printer, SID mixer, streams, and configuration actions. **Save to flash** writes the current device settings to flash on ${targetDeviceShortName(
      variant,
    )} when you need an explicit save.`,
    "",
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "Quick Actions also holds **Remote Input**, a second-screen joystick and keyboard for the C64. It has its own walkthrough in [Remote Input](#remote-input), later in this guide.",
          "",
        ]
      : []),
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
    "A change is sent to the active device immediately. The firmware applies it at once.",
    "",
    saveToFlashGuidance(variant),
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
    "For a closer look, see [Reading Diagnostics](#reading-diagnostics) and [Sharing a Diagnostics Report](#sharing-a-diagnostics-report) in the In Depth chapter.",
    "",
    "### Device Switching",
    "",
    isC64uRemoteVariant(variant)
      ? "Device Switcher is for homes with more than one saved Commodore 64 Ultimate."
      : "Device Switcher is for homes with more than one saved Ultimate-family device.",
    "",
    image("Device switcher", profile, "diagnostics/switch-device/profiles/{profile}/01-picker.png"),
    "",
    "Open it from the badge long-press, `#`, or Quick Menu. Expand a row for more detail.",
    "",
    "See [Switching Between Devices](#switching-between-devices) in the In Depth chapter for the full story.",
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
    "Preferred path: Play. Use C64U source for files already on the target device; use Local for files on the Android device.",
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
    "4. Use **Save to flash** if **Auto save config** is **Ask** or **No** and the change should survive a device reboot or power cycle.",
    "",
    "Preferred path: Home for common settings; Config for the full tree.",
    "",
    "### Save Device Configuration",
    "",
    "Use this flow when **Auto save config** is **Ask** or **No**, or when you want to force a flash save now.",
    "",
    "1. Make the changes you need on Home or Config.",
    "2. Confirm the device is healthy.",
    "3. Open **Home > Config actions**.",
    "4. Choose **Save to flash**.",
    "",
    `Preferred path: set **Auto save config** to **Yes** when you want the firmware to save changes automatically. ${autoSaveConfigLocation(
      variant,
    )}`,
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
    "## In Depth",
    "",
    "The tour showed you where everything lives, and the flows above are quick recipes. A few features reward a closer look. This chapter takes its time with them.",
    "",
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "### Remote Input",
          "",
          "Remote Input turns your phone or tablet into a second-screen controller for the C64. It is handy when you are sitting across the room from the machine, when no joystick is plugged in, or when you just want to type a command without reaching for the real keyboard.",
          "",
          "Open it in either of two places:",
          "",
          "- From **Home**, tap the **Remote Input** tile in Quick Actions.",
          "- From **Play**, tap the **Remote Input** button that appears while an item is playing.",
          "",
          "Each place opens its own copy of the controller, so a key you are holding in one never leaks into the other.",
          "",
          image("Remote Input joystick mode", profile, "home/remote-input/01-joystick.png"),
          "",
          "At the top of the sheet you choose between two modes, **Joystick** and **Keys**.",
          "",
          "**Joystick** puts a stick and a large **FIRE** button on the screen. You can:",
          "",
          "- choose how the stick behaves with **Analog**, **D-Pad**, or **Swipe**;",
          "- send the signal to **Port 1** or **Port 2** with the port toggle (most games read Port 2);",
          "- resize the controls from S up to XXL with the **Size** stepper;",
          "- turn on **Autofire** and set its rate from 1 to 10 presses per second (the default is 5, and you can also set it in Settings).",
          "",
          "A quick-keys bar along the bottom keeps RUN/STOP, SPACE, RETURN, and the cursor keys one tap away, so you can nudge a menu without leaving the joystick. For distraction-free play, tap **Game mode**: the app hides every other control and anchors the stick and FIRE button to the edges of the screen for no-look thumbs. Leave it with **Exit game mode** or your device's Back button. Both release everything you were holding.",
          "",
          "**Keys** shows a full Commodore 64 keyboard, including the SHIFT, CTRL, and C= modifiers, SHIFT LOCK, the function keys f1 to f8, and RESTORE. Tap a modifier once to arm it for the next key, or hold it down to chord.",
          "",
          image("Remote Input keyboard mode", profile, remoteInputKeyboardImage(profile)),
          "",
          remoteInputJoystickFirmware(variant),
          "",
          "Remote Input is careful never to leave a key or direction stuck on the real C64. Everything you are holding is released automatically when you close the sheet, switch mode or port, switch to another device, or send the app to the background. If a message does not reach the device, the header shows **Reconnecting…** until the next one gets through. And at any moment you can tap **Release All** to let go of every key and button at once.",
          "",
          "To steer a game you have just launched:",
          "",
          "1. On **Play**, start the game, then tap **Remote Input**.",
          "2. Choose **Joystick** and set the port (most games use **Port 2**).",
          "3. Pick a movement style, then play with the stick and **FIRE**.",
          "4. Tap **Release All**, or close the sheet, when you finish.",
          "",
          featureAvailability(features.remote_input_enabled),
          "",
        ]
      : []),
    ...(includeFeature(features, "ram_snapshots_enabled")
      ? [
          "### RAM Snapshots",
          "",
          "A RAM snapshot is a copy of what is in your C64's memory right now, saved onto your phone or tablet so you can put it back later. It is the nearest thing the app has to a save-and-restore button for programs that have none of their own.",
          "",
          "Both actions live in **Home > Quick Actions**: **Save RAM** to capture, and **Load RAM** to restore. The device must be connected and not busy. The app pauses the machine for the transfer and resumes it afterwards, so a running program is not disturbed.",
          "",
          "When you tap **Save RAM**, the app asks which region of memory to capture:",
          "",
          "- **CPU + RAM Snapshot** (when the device supports it) freezes the running program and stores the full 64K of memory together with the processor's registers, so it can later resume exactly where it left off. It is best for BASIC and simple programs; fast-action games may not resume cleanly.",
          "- **Program Snapshot** stores almost all of memory (everything but the stack). A good all-round choice.",
          "- **Basic Snapshot** stores just the BASIC program and its variables.",
          "- **Screen Snapshot** stores the current screen and its colours.",
          "- **Custom Snapshot** lets you type the exact address ranges you want.",
          "",
          "Snapshots are kept on your phone or tablet, not on the C64. Each one is named automatically from its type and the date and time, and if something is playing its title becomes the label. You can add or change a **Comment** on any snapshot later. The app keeps up to 100 snapshots and quietly drops the oldest once that fills.",
          "",
          "**Load RAM** opens your snapshot library. Filter it by name or by type, then tap a snapshot to restore it. The app asks you to confirm first, because restoring overwrites the matching memory on the C64. It writes back only the bytes the snapshot holds, and it deliberately leaves the CIA timers alone so the cursor keeps its normal blink. A CPU snapshot resumes the program; if that is not possible the app restores the memory alone and tells you so. From the same library you can edit a snapshot's comment or remove ones you no longer need with the trash icon.",
          "",
          featureAvailability(features.ram_snapshots_enabled),
          "",
        ]
      : []),
    "### Reading Diagnostics",
    "",
    "Diagnostics is your window into the health of the connection and everything the app has recently done. It slides up from the bottom of the screen. Reach it by tapping the header badge, pressing `*`, choosing **Diagnostics** in Settings, or tapping any error notification.",
    "",
    "The panel has three parts, from top to bottom:",
    "",
    "- The **health header** shows the current state (Healthy, Degraded, Unhealthy, or Offline), which device it refers to, and when it was last checked. Tap **Run health check** to test the connection now. The check probes REST, FTP, and Telnet, plus three C64-specific signals (CONFIG, RASTER, and JIFFY), and reports each result with its timing and the overall latency. Expand the header to see every probe in detail.",
    "- The **Filters** bar narrows what you see below. Filter by device, by activity type (Problems, Actions, Logs, Traces), by contributor (App, REST, FTP, Telnet), or by severity (Errors, Warnings, Info). One-tap **Errors only** and **Problems only** shortcuts are there too.",
    "- The **Activity** list gathers problems, actions, logs, and traces together. Tap any row to expand it for the full details.",
    "",
    "The **⋯** menu in the corner collects extra views (Connection details, health history, latency, and the REST, FTP, and Config heat maps) alongside the Share and Clear actions. To send this information on for help, see the next section.",
    "",
    "### Sharing a Diagnostics Report",
    "",
    "When something goes wrong, the most useful evidence is usually the last handful of actions before the failure, so capture it before you clear anything or restart the app. The activity list is rebuilt fresh each time you open Diagnostics, and **Clear all** wipes it for good.",
    "",
    "To share a report about a recent error:",
    "",
    "1. Open **Diagnostics** (tap the header badge, press `*`, or tap the error notification).",
    "2. Tap **Run health check** so the report carries a fresh connection test.",
    "3. Use the **Errors only** or **Problems only** filter to confirm the failure is captured.",
    "4. Open the **⋯** menu and choose **Share all** to send everything, or **Share filtered** to send only the rows you filtered to.",
    "5. Pick an app in your device's share sheet (mail, chat, or notes) to send or save the report.",
    "",
    "The report is a small ZIP file holding the app's logs, traces, errors, and recent actions, along with a health snapshot and details about your app version, your device, and the active C64 (its name, host address, and firmware). It does not include your network password. It can, however, contain your device's hostname or IP address, so share it only with people you trust or with support.",
    "",
    "Use **Clear all** afterwards for a clean slate. It asks you to confirm, then shows **Diagnostics cleared** when done.",
    "",
    "### Switching Between Devices",
    "",
    `If you have saved more than one ${
      isC64uRemoteVariant(variant) ? "Commodore 64 Ultimate" : "device"
    }, the Device Switcher lets you hop between them without opening Settings.`,
    "",
    "Open it in any of three ways, whenever more than one device is saved:",
    "",
    "- **Long-press the header badge** (a short tap opens Diagnostics instead).",
    "- Press **`#`** on a hardware keyboard or keypad.",
    "- Choose **Switch device** in the Quick Menu.",
    "",
    "The switcher checks each saved device for you and refreshes every ten seconds while it is open. Each row shows the device's name, a status pill (**Selected**, **Verifying**, **Offline**, or **Mismatch**), a live health badge, and a short summary such as how many health probes passed or when the device was last seen. The device you are using is highlighted. Tap the chevron to expand a row and see every health probe in detail, which is handy for telling a sleeping device from one that is genuinely unreachable.",
    "",
    "Tap a device to switch to it. Before anything else the app safely lets go of any input you were holding on the old device, stops tracking its playback and pause state, retargets to the new device's address and ports, and then checks that the new device answers. While that happens the target shows a **Verifying** pill; once it responds, it becomes the active device.",
    "",
    "Saved devices themselves are created and edited in **Settings > Connection**, under **Saved devices**. There you can add a device, edit its **Device name**, **Hostname / IP**, and **HTTP**, **FTP**, and **Telnet** ports, set an optional **Network Password**, or delete one you no longer use. A device is saved only once it answers, so the list never fills with machines that are not really there. With a single device saved there is nothing to switch to, so the switcher stays out of your way.",
    "",
    "## Safe Device Use",
    "",
    safeDeviceUseIntro({ appName, variant }),
    "",
    "Good habits:",
    "",
    ...safeDeviceUseHabits(variant),
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
    ...(includeFeature(features, "remote_input_enabled")
      ? [
          "### Remote Input joystick is unavailable",
          "",
          "The **Joystick** tab appears only when the connected device supports the `machine:input` endpoint. **Keys** always works.",
          "",
          remoteInputTroubleshootFirmware(variant),
          "- If the device is password-protected, enter its password in Settings; both Joystick and Keys need it.",
          "- Otherwise the app stays in **Keys** mode and types through the C64 keyboard buffer, which suits BASIC but not most games.",
          "",
        ]
      : []),
    "### Device stops answering",
    "",
    `Open Diagnostics if possible and check recent REST/FTP/Telnet activity. If HTTP, FTP, and Telnet all refuse connections while ping still works, manually power-cycle ${targetDeviceShortName(variant)}.`,
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
    table(["Source", "Used in", "Meaning"], sourceRows({ features, variant })),
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
          `Enter ${targetDevicePasswordName(variant)}.`,
        ],
        [
          "TCP refused while ping works",
          `${isC64uRemoteVariant(variant) ? "The Commodore 64 Ultimate" : "The target device"} TCP stack may be wedged.`,
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
      subtitle: `Connect, control, play, mount, and diagnose ${targetDeviceDescription(variant)}.`,
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
