#!/usr/bin/env node
/*
 * Fails the build when the two reference documents drift away from the code they describe.
 *
 * Why this exists
 * ---------------
 * Both documents are read as statements of fact and neither has anything holding it to
 * the source:
 *
 * 1. `docs/architecture.md` opens with a stack summary. It named Vite 5 and Capacitor 6
 *    for two majors after the repository moved to Vite 6 and Capacitor 8, and the 6-to-8
 *    Capacitor migration changed plugin registration and the HTTP plugin behaviour this
 *    app depends on, so a maintainer planning against that line plans against the wrong
 *    API.
 * 2. `docs/cta-inventory.md` is the reference checklist for keypad-only devices, and
 *    `REVIEW.md` section 5 treats a control that is missing from it as unverified. New
 *    interactive controls were reaching `src/` without an inventory entry.
 *
 * The inventory half is a ratchet, not a clean gate. The controls that were already
 * undocumented when this check landed are listed in `UNDOCUMENTED_BASELINE`; the check
 * rejects a new one, and it also rejects a baseline entry that has since been documented,
 * so the list can only get shorter. Clearing an entry needs a real inventory entry, which
 * needs the keypad reachability marks, which need the device.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ARCHITECTURE_DOC = "docs/architecture.md";
const INVENTORY_DOC = "docs/cta-inventory.md";
const SOURCE_DIRS = ["src/pages", "src/components"];

/*
 * The stack line is checked at major-version granularity, which is the granularity a
 * maintainer plans against and the only part a caret range pins.
 */
export const STACK_ENTRIES = [
  { label: "React", pkg: "react" },
  { label: "React Router", pkg: "react-router-dom" },
  { label: "Vite", pkg: "vite" },
  { label: "Capacitor", pkg: "@capacitor/core" },
];

export const majorOf = (range) => {
  const match = /(\d+)\./.exec(String(range ?? ""));
  return match ? match[1] : null;
};

export const readInstalledMajors = (packageJson) => {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const majors = {};
  for (const { pkg } of STACK_ENTRIES) {
    majors[pkg] = majorOf(deps[pkg]);
  }
  return majors;
};

/* The line is matched by its label so a reordering or an added entry does not break it. */
export const findStackLine = (markdown) =>
  markdown.split("\n").find((line) => line.startsWith("- **UI/runtime**:")) ?? null;

export const findStackDrift = (stackLine, majors) => {
  const drift = [];
  if (stackLine === null) {
    return [{ label: "UI/runtime", reason: "the stack line is missing from the document" }];
  }
  for (const { label, pkg } of STACK_ENTRIES) {
    const expected = majors[pkg];
    if (expected === null || expected === undefined) {
      drift.push({ label, reason: `${pkg} is not a dependency, so the line cannot be checked` });
      continue;
    }
    /* `React` is a prefix of `React Router`, so the label must be followed by its number. */
    const stated = new RegExp(`\\b${label} (\\d+)`).exec(stackLine);
    if (stated === null) {
      drift.push({ label, reason: `the stack line does not state a ${label} version` });
    } else if (stated[1] !== expected) {
      drift.push({ label, reason: `the stack line says ${label} ${stated[1]}, package.json ships ${expected}` });
    }
  }
  return drift;
};

/*
 * A control is interactive when its tag is one of these, when it carries an interactive
 * ARIA role, or when it has an `onClick` and no role saying otherwise. That covers the
 * `div`/`span` wrappers the app uses as focusable rows and excludes the far larger number
 * of testids marking text, layout, chart geometry and live regions.
 */
export const INTERACTIVE_TAGS = new Set([
  "a",
  "AlertDialogAction",
  "AlertDialogCancel",
  "button",
  "Button",
  "Checkbox",
  "DropdownMenuItem",
  "FocusableDiskButton",
  "form",
  "input",
  "Input",
  "label",
  "motion.button",
  "RadioGroupItem",
  "select",
  "Select",
  "SelectTrigger",
  "Slider",
  "Switch",
  "TabsTrigger",
  "textarea",
  "Textarea",
  "Toggle",
  "ToggleGroupItem",
]);

