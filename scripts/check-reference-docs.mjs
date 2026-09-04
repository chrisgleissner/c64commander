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
import { pathToFileURL } from "node:url";

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
 *
 * Quoted values are skipped for the same reason, and it is not hypothetical: a `>` inside an
 * attribute ended the tag early, `findOpeningTagFor` then found no tag for the attribute, and the
 * control was dropped from this gate without a word. `aria-label="Next >"` does it, and so does a
 * Tailwind child selector such as `className="[&>svg]:size-4"`, of which several already exist in
 * `src/components/ui`.
 */
export const readOpeningTag = (source, start) => {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
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

/*
 * Finds the JSX opening tag an attribute at `attributeIndex` belongs to. The nearest earlier
 * `<` is not always that tag: a prop expression may contain a generic (`new Set<Kind>(...)`)
 * or a comparison, and such a `<` closes before the attribute. A candidate only qualifies
 * when the tag it opens still extends past the attribute.
 */
export const findOpeningTagFor = (source, attributeIndex) => {
  let cursor = attributeIndex;
  while (cursor > 0) {
    const start = source.lastIndexOf("<", cursor - 1);
    if (start < 0) return null;
    const openingTag = readOpeningTag(source, start);
    /* `a < b` and `a<b` are comparisons; a tag name follows its `<` directly and ends the name
       on whitespace, `/` or `>`. This also rejects the `<` of a closing tag. */
    if (/^<[A-Za-z][\w.]*[\s/>]/.test(openingTag) && start + openingTag.length > attributeIndex) {
      return openingTag;
    }
    cursor = start;
  }
  return null;
};

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
 * Only literal ids are collected, which is the gate's main limitation and is recorded here
 * rather than implied. A testid built at runtime — `data-testid={testId}`,
 * `data-testid={action.testId}`, a ternary between two names — has no literal text to compare
 * against the inventory, so those controls are outside this check and stay the on-device pass's
 * job. Around thirty such expressions exist today. Where a template literal does carry a literal
 * prefix, the inventory documents it as a `{placeholder}` pattern and a sibling entry covers the
 * prefix, so matching it here would report the pattern rather than a control.
 */
export const collectInteractiveTestIds = (source) => {
  const ids = new Set();
  const pattern = /data-testid=\{?(["'])([^"'`{}]*)\1/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const id = match[2];
    if (id === "") continue;
    const openingTag = findOpeningTagFor(source, match.index);
    if (openingTag === null) continue;
    if (isInteractiveTag(openingTag)) ids.add(id);
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
  ["search-results", "the search overlay's listbox container; its options carry their own ids"],
]);

/*
 * Interactive controls that were already absent from the inventory when this check landed.
 * The list may only shrink: documenting one and leaving it here is reported as an error.
 * It is now empty, so every interactive control in the app has an inventory entry and a
 * new one has to be documented in the change that adds it.
 */
export const UNDOCUMENTED_BASELINE = new Set([]);

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

/*
 * A walk that returns nothing leaves every comparison below empty, and the gate reports
 * success having read no source file at all. That is how a renamed or moved source root
 * removes the inventory check without a red check anywhere. The app carries 298 today.
 */
export const MIN_SOURCE_TESTIDS = 200;

const main = () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const stackDrift = findStackDrift(
    findStackLine(readFileSync(ARCHITECTURE_DOC, "utf8")),
    readInstalledMajors(packageJson),
  );

  const sourceIds = collectSourceTestIds();
  if (sourceIds.size < MIN_SOURCE_TESTIDS) {
    console.error(
      `Only ${sourceIds.size} interactive testids were found under ${SOURCE_DIRS.join(", ")}, ` +
        `fewer than the ${MIN_SOURCE_TESTIDS} expected.\n` +
        "Nothing was compared against the inventory, so this is a failure rather than a pass.",
    );
    process.exit(2);
  }

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

// `import.meta.url` is percent-encoded and a raw path is not, so comparing the two directly
// makes this never match in a checkout whose path contains a space or any other encoded
// character — and the gate would then exit 0 having checked nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
