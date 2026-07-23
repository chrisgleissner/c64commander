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

// One accent hue per top-level chapter. Shown in the running header, the chapter
// heading, and that chapter's Table of Contents entries, so the colour tells you
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
// accent colour of its chapter (as a CSS variable), so headings, running headers,
// and the ToC share one colour and numbering system. The number is baked into the
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

// Print CSS built on the CSS Paged Media model (rendered by the vendored Paged.js
// polyfill, since headless Chromium alone supports neither running headers nor
// Table-of-Contents page numbers). Named strings carry the current chapter into
// the page header; target-counter fills the ToC page numbers; a per-page CSS
// variable (--accent, set by a Paged.js handler) colours the header.
const pdfCss = `
  @page {
    size: A4;
    margin: 24mm 16mm 18mm;
    @top-left {
      content: string(chapter);
      font: 600 8.5pt "Inter", "Segoe UI", Arial, sans-serif;
      color: var(--accent, #6b6257);
      border-bottom: 0.75pt solid var(--accent, #ded8ce);
      padding-bottom: 2mm;
      width: 100%;
      vertical-align: bottom;
    }
    @bottom-left { content: string(doctitle); font: 8pt "Inter", sans-serif; color: #9a9084; }
    @bottom-right { content: counter(page); font: 8pt "Inter", sans-serif; color: #6b6257; }
  }
  @page cover {
    margin: 0;
    @top-left { content: none; border: 0; }
    @bottom-left { content: none; }
    @bottom-right { content: none; }
  }
  @page toc {
    @top-left { content: "Table of Contents"; color: #6b6257; border-bottom: 0.75pt solid #ded8ce; }
  }

  * { box-sizing: border-box; }
  body {
    color: #1c1b18;
    font: 10.5pt/1.52 "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    margin: 0;
  }

  .cover {
    page: cover;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100vh;
    text-align: center;
    padding: 0 22mm;
  }
  .cover .eyebrow {
    color: #8a8177;
    font-size: 10pt;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    margin: 0 0 6mm;
  }
  .cover h1 { border: 0; font-size: 40pt; margin: 0 0 6mm; color: #15130f; string-set: doctitle content(text); }
  .cover p { color: #555047; font-size: 14pt; margin: 0; max-width: 130mm; }
  .cover .rule { width: 42mm; height: 3pt; border-radius: 2pt; background: #2a6f97; margin: 9mm 0 0; }
  .cover img { border: 1px solid #d8d0c5; border-radius: 8px; margin: 12mm 0 0; max-height: 95mm; max-width: 78mm; }

  .toc { page: toc; break-after: page; }
  .toc h2 { border: 0; margin: 0 0 7mm; font-size: 24pt; color: #15130f; }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc li { margin: 0; break-inside: avoid; }
  .toc a { display: flex; align-items: baseline; color: #1c1b18; text-decoration: none; }
  .toc a .tnum { color: var(--accent, #245f9e); font-weight: 700; margin-right: 3mm; flex: 0 0 auto; }
  .toc a .ttl { flex: 0 0 auto; }
  .toc a .leaderdots { flex: 1 1 auto; margin: 0 2mm; border-bottom: 0.75pt dotted #cabfae; transform: translateY(-1mm); }
  .toc a::after {
    content: target-counter(attr(href), page);
    color: #8a8177;
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .toc .depth-2 {
    font-weight: 700;
    font-size: 12.5pt;
    margin-top: 5mm;
    border-left: 3pt solid var(--accent, #245f9e);
    padding-left: 3mm;
  }
  .toc .depth-2 a { color: var(--accent, #15130f); }
  .toc .depth-3 { font-size: 10pt; margin: 0.6mm 0 0.6mm 14mm; }
  .toc .depth-3 a .tnum { font-weight: 600; }

  main h1 { display: none; }
  h2, h3, h4 { line-height: 1.18; break-after: avoid; }
  .secnum { font-weight: 700; font-variant-numeric: tabular-nums; }
  main h2 {
    break-before: page;
    string-set: chapter content(text);
    color: var(--accent, #15130f);
    border-bottom: 2pt solid var(--accent, #ded8ce);
    font-size: 19pt;
    margin: 0 0 5mm;
    padding-bottom: 2mm;
  }
  main h2 .secnum { opacity: 0.6; margin-right: 1mm; }
  main h3 { font-size: 13.5pt; margin: 7mm 0 2mm; color: #15130f; }
  main h3 .secnum { color: var(--accent, #245f9e); margin-right: 1mm; }
  main h4 { font-size: 11.5pt; margin: 5mm 0 1.5mm; color: #2a2620; }
  main h4 .secnum { color: var(--accent, #245f9e); margin-right: 1mm; }
  p, ul, ol, table { margin: 0 0 3.5mm; }
  li { margin: 1.2mm 0; }
  a { color: #245f9e; text-decoration: none; }
  strong { color: #15130f; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  tr { break-inside: avoid; }
  th, td { border: 0.75pt solid #ded8ce; padding: 4px 7px; vertical-align: top; text-align: left; }
  th { background: #f4f0e8; font-weight: 700; }
  img {
    border: 1px solid #d8d0c5;
    border-radius: 6px;
    display: block;
    margin: 4mm auto 6mm;
    max-height: 128mm;
    max-width: 86mm;
    object-fit: contain;
  }
  code {
    background: #f4f0e8;
    border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.9em;
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

// The device that runs the app. C64U Remote is an Android-only variant built for
// the Commodore Callback 8020 — a compact, keypad-first phone — so its manual
// always speaks of a "phone" (the Callback 8020 name is established once, in
// Before You Start, then left implicit). The broad C64 Commander edition also
// runs on tablets, so it keeps the wider "phone or tablet" phrasing unchanged.
const appDeviceName = (variant) => (isC64uRemoteVariant(variant) ? "phone" : "phone or tablet");

// Subject noun for the app-host device, e.g. "on your phone" vs "on the Android
// device". Kept phone-specific for C64U Remote and byte-identical for the broad
// edition.
const appDeviceSubject = (variant) => (isC64uRemoteVariant(variant) ? "your phone" : "the Android device");

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
    ? [
        "### Your C64 Ultimate",
        "",
        `${appName} is made for controlling a Commodore 64 Ultimate on your local network. It runs on the Commodore Callback 8020 — the compact, keypad-first phone it was designed for — which this guide simply calls your phone.`,
      ]
    : [
        "### Supported Machines",
        "",
        `${appName} is the broad edition. It works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II+(L).`,
        "",
        "The app may call the device-file source **C64U** in lists and pickers. In that place, read it as storage on the connected Ultimate-family device, reached through FTP.",
      ];

// Balanced becomes safe once the firmware carries the network-stability fixes.
// On a Commodore 64 Ultimate that is firmware 1.2.0 or newer (the 1.x line);
// 3.14e does NOT carry them. The broad edition also covers the Ultimate 64
// family, whose fixes arrive in 3.15.
const balancedFirmwareNote = (variant) =>
  isC64uRemoteVariant(variant)
    ? "A Commodore 64 Ultimate on firmware 1.2.0 or newer."
    : "A Commodore 64 Ultimate on firmware 1.2.0 or newer, or an Ultimate 64-family device on 3.15 or newer.";

const deviceSafetyGuidance = (variant) =>
  isC64uRemoteVariant(variant)
    ? "Leave it on Auto (recommended); Auto keeps a Commodore 64 Ultimate on Conservative until its firmware is known safe. See Device Safety Modes."
    : "Leave it on Auto (recommended); Auto uses Conservative for a Commodore 64 Ultimate, and Balanced for an Ultimate 64-family device on firmware newer than 3.15. See Device Safety Modes.";

const safeDeviceUseIntro = ({ appName, variant }) =>
  `${appName} uses normal REST, FTP, and Telnet requests, but ${targetDeviceShortName(
    variant,
  )} firmware can still become unresponsive under some network conditions. The app reduces risk by pacing traffic and surfacing errors.`;

const safeDeviceUseHabits = (variant) =>
  isC64uRemoteVariant(variant)
    ? [
        "- avoid repeating the same command while the device is already busy;",
        "- leave Device Safety on Auto, and only raise concurrency once the device and network have proved steady;",
        "- drop to Conservative for a first setup, Wi-Fi, or firmware you do not yet trust;",
        "- power-cycle the Commodore 64 Ultimate if all TCP services stop responding while ping still works.",
      ]
    : [
        "- avoid repeating the same command while the device is already busy;",
        "- leave Device Safety on Auto, and only raise concurrency once the device and network have proved steady;",
        "- drop to Conservative for older or unknown firmware, Wi-Fi, or a first setup;",
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

  if (includeFeature(features, "disk_explorer_enabled")) {
    rows.push([
      "Disk Explorer (launch a program inside a disk)",
      "**Disks > disk menu > Open (Disk Explorer)**",
      featureAvailability(features.disk_explorer_enabled),
    ]);
  }
  if (includeFeature(features, "new_disk_enabled")) {
    rows.push(["Create a blank disk", "**Disks > New disk**", featureAvailability(features.new_disk_enabled)]);
  }
  if (includeFeature(features, "in_image_search_enabled")) {
    rows.push([
      "Search inside disk images",
      "**Settings > Play and disk behavior**",
      featureAvailability(features.in_image_search_enabled),
    ]);
  }
  if (includeFeature(features, "launch_safety_enabled")) {
    rows.push([
      "Launch Safety (cartridge parking)",
      "Automatic; boot-menu answer in **Settings > Play and disk behavior**",
      featureAvailability(features.launch_safety_enabled),
    ]);
  }
  if (includeFeature(features, "audio_mirror_enabled")) {
    rows.push([
      "Live View — Audio Mirror",
      "**Settings > Experimental Features**",
      featureAvailability(features.audio_mirror_enabled),
    ]);
  }
  if (includeFeature(features, "video_mirror_enabled")) {
    rows.push([
      "Live View — Video Mirror",
      "**Settings > Experimental Features**",
      featureAvailability(features.video_mirror_enabled),
    ]);
  }

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
    ["Local", "Play, Disks", `Files and folders available to ${appDeviceSubject(variant)} running the app.`],
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
    `${featureAvailability(features.keypad_input_enabled)} Directional navigation works with D-pad keys, arrow keys, and compatible hardware keyboards.`,
    "",
    "#### Directional Pad",
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
    "#### Number Keys",
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
          "Open Device Switcher",
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
    "#### Quick Menu",
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
    ...renderMarkdownToc(markdownToc),
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
    `Connection has three parts: ${
      isC64uRemoteVariant(variant) ? "your phone" : "the app device"
    }, ${targetDeviceShortName(variant)}, and the local network between them.`,
    "",
    `Put ${
      isC64uRemoteVariant(variant) ? "your phone" : "the device running the app"
    } and ${targetDeviceShortName(variant)} on the same Wi-Fi or wired LAN. Then open **Network Services & Timezone** on the target device.`,
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
    `Connection and saved devices live here, along with Appearance (display profile, theme, full-screen, and screen orientation), Notifications, Diagnostics options, Device Safety and network timing, Play and Disk behavior, the HVSC and Online Archive sources, feature toggles, Settings transfer, and an About panel. **Settings transfer** exports every app preference to a file you can import onto another ${appDeviceName(
      variant,
    )}, so a second device starts up already configured.`,
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
    `Preferred path: Play. Use C64U source for files already on the target device; use Local for files on ${appDeviceSubject(
      variant,
    )}.`,
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
          `Remote Input turns your ${appDeviceName(
            variant,
          )} into a second-screen controller for the C64. It is handy when you are sitting across the room from the machine, when no joystick is plugged in, or when you just want to type a command without reaching for the real keyboard.`,
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
          "- resize the controls from M up to XXL with the **Size** stepper (L by default);",
          "- turn on **Autofire** and set its rate from 1 to 10 presses per second (the default is 5, and you can also set it in Settings).",
          "",
          "A companion quick-keys bar beside the joystick keeps the keys you reach for mid-game one tap away — RUN/STOP, SPACE, RETURN, the function keys f1 to f8, the cursor keys, and the CTRL, C=, and SHIFT modifiers — so you can nudge a menu or answer a prompt without leaving the joystick. For distraction-free play, tap **Game mode**: the app hides every other control and anchors the stick and FIRE button to the edges of the screen for no-look thumbs. Leave it with **Exit game mode** or your device's Back button. Both release everything you were holding.",
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
          `A RAM snapshot is a copy of what is in your C64's memory right now, saved onto your ${appDeviceName(
            variant,
          )} so you can put it back later. It is the nearest thing the app has to a save-and-restore button for programs that have none of their own.`,
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
          `Snapshots are kept on your ${appDeviceName(
            variant,
          )}, not on the C64. Each one is named automatically from its type and the date and time, and if something is playing its title becomes the label. You can add or change a **Comment** on any snapshot later. The app keeps up to 100 snapshots and quietly drops the oldest once that fills.`,
          "",
          "**Load RAM** opens your snapshot library. Filter it by name or by type, then tap a snapshot to restore it. The app asks you to confirm first, because restoring overwrites the matching memory on the C64. It writes back only the bytes the snapshot holds, and it deliberately leaves the CIA timers alone so the cursor keeps its normal blink. A CPU snapshot resumes the program; if that is not possible the app restores the memory alone and tells you so. From the same library you can edit a snapshot's comment or remove ones you no longer need with the trash icon.",
          "",
          featureAvailability(features.ram_snapshots_enabled),
          "",
        ]
      : []),
    "### Drives and Disk Images",
    "",
    `${appName} gives your C64 up to two disk drives, and the **Disks** page drives both. Each drive card is a small control panel of its own.`,
    "",
    "Turn a drive on or off with its power control — a drive must be **on** before it can mount anything. Give it a **bus ID** (8, 9, 10, or 11) so software can find it; the first drive is usually 8. Set its **type** to match the image you are loading — a 1541 for D64 and G64 disks, a 1571 for D71, or a 1581 for D81 — and use **Reset** to restart just the drive's own processor, the gentlest way to recover a confused drive without disturbing the C64.",
    "",
    `Mounting is the heart of the page. Choose a disk from your collection, choose the drive, and mount it; **Eject** empties the drive again. A disk that already lives on ${targetDeviceShortName(
      variant,
    )} mounts in place, while a **Local** or archive disk is copied across first — and anything a program writes back to it is saved to your original when you eject, so high scores and saved games survive.`,
    "",
    "For a title that spans several disks, drop the related images into one **group**. Grouped disks add **rotate** controls to the drive card, so when a program asks for the next disk you can swap without hunting through the collection. A drive can also read loose files straight from a folder on the device through its **Soft IEC** path, which suits large collections that are not packed into disk images.",
    "",
    ...(includeFeature(features, "disk_explorer_enabled") ||
    includeFeature(features, "launch_safety_enabled") ||
    includeFeature(features, "in_image_search_enabled") ||
    includeFeature(features, "new_disk_enabled") ||
    includeFeature(features, "audio_mirror_enabled") ||
    includeFeature(features, "video_mirror_enabled")
      ? [
          "### Content Explorer",
          "",
          "Content Explorer is a set of additive tools for working with the programs *inside* disk images, launching them safely, and hearing and seeing the running machine. Each part is optional and independent — turn on only the ones you want in **Settings**, and the rest stay out of the way.",
          "",
          ...(includeFeature(features, "disk_explorer_enabled")
            ? [
                "#### Looking Inside a Disk",
                "",
                "Mounting a disk image gives you the whole disk. Disk Explorer instead looks *inside* one so you can pick a single program to launch. On **Disks**, open a disk image's menu and choose **Open (Disk Explorer)…**; the app lists every file on the disk, each with its type, its size in blocks, and — for a program — its load address.",
                "",
                "Each launchable file offers three actions:",
                "",
                "- **Run** loads the program into the C64's memory and starts it.",
                "- **Load** loads it into memory without starting it — handy for monitors and development.",
                "- **Mount & Load** mounts the whole disk, resets the machine, waits for BASIC, then types the LOAD and RUN for you — the right choice for titles that load in several stages.",
                "",
                'Only a proper **PRG** program can be launched directly. Other file types show a short note explaining why they cannot, and an unclosed "splat" file — one that was never finished being written — cannot be launched either.',
                "",
                featureAvailability(features.disk_explorer_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "launch_safety_enabled")
            ? [
                "#### Launch Safety",
                "",
                "Some setups have a freezer cartridge (Action Replay / Retro Replay style) configured. On those, launching a program directly can occasionally reset into the cartridge's own menu instead — which looks exactly like the app misbehaving. Launch Safety prevents that: around every direct launch it briefly *parks* the configured cartridge, then restores it afterwards. It never writes to the device's saved (flash) settings, so a power cycle always brings the cartridge back, and when no cartridge is configured it does nothing at all. This happens automatically; there is no per-launch control.",
                "",
                "One advanced option sits in **Settings**, under Play and disk behaviour: **Answer cartridge boot menu after reset**. It is off by default and helps only one narrow case — a cartridge that shows a boot menu when the machine resets, which could otherwise swallow the LOAD that Mount & Load types. Turn it on to choose the **menu key** (F1–F8, RETURN, or SPACE) and a **boot settle** time; the app then presses that key after a Mount & Load reset to clear the menu first. Leave it off unless you run such a cartridge.",
                "",
                featureAvailability(features.launch_safety_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "in_image_search_enabled")
            ? [
                "#### Searching Inside Disk Images",
                "",
                "By default, searching your media matches disk images by their file name. Turn on **Search inside disk images** — in **Settings**, under Play and disk behaviour — and search also reaches the programs *inside* your `.d64`, `.d71`, and `.d81` images. A match found inside a disk is shown as **DISK → PROGRAM**, so you can see exactly which disk holds the program you want, then Run or Load it just like any other.",
                "",
                featureAvailability(features.in_image_search_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "new_disk_enabled")
            ? [
                "#### Creating a Blank Disk",
                "",
                "Need a fresh disk to save to? On **Disks**, choose **New disk** to format a blank image on the device. Pick the **type** — D64 (1541), D71 (1571), D81 (1581), or DNP (CMD native) — give it a **file name**, and set a **disk label** of up to 16 characters (it defaults to the file name). A D64 lets you choose the number of **tracks** (35 to 41, usually 35); a DNP requires a track count (1 to 255); D71 and D81 need none. Finally pick a real **storage folder** on the device, such as USB0 — the top-level `/` is only a virtual list of drives and cannot hold files. The app creates the image and mounts it ready to write to.",
                "",
                featureAvailability(features.new_disk_enabled),
                "",
              ]
            : []),
          ...(includeFeature(features, "audio_mirror_enabled") || includeFeature(features, "video_mirror_enabled")
            ? [
                "#### Live View — Hearing and Seeing the Running Machine",
                "",
                "Your Ultimate can send the sound and picture of the running C64 out across the network, and Live View brings them back inside the app — so you can hear a tune or watch the screen without wiring up a speaker or a second display.",
                "",
                "Live View is one shared session. Start it in one place and it keeps running everywhere you go; there is never a second, competing stream. It sits just beneath the Quick Actions on **Home**, with two toggles:",
                "",
                ...(includeFeature(features, "audio_mirror_enabled")
                  ? [
                      "- **Listen** turns the sound on. It takes up no room — just the lit button and a small live dot — so it is ideal for keeping an ear on a game or a SID tune while you do something else. A matching dot appears in the top bar once you move to another page, as a reminder that it is still playing; tap it to stop everything at once.",
                    ]
                  : []),
                ...(includeFeature(features, "video_mirror_enabled")
                  ? [
                      "- **Watch** turns the picture on. A small preview of the C64 screen appears beneath the toggles; tap the chevron beside it to enlarge the preview in place.",
                    ]
                  : []),
                "",
                image("Live View on Home", profile, "home/content-explorer/01-live-view.png"),
                "",
                ...(includeFeature(features, "video_mirror_enabled")
                  ? [
                      "**The immersive screen.** Open **Remote Input** while Watch is on and the picture grows to fill the width of the sheet, above the joystick and keyboard — a proper screen for playing a game or driving an app you are typing into.",
                      "",
                      "You can move around it freely: **pinch** to zoom, **drag** to pan, and **double-tap** to zoom straight to a point (double-tap again to fit the whole screen back on). A small map in the corner shows which part you are looking at; drag its rectangle to leap somewhere else. Turn on **Follow** and the view drifts on its own toward wherever the action is — handy for keeping the cursor in sight as you type.",
                      "",
                      "On a device driven by a physical keypad, those same keys could either work the C64 or move the view, so Live View makes the difference impossible to mistake. A coloured border and label tell you which at a glance: a **blue “Driving C64”** border means your keys reach the machine, and an **amber “Adjusting view”** border means they zoom and pan the picture instead. Tap **Adjust** — or press the menu key — to switch between them; it returns to Driving on its own after a short pause, so you are never left steering a frozen game.",
                      "",
                      image("The immersive screen in Remote Input", profile, "home/remote-input/06-av-mirror-immersive.png"),
                      "",
                    ]
                  : []),
                "Live View is optional and starts switched off. The device streams to two network ports (11000 for video, 11001 for audio); if your setup needs different ones, change them in **Settings**, under Play and disk behaviour.",
                "",
                featureAvailability(features.video_mirror_enabled ?? features.audio_mirror_enabled),
                "",
              ]
            : []),
        ]
      : []),
    "### The SID Audio Mixer",
    "",
    "The C64's sound comes from its SID chip, and the Ultimate can host more than one. **Home > SID / Audio mixer** is a live mixing desk: a **master volume** for everything, and, for each SID the device reports, that chip's own **volume** and **stereo position**. Slide one SID toward the left speaker and another toward the right for true stereo, or pull one down to let the other lead. Changes are heard at once, and the same controls appear in **Config > Audio Mixer** if you prefer the full tree.",
    "",
    "### Video, Audio, and Debug Streams",
    "",
    "The Ultimate can send what your C64 is doing out across the network. **Home > Streams** exposes three feeds — **VIC** (the live video picture), **Audio** (the SID output), and **Debug** (a low-level trace for developers). Point a feed at a destination address, press **Start**, and the device streams it there; **Stop** ends it. The Streams card appears only when the connected device advertises streaming support.",
    "",
    "### The Virtual Printer",
    "",
    "A C64 once talked to a Commodore printer over the serial bus; the Ultimate emulates one so you never need the vintage hardware. **Home > Printer** picks the **emulation** (such as Commodore MPS), sets the printer's **bus ID**, and manages its output: **Flush** commits what has been printed so far, **Eject** finishes the page, and **Reset** clears the emulated printer.",
    "",
    "### File Sources",
    "",
    "Everything you play or mount comes from a **source**, and each source keeps to its own picker so a wrong turn never lands you somewhere unexpected.",
    "",
    `- **Local** — files and folders on the ${appDeviceName(variant)} running the app.`,
    `- **C64U** — files on ${targetDeviceShortName(variant)}, reached over FTP.`,
    ...(includeFeature(features, "hvsc_enabled")
      ? [
          "- **HVSC** — the High Voltage SID Collection, the definitive archive of C64 music. Prepare it once from **Settings > HVSC**; afterwards the app checks for updates on its own, and browsing shows song durations and subsongs.",
        ]
      : []),
    ...(includeFeature(features, "commoserve_enabled")
      ? [
          "- **CommoServe** — an online archive you search by name, pulling disks and programs straight into a playlist or disk collection. Set its address in **Settings > Online Archive**.",
        ]
      : []),
    "",
    "### Configuration and Saving",
    "",
    "Two ideas make the configuration tree easy to live with: where a change goes, and how to keep it.",
    "",
    "Every change — on Home, on Disks, or in Config — is sent to the running device at once and takes effect immediately. But the device holds two copies of its settings: the **live** ones it is using now, and a **flash** copy it reloads at power-on. A change is live instantly; it survives a reboot or power cycle only once it reaches flash.",
    "",
    `You manage that from **Home > Config actions**. **Save to flash** writes the current live settings to flash now — reach for it when **Auto save config** is Ask or No. The app can also keep named **configuration snapshots** on the ${appDeviceName(
      variant,
    )}, separate from the device's flash: save the current setup, then load it back later to restore a whole configuration at once.`,
    "",
    "### Reading Diagnostics",
    "",
    "Diagnostics is your window into the health of the connection and everything the app has recently done. It slides up from the bottom of the screen. Reach it by tapping the header badge, pressing `*`, choosing **Diagnostics** in Settings, or tapping any error notification.",
    "",
    "The panel has three parts, from top to bottom:",
    "",
    "- The **health header** shows the current state (Healthy, Degraded, Unhealthy, or Offline), which device it refers to, and when it was last checked. Tap **Run health check** to test the connection now. The check probes REST, FTP, and Telnet, plus three C64-specific signals (CONFIG, RASTER, and JIFFY), and reports each result with its timing and the overall latency. Expand the header to see every probe in detail.",
    "",
    "The CONFIG probe does more than read: it nudges a live setting by a hair, reads it back to confirm the device really applied the change, then restores the original value. On a device with an LED strip — the case light or the keyboard LEDs — you will see the lights **pulse once** as it runs, a tiny visible heartbeat that tells you the connection is alive at a glance.",
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
    "**Device Safety** in Settings governs how hard the app pushes the device. Its five modes trade speed for caution by capping how many requests run at once and pacing them, and they also tune caching, cooldowns, and backoff. **Auto** is recommended: it picks the right mode from the connected device and its firmware. The full list is in [Device Safety Modes](#device-safety-modes).",
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
    "## Appendices",
    "",
    "The rest of this guide is reference material for when you want the exact answer. Skim the tour to get going, then come back here for the specifics.",
    "",
    "### Feature Reference",
    "",
    "Preferred locations are marked first.",
    "",
    table(["Feature", "Where to find it", "Notes"], featureRows({ features, variant })),
    "",
    renderKeyboardReference({ features, variant }),
    "",
    "### File and Source Reference",
    "",
    table(["Source", "Used in", "Meaning"], sourceRows({ features, variant })),
    "",
    "Supported playback/import types include SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81. Disk collection workflows focus on disk images: D64, G64, D71, G71, and D81.",
    "",
    table(
      ["Format", "Kind", "Notes"],
      [
        ["SID", "Music", "One or more subsongs; durations shown when songlength data is available."],
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
    "These are the defaults the app expects. Change them per device in **Settings > Connection** if yours differ.",
    "",
    table(
      ["Service", "Default port", "Used for"],
      [
        ["Web Remote Control (REST)", "80", "Control, status, and configuration — required."],
        ["FTP File Service", "21", "Browsing and transferring files, playlists, and disks."],
        ["Telnet Remote Menu", "23", "Advanced menu-backed actions, when those are enabled."],
      ],
    ),
    "",
    "### Device Safety Modes",
    "",
    "Set the mode in **Settings > Device Safety**. Higher concurrency is faster but pushes the device harder; the presets also tune caching, cooldowns, and backoff.",
    "",
    table(
      ["Mode", "Requests at once", "Use it when"],
      [
        ["Auto", "Chosen for you", "Always a safe default — picks Conservative or Balanced from the device and its firmware. Recommended."],
        ["Relaxed", "Up to 3", "The device and network are proven fast and stable, and you accept higher risk."],
        ["Balanced", "Up to 2", balancedFirmwareNote(variant)],
        ["Conservative", "1 (serialized)", "A first setup, Wi-Fi, or firmware you do not yet trust. Maximum safety."],
        ["Troubleshooting", "1 (serialized)", "You are chasing a problem and want extra debug logging."],
      ],
    ),
    "",
    "### Drive Types and Disk Formats",
    "",
    "Set a drive's type on the **Disks** page to match the image you are mounting.",
    "",
    table(
      ["Drive type", "Disk images", "Description"],
      [
        ["1541", "D64, G64", "The classic single-sided 5.25-inch drive."],
        ["1571", "D71, G71", "Double-sided 5.25-inch drive."],
        ["1581", "D81", "High-capacity 3.5-inch drive."],
      ],
    ),
    "",
    "### Snapshot Types and Memory Ranges",
    "",
    `**Save RAM** offers these capture types. The app keeps up to 100 snapshots on your ${appDeviceName(
      variant,
    )} and drops the oldest once that fills.`,
    "",
    table(
      ["Snapshot", "Captures", "Memory range"],
      [
        [
          "CPU + RAM",
          "Full memory plus the CPU registers; can resume where it left off (when the device supports it).",
          "$0000–$FFFF + registers",
        ],
        ["Program", "Almost all of memory, skipping the stack. A good all-round choice.", "$0000–$00FF, $0200–$FFFF"],
        ["Basic", "The BASIC program and its variables.", "$002B–$0038, $0801–$9FFF"],
        ["Screen", "The current screen and its colours.", "VIC bank, $D000–$D02E, $D800–$DBFF, $DD00–$DD01"],
        ["Custom", "Exactly the address ranges you type.", "User-defined"],
      ],
    ),
    "",
    "### Health Check Probes",
    "",
    "Run a health check from **Diagnostics** to test the connection. Each probe reports its own result and timing.",
    "",
    table(
      ["Probe", "What it checks"],
      [
        ["REST", "The Web Remote Control service answers."],
        ["FTP", "The FTP file service answers."],
        ["Telnet", "The Telnet menu service answers."],
        ["CONFIG", "Writes a live setting, reads it back, and restores it — proving the device applies changes. A device with an LED strip pulses once as it runs."],
        ["RASTER", "The VIC-II raster line is available — the video chip is running."],
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

const pagedPolyfillPath = path.join(scriptDir, "vendor/pagedjs/paged.polyfill.min.js");

const renderPdf = async ({ markdownFile, pdfFile, manualDir, title, subtitle }) => {
  const markdown = await readText(markdownFile);
  // Everything before the first real chapter is the title block (title, subtitle,
  // launch image) and the in-app contents list. The PDF replaces both with a cover
  // and a page-numbered Table of Contents, so drop them from the flowing body.
  const firstSectionIdx = markdown.search(/\n## (?!Table of Contents)/);
  const preamble = firstSectionIdx >= 0 ? markdown.slice(0, firstSectionIdx) : "";
  const bodyMarkdown = firstSectionIdx >= 0 ? markdown.slice(firstSectionIdx) : markdown;
  const toc = buildToc(markdown);
  marked.setOptions({ gfm: true });
  const body = await inlineImageSources(addHeadingIds(await marked.parse(bodyMarkdown), toc), manualDir);

  const productName = title.replace(/\s+Manual$/, "");
  const launchMatch = /!\[([^\]]*)]\(([^)]+)\)/.exec(preamble);
  const coverImage = launchMatch
    ? `<img alt="${launchMatch[1]}" src="${await dataUriForImage(launchMatch[2], manualDir)}">`
    : "";
  const coverHtml = `
    <section class="cover">
      <p class="eyebrow">User Manual</p>
      <h1>${productName}</h1>
      <p>${subtitle}</p>
      <div class="rule"></div>
      ${coverImage}
    </section>`;

  const tocHtml = `
    <nav class="toc">
      <h2>Table of Contents</h2>
      <ol>${toc
        .filter((entry) => entry.depth === 2 || entry.depth === 3)
        .map(
          (entry) =>
            `<li class="depth-${entry.depth}" style="--accent:${chapterAccent(entry.chapter)}"><a href="#${
              entry.id
            }"><span class="tnum">${entry.number}</span><span class="ttl">${entry.title}</span><span class="leaderdots"></span></a></li>`,
        )
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
        ${coverHtml}
        ${tocHtml}
        <main>${body}</main>
      </body>
    </html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Paged.js paginates the DOM and renders CSS Paged Media features (running
    // headers, target-counter page numbers) that headless Chromium lacks. A
    // handler tints each page's running header with its chapter's accent colour.
    await page.evaluate(() => {
      window.PagedConfig = { auto: false };
    });
    await page.addScriptTag({ path: pagedPolyfillPath });
    await page.evaluate(async () => {
      const Paged = window.Paged;
      class ChapterAccentHandler extends Paged.Handler {
        constructor(chunker, polisher, caller) {
          super(chunker, polisher, caller);
          this.lastAccent = "";
        }
        afterPageLayout(pageElement) {
          const content = pageElement.querySelector(".pagedjs_page_content");
          const heading = content ? content.querySelector("[data-chapter]") : null;
          if (heading) {
            const accent = getComputedStyle(heading).getPropertyValue("--accent").trim();
            if (accent) this.lastAccent = accent;
          }
          if (this.lastAccent) pageElement.style.setProperty("--accent", this.lastAccent);
        }
      }
      Paged.registerHandlers(ChapterAccentHandler);
      await window.PagedPolyfill.preview();
    });
    await page.pdf({
      path: pdfFile,
      printBackground: true,
      preferCSSPageSize: true,
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
