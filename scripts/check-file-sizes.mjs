#!/usr/bin/env node
/*
 * Fails the build when a source file grows past the size `REVIEW.md` section 9 sets, or
 * when one of the files that was already over it grows further.
 *
 * Why this exists
 * ---------------
 * Section 9 says a file "approaching ~1000 lines is expected to be refactored unless
 * there is a documented reason not to", and the severity table makes crossing that line
 * a warning that blocks merge or needs a justification. Nothing enforced it, so 26 files
 * were over 1000 lines and the three largest pages carry dozens of effects each. Several
 * findings in the Hardening 27 review are the direct product of behaviour that has to be
 * kept in sync by hand across files that size.
 *
 * This is a ratchet, not a gate that can be met today. Splitting `SettingsPage.tsx` is
 * not a lint fix. Every file that was already over the threshold has its current length
 * recorded in `GRANDFATHERED`, and the check enforces three things:
 *
 *   - a file not in the list may not cross the threshold at all;
 *   - a file in the list may not exceed its recorded ceiling by more than
 *     `GROWTH_ALLOWANCE_LINES`;
 *   - a recorded ceiling that is more than `RATCHET_BAND` too generous has to be lowered,
 *     so a real split tightens the budget instead of leaving headroom behind.
 *
 * The growth allowance is small and absolute rather than proportional, so it does not scale
 * with how far over the line a file already is. It exists because a ceiling recorded to the
 * exact line count leaves a defect fix in one of these files no way to pass: a two-line
 * correction in the largest file in the repository would turn CI red and force a hand-edit
 * of this script, which is friction rather than pressure. The ceiling itself never rises,
 * so the allowance is a one-off, not a per-change budget: total growth above the recorded
 * length is capped at those lines for good, and any real work has to lower the entry.
 *
 * Four files sit just under the threshold and are the next ones to watch:
 * `FtpClientPlugin.kt`, `appSettings.ts`, `hvscDownload.ts` and `web/server/src/index.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const THRESHOLD = 1000;

/*
 * 10% of the ceiling. A file at its recorded ceiling may lose up to a tenth of its lines
 * before the entry counts as stale.
 */
export const RATCHET_BAND = 0.1;

/*
 * Lines a grandfathered file may exceed its recorded ceiling by. Enough for a bug fix and a
 * comment explaining it; far short of a feature.
 */
export const GROWTH_ALLOWANCE_LINES = 25;

export const ROOTS = ["src", "android/app/src/main", "web/server/src"];

export const EXTENSIONS = new Set([".ts", ".tsx", ".kt", ".java", ".swift"]);

const SKIPPED_DIRECTORIES = new Set(["node_modules", "build", "dist", ".gradle"]);

/*
 * Generated output is excluded by path rather than by sniffing the header: the largest
 * file in the repository is a generated menu mapping, and a size check that gates on a
 * compiler's output would only ever be silenced by lowering the threshold.
 */
export const isGenerated = (file) =>
  /\.generated\.[cm]?[jt]sx?$/.test(file) || file.split(path.sep).includes("generated");

export const isTest = (file) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|[\\/])(__tests__|androidTest|test)[\\/]/.test(file);

/*
 * Files already over the threshold, with the length they had when this check landed.
 * Sorted longest first, which is also the order they are worth splitting in.
 */
export const GRANDFATHERED = new Map([
  ["src/pages/SettingsPage.tsx", 3495],
  ["src/lib/c64api.ts", 3468],
  ["src/pages/PlayFilesPage.tsx", 3179],
  ["src/components/disks/HomeDiskManager.tsx", 2773],
  ["src/lib/playback/localSidEngine.ts", 2523],
  ["src/pages/playFiles/hooks/usePlaybackController.ts", 2515],
  ["src/pages/HomePage.tsx", 2197],
  ["src/lib/diagnostics/healthCheckEngine.ts", 2153],
  ["src/components/diagnostics/DiagnosticsDialog.tsx", 1991],
  ["src/components/lighting/LightingStudioDialog.tsx", 1628],
  ["src/lib/connection/connectionManager.ts", 1497],
  ["src/pages/playFiles/hooks/useHvscLibrary.ts", 1488],
  ["src/lib/hvsc/hvscIngestionRuntime.ts", 1410],
  ["src/pages/playFiles/hooks/useVolumeOverride.ts", 1387],
  ["src/lib/playback/localSidNativeSink.ts", 1301],
  ["src/lib/hvsc/hvscBrowseIndexStore.ts", 1277],
  ["android/app/src/main/java/uk/gleissner/c64commander/StreamUdpPlugin.kt", 1253],
  ["src/pages/playFiles/handlers/addFileSelections.ts", 1239],
  ["src/lib/savedDevices/store.ts", 1205],
  ["src/lib/deviceInteraction/deviceInteractionManager.ts", 1176],
  ["src/pages/ConfigBrowserPage.tsx", 1154],
  ["src/lib/streams/subjectTracker.ts", 1150],
  ["android/app/src/main/java/uk/gleissner/c64commander/AudioPipeline.kt", 1113],
  ["android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt", 1061],
  ["src/lib/disks/diskMount.ts", 1031],
]);