/*
 * Reads the opening tag that starts at `start`, ignoring any `>` inside a JSX expression
 * so a prop such as `onClick={() => x > 1}` does not truncate the tag.
 */
export const readOpeningTag = (source, start) => {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
};

/*
 * An explicit role is taken at its word. `role="alert"` on a clickable wrapper is a live
 * region that happens to have a handler, not a CTA a keypad user has to be able to reach,
 * so the role decides and the handler does not override it.
 */
export const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export const isInteractiveTag = (openingTag) => {
  const name = /^<\s*([A-Za-z][\w.]*)/.exec(openingTag)?.[1];
  if (name === undefined) return false;
  if (INTERACTIVE_TAGS.has(name)) return true;
  const role = /\brole=\{?["']([\w-]+)["']/.exec(openingTag)?.[1];
  if (role !== undefined) return INTERACTIVE_ROLES.has(role);
  if (/\brole=/.test(openingTag)) return true; /* a computed role; assume a control */
  return /\bonClick=/.test(openingTag);
};

/*
 * Only literal ids are collected. A testid built from a template literal is documented in
 * the inventory as a `{placeholder}` pattern, and its literal prefix is already carried by
 * a sibling entry, so matching them here would report the pattern rather than a control.
 */
export const collectInteractiveTestIds = (source) => {
  const ids = new Set();
  const pattern = /data-testid=\{?(["'])([^"'`{}]*)\1/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const id = match[2];
    if (id === "") continue;
    const tagStart = source.lastIndexOf("<", match.index);
    if (tagStart < 0) continue;
    if (isInteractiveTag(readOpeningTag(source, tagStart))) ids.add(id);
  }
  return ids;
};

const walk = (dir) => {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.tsx?$/.test(full)) files.push(full);
  }
  return files;
};

export const collectSourceTestIds = (dirs = SOURCE_DIRS) => {
  const ids = new Set();
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      for (const id of collectInteractiveTestIds(readFileSync(file, "utf8"))) ids.add(id);
    }
  }
  return ids;
};

/*
 * The inventory writes ids inside backticks and abbreviates families four ways, all of
 * which appear in the document today and all of which have to be understood here or a
 * documented control is reported as missing:
 *
 *   `save-ram-type-{program,basic,screen,reu}`  a brace list of alternatives
 *   `save-ram-custom-{start,end}-{i}`           a brace placeholder for one segment
 *   `sid-radio-style-<bit>`                     an angle placeholder for one segment
 *   `playlist-type-*`                           a trailing wildcard
 *   `playlist-prev|play|pause|next`             pipe alternatives sharing a prefix
 *
 * The pipe form is the awkward one: `playback-shuffle|playback-repeat` spells both ids
 * out, while `playlist-prev|play|pause|next` gives the prefix once and then bare
 * suffixes. An alternative that already starts with the first one's prefix is taken
 * whole; anything else is appended to that prefix.
 */
const SEGMENT = "[^\\s.]+";

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const expandPipeAlternatives = (token) => {
  if (!token.includes("|")) return [token];
  const alternatives = token.split("|");
  const first = alternatives[0];
  const prefix = first.slice(0, first.lastIndexOf("-") + 1);
  return alternatives.map((alternative, index) => {
    if (index === 0 || prefix === "") return alternative;
    return alternative.startsWith(prefix) ? alternative : `${prefix}${alternative}`;
  });
};

export const inventoryTokenToRegExp = (token) => {
  let pattern = "";
  for (const part of token.split(/(\{[^{}]*\}|<[^<>]*>|\*)/)) {
    if (part === "") continue;
    if (part === "*" || (part.startsWith("<") && part.endsWith(">"))) {
      pattern += SEGMENT;
    } else if (part.startsWith("{") && part.endsWith("}")) {
      const inner = part.slice(1, -1);
      pattern += inner.includes(",")
        ? `(?:${inner
            .split(",")
            .map((alternative) => escapeRegExp(alternative.trim()))
            .join("|")})`
        : SEGMENT;
    } else {
      pattern += escapeRegExp(part);
    }
  }
  return new RegExp(`^${pattern}$`);
};