const walk = (dir) => {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (EXTENSIONS.has(path.extname(full))) files.push(full);
  }
  return files;
};

export const countLines = (source) => source.split("\n").length;

export const measureSources = (roots = ROOTS) => {
  const sizes = new Map();
  for (const root of roots) {
    for (const file of walk(root)) {
      if (isGenerated(file) || isTest(file)) continue;
      sizes.set(file.split(path.sep).join("/"), countLines(readFileSync(file, "utf8")));
    }
  }
  return sizes;
};

export const findSizeViolations = ({
  sizes,
  grandfathered,
  threshold = THRESHOLD,
  band = RATCHET_BAND,
  growthAllowance = GROWTH_ALLOWANCE_LINES,
}) => {
  const crossed = [];
  const grown = [];
  const staleCeilings = [];

  for (const [file, lines] of [...sizes].sort()) {
    const ceiling = grandfathered.get(file);
    if (ceiling === undefined) {
      if (lines > threshold) crossed.push({ file, lines });
      continue;
    }
    if (lines > ceiling + growthAllowance) grown.push({ file, lines, ceiling });
    else if (lines <= threshold)
      staleCeilings.push({ file, lines, ceiling, reason: "is back under the threshold, so remove its entry" });
    else if (lines < Math.round(ceiling * (1 - band)))
      staleCeilings.push({ file, lines, ceiling, reason: `has shrunk; lower its ceiling to ${lines}` });
  }

  for (const [file, ceiling] of [...grandfathered].sort()) {
    if (!sizes.has(file))
      staleCeilings.push({ file, lines: 0, ceiling, reason: "no longer exists, so remove its entry" });
  }

  return { crossed, grown, staleCeilings };
};

const main = () => {
  const sizes = measureSources();
  const { crossed, grown, staleCeilings } = findSizeViolations({ sizes, grandfathered: GRANDFATHERED });

  let failed = false;

  if (crossed.length > 0) {
    failed = true;
    console.error(
      `${crossed.length} file(s) crossed the ${THRESHOLD}-line modularity threshold (REVIEW.md section 9).\n` +
        "Split along a seam the file already has rather than adding an entry to GRANDFATHERED\n" +
        "in this script; that list is for files that were over the line before it was enforced.\n",
    );
    for (const { file, lines } of crossed) console.error(`  ${file}  ${lines} lines`);
    console.error("");
  }

  if (grown.length > 0) {
    failed = true;
    console.error(
      `File(s) already over the threshold grew more than ${GROWTH_ALLOWANCE_LINES} lines past their ceiling. Shorten them, or split them and lower the ceiling.\n`,
    );
    for (const { file, lines, ceiling } of grown) console.error(`  ${file}  ${lines} lines, ceiling ${ceiling}`);
    console.error("");
  }

  if (staleCeilings.length > 0) {
    failed = true;
    console.error("GRANDFATHERED in this script is out of date. Ceilings only ratchet down.\n");
    for (const { file, reason } of staleCeilings) console.error(`  ${file}  ${reason}`);
    console.error("");
  }

  if (failed) process.exit(1);

  console.log(
    `File sizes: ${sizes.size} source files checked against the ${THRESHOLD}-line threshold; ` +
      `${GRANDFATHERED.size} grandfathered, none grew.`,
  );
};

// `import.meta.url` is percent-encoded and a raw path is not, so comparing the two directly
// makes this never match in a checkout whose path contains a space or any other encoded
// character — and the gate would then exit 0 having checked nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