const isPattern = (token) => /[{<*]/.test(token);

export const collectInventoryMatchers = (markdown) => {
  const literals = new Set();
  const patterns = [];
  for (const match of markdown.matchAll(/`([A-Za-z0-9][\w.{},<>|*-]*)`/g)) {
    for (const token of expandPipeAlternatives(match[1])) {
      if (isPattern(token)) patterns.push(inventoryTokenToRegExp(token));
      else literals.add(token);
    }
  }
  return { literals, patterns };
};

export const isDocumented = ({ literals, patterns }, id) =>
  literals.has(id) || patterns.some((pattern) => pattern.test(id));

/*
 * Ids that belong to no user-reachable control and never will. Each needs a reason, so
 * the list cannot be used to silence a real gap.
 */
export const EXCLUSIONS = new Map([
  ["app-toast", "the toast viewport itself, not a control; its buttons carry their own ids"],
  ["file-origin-icon", "a decorative origin marker on a row whose row is the control"],
]);

/*
 * Interactive controls that were already absent from the inventory when this check landed.
 * The list may only shrink: documenting one and leaving it here is reported as an error.
 * Entries are grouped by the surface they belong to, in the order the inventory would.
 */
export const UNDOCUMENTED_BASELINE = new Set([
  /* Lighting Studio dialog and its Home entry points (no inventory section yet) */
  "home-lighting-lock-toggle",
  "home-lighting-studio",
  "home-lighting-why",
  "lighting-apply-city",
  "lighting-apply-draft",
  "lighting-apply-manual-coordinates",
  "lighting-circadian-toggle",
  "lighting-city-search",
  "lighting-clear-preview",
  "lighting-connection-sentinel-toggle",
  "lighting-link-mode",
  "lighting-manual-latitude",
  "lighting-manual-longitude",
  "lighting-mockup-case-shell",
  "lighting-open-context-lens",
  "lighting-preview",
  "lighting-profile-apply",
  "lighting-profile-delete",
  "lighting-profile-duplicate",
  "lighting-profile-pin",
  "lighting-profile-rename",
  "lighting-profile-rename-input",
  "lighting-profile-save",
  "lighting-profile-save-name",
  "lighting-quiet-launch-profile",
  "lighting-quiet-launch-toggle",
  "lighting-request-device-location",
  "lighting-select-surface-case",
  "lighting-select-surface-keyboard",
  "lighting-source-identity-toggle",
  "lighting-unlock",
  "lighting-use-device-location",
  /* Diagnostics: header, overflow, share, clear-all and the connection actions */
  "connection-actions-toggle",
  "connection-edit-cancel",
  "connection-edit-save",
  "connection-view-edit",
  "device-detail-back",
  "diagnostics-clear-all-confirm",
  "diagnostics-clear-all-trigger",
  "diagnostics-connection-details-action",
  "diagnostics-device-line",
  "diagnostics-header-toggle",
  "diagnostics-manage-devices-action",
  "diagnostics-overflow-menu",
  "diagnostics-share-all",
  "diagnostics-share-filtered",
  "retry-connection-action",
  /* Diagnostics sub-screens and their filters */
  "config-drift-back",
  "config-drift-refresh",
  "decision-state-back",
  "decision-state-repair",
  "device-safety-machine-input-cooldown",
  "health-history-zoom-out",
  "load-more-activity",
  "navigate-root",
  "open-config-drift-screen",
  "open-config-heatmap-screen",
  "open-connection-settings",
  "open-decision-state-screen",
  "open-filters-editor",
  "open-ftp-heatmap-screen",
  "open-latency-filters",
  "open-latency-screen",
  "open-rest-heatmap-screen",
  "open-timeline-screen",
  "quick-filter-errors",
  "quick-filter-ftp",
  "quick-filter-reset",
  "quick-filter-rest",
  "search-results",
  "switch-lab-delay-ms",
  "switch-lab-from-device",
  "switch-lab-iterations",
  "switch-lab-launcher",
  "switch-lab-run-soak",
  "switch-lab-to-device",
  /* Device switcher and the device password / auth challenge prompts */
  "device-auth-challenge-cancel",
  "device-auth-challenge-input",
  "device-auth-challenge-submit",
  "startup-manual-device-panel",
  "switch-device-cancel",
  "switch-device-connect",
  "switch-device-host-input",
  "switch-device-port-input",
  "switch-device-toggle",
  /* Add items sheet and the archive browser */
  "add-items-confirm",
  "add-items-deep-scan",
  "add-items-filter",
  "add-items-load-more",
  "add-items-scope-folder",
  "add-items-scope-source",
  "archive-clear-selection",
  "archive-search-button",
  "archive-select-all",
  "source-entry-row",
  /* Play: controls whose inventory entry names no testid, plus the liked-tunes rows */
  "duration-slider",
  "liked-tune-play",
  "liked-tune-unlike",
  "recently-played-other-row",
  "tune-details-toggle",
  "volume-slider",
  /* Live View, HVSC preparation and the long-running stop actions */
  "av-mirror-adopt-sender",
  "hvsc-preparation-browse",
  "hvsc-preparation-cancel",
  "hvsc-preparation-retry",
  "hvsc-stop",
  "live-view-stop",
  /* Snapshots and REU restore */
  "restore-reu-load",
  "restore-reu-preload",
  "restore-snapshot-confirm",
  "snapshot-delete",
  /* Settings rows added since the last verification pass */
  "analytic-popup-return",
  "config-retry",
  "remote-input-port-toggle",
  "settings-about-build-info",
  "settings-app-style-match-my-device",
  "settings-friendly-sid-names",
  "settings-notification-duration-slider",
  "settings-roms-auto",
  "settings-show-section-descriptions",
  "view-all-filter-input",
]);

export const findInventoryDrift = ({ sourceIds, matchers, exclusions, baseline }) => {
  const undocumented = [];
  const staleBaseline = [];
  for (const id of [...sourceIds].sort()) {
    if (exclusions.has(id)) continue;
    if (isDocumented(matchers, id)) continue;
    if (!baseline.has(id)) undocumented.push(id);
  }
  for (const id of [...baseline].sort()) {
    if (!sourceIds.has(id)) staleBaseline.push({ id, reason: "no longer present in the source" });
    else if (isDocumented(matchers, id)) staleBaseline.push({ id, reason: "now documented in the inventory" });
  }
  return { undocumented, staleBaseline };
};

const main = () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const stackDrift = findStackDrift(
    findStackLine(readFileSync(ARCHITECTURE_DOC, "utf8")),
    readInstalledMajors(packageJson),
  );

  const sourceIds = collectSourceTestIds();
  const matchers = collectInventoryMatchers(readFileSync(INVENTORY_DOC, "utf8"));
  const { undocumented, staleBaseline } = findInventoryDrift({
    sourceIds,
    matchers,
    exclusions: EXCLUSIONS,
    baseline: UNDOCUMENTED_BASELINE,
  });

  let failed = false;

  if (stackDrift.length > 0) {
    failed = true;
    console.error(`${ARCHITECTURE_DOC} states a stack version that package.json does not ship:\n`);
    for (const { label, reason } of stackDrift) console.error(`  ${label}: ${reason}`);
    console.error("");
  }

  if (undocumented.length > 0) {
    failed = true;
    console.error(
      `${undocumented.length} interactive control(s) carry a data-testid that ${INVENTORY_DOC} does not mention.\n` +
        "A control missing from the inventory is treated as unverified for keypad-only devices\n" +
        "(REVIEW.md section 5). Add an entry under the right page or dialog in section 4 or 5,\n" +
        "or add the id to EXCLUSIONS in this script with a reason if it is not a control.\n",
    );
    for (const id of undocumented) console.error(`  ${id}`);
    console.error("");
  }

  if (staleBaseline.length > 0) {
    failed = true;
    console.error(
      "UNDOCUMENTED_BASELINE in this script is out of date. The list may only shrink, so\n" +
        "remove these entries in the same change that documented or deleted the control.\n",
    );
    for (const { id, reason } of staleBaseline) console.error(`  ${id}  (${reason})`);
    console.error("");
  }

  if (failed) process.exit(1);

  console.log(
    `Reference docs: stack line matches package.json; ${sourceIds.size} interactive testids checked, ` +
      `${UNDOCUMENTED_BASELINE.size} awaiting an inventory entry.`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) main();
