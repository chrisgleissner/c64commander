#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Read a CPU profile from the phone in original file and function names.
 *
 * A `.cpuprofile` captured over CDP names minified functions (`N9 index-sftUog9q.js:9:3012`). With
 * the source maps of the same build (`build_sourcemapped.mjs`) each call frame is mapped back to
 * `src/...:line function`, and the time is summed per original function:
 *
 *   self   samples whose innermost frame is this function
 *   total  samples with this function anywhere on the stack, counted once per sample
 *
 * The function name is taken, in order of preference, from the source map's name for the minified
 * identifier just before the frame's position, from the name at the position itself, and from the
 * declaration on the original source line. Native frames (`scrollIntoView`, `querySelector`) have no
 * script; their callers are listed, because "who forced this layout" is the question they raise.
 *
 * Usage:
 *   node tools/hil/symbolize_cpuprofile.mjs <profile.cpuprofile> <sourcemap-dir>
 *        [--top 30] [--group name=regex ...] [--stacks regex] [--json out.json]
 *
 * `--group` sums the samples whose stack contains a frame matching the regex (first group wins),
 * e.g. --group 'scoring=lib/search/score|useSearchResults' --group 'scrollIntoView=scrollIntoView'.
 * `--stacks` prints the commonest call paths that lead into frames matching the regex.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** How many frames above the matched one `--stacks` shows, React and scheduler frames excluded. */
const STACK_DEPTH = 40;

const SYNTHETIC = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"]);

/** Strip a source path to the part a reader recognises: `src/...` or `node_modules/...`. */
export const tidySource = (source) => {
  const node = source.lastIndexOf("node_modules/");
  if (node >= 0) return source.slice(node);
  const src = source.lastIndexOf("src/");
  if (src >= 0) return source.slice(src);
  return source.replace(/^(\.\.\/)+/, "");
};

const DECLARATIONS = [
  /function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>|<)/g,
  /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]+)?=>|function)/g,
  /^\s*(?:async\s+|static\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/g,
];

/** The function declared on an original source line, nearest before `column` when there are several. */
export const nameFromSourceLine = (line, column) => {
  for (const pattern of DECLARATIONS) {
    let best = null;
    for (const match of line.matchAll(pattern)) {
      if (best === null || match.index <= column) best = match[1];
    }
    if (best) return best;
  }
  return null;
};

/** Loads `<script>.map` files lazily from one directory; returns null for a script it has no map for. */
export const createMapper = (mapDir) => {
  const { SourceMapConsumer } = require("source-map-js");
  const cache = new Map();
  const load = (url) => {
    const file = url.split("/").pop();
    if (!file || !file.endsWith(".js")) return null;
    if (cache.has(file)) return cache.get(file);
    const mapPath = path.join(mapDir, `${file}.map`);
    const codePath = path.join(mapDir, file);
    const entry = fs.existsSync(mapPath)
      ? {
          consumer: new SourceMapConsumer(JSON.parse(fs.readFileSync(mapPath, "utf8"))),
          lines: fs.existsSync(codePath) ? fs.readFileSync(codePath, "utf8").split("\n") : [],
        }
      : null;
    cache.set(file, entry);
    return entry;
  };

  const originalLine = (consumer, source, line) => {
    const content = consumer.sourceContentFor(source, true);
    return content ? (content.split("\n")[line - 1] ?? "") : "";
  };

  /** `{ key, source, line, name, mapped }` for one CDP call frame (0-based line and column). */
  return (callFrame) => {
    const { functionName, url, lineNumber, columnNumber } = callFrame;
    if (!url) {
      const name = functionName || "(anonymous)";
      return { key: SYNTHETIC.has(name) ? name : `(native) ${name}`, source: null, line: null, name, mapped: false };
    }
    const entry = load(url);
    const script = url.split("/").pop();
    if (!entry) {
      return {
        key: `${script}:${lineNumber + 1} ${functionName || "(anonymous)"}`,
        source: script,
        line: lineNumber + 1,
        name: functionName,
        mapped: false,
      };
    }
    const { consumer, lines } = entry;
    const generatedLine = lines[lineNumber] ?? "";
    let name = null;
    if (functionName) {
      const at = generatedLine.lastIndexOf(functionName, columnNumber);
      if (at >= 0 && columnNumber - at < 200) {
        name = consumer.originalPositionFor({ line: lineNumber + 1, column: at }).name ?? null;
      }
    }
    const position = consumer.originalPositionFor({ line: lineNumber + 1, column: columnNumber });
    if (!position.source) {
      return {
        key: `${script}:${lineNumber + 1}:${columnNumber} ${functionName || "(anonymous)"}`,
        source: script,
        line: lineNumber + 1,
        name: functionName,
        mapped: false,
      };
    }
    name ??=
      position.name ?? nameFromSourceLine(originalLine(consumer, position.source, position.line), position.column);
    const source = tidySource(position.source);
    return {
      key: `${source}:${position.line} ${name ?? "(anonymous)"}`,
      source,
      line: position.line,
      name: name ?? "(anonymous)",
      mapped: true,
    };
  };
};

/**
 * Self and total time per symbolized key, in milliseconds, plus the callers of each key.
 *
 * Pure over the profile and a `frameKey(callFrame)` function, so the arithmetic is testable without
 * source maps. Total counts a key once per sample however often it recurs on that stack.
 */
export const aggregateProfile = (profile, frameKey, groups = [], stackPattern = null) => {
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const keyOf = new Map(profile.nodes.map((node) => [node.id, frameKey(node.callFrame)]));
  const idleNodes = new Set(
    profile.nodes.filter((node) => node.callFrame.functionName === "(idle)").map((node) => node.id),
  );

  const self = new Map();
  const total = new Map();
  const callers = new Map();
  const grouped = new Map(groups.map(({ name }) => [name, 0]));
  const stacks = new Map();
  let wallMs = 0;
  let idleMs = 0;
  profile.samples.forEach((nodeId, index) => {
    const ms = (profile.timeDeltas[index] ?? 0) / 1000;
    wallMs += ms;
    const leaf = keyOf.get(nodeId);
    if (idleNodes.has(nodeId)) {
      idleMs += ms;
      return;
    }
    self.set(leaf, (self.get(leaf) ?? 0) + ms);
    const parentId = parent.get(nodeId);
    if (parentId !== undefined) {
      const caller = keyOf.get(parentId);
      const perLeaf = callers.get(leaf) ?? new Map();
      perLeaf.set(caller, (perLeaf.get(caller) ?? 0) + ms);
      callers.set(leaf, perLeaf);
    }
    const chain = [];
    for (let id = nodeId; id !== undefined; id = parent.get(id)) chain.push(keyOf.get(id));
    const seen = new Set(chain);
    if (stackPattern) {
      const outermost = chain.findLastIndex((key) => stackPattern.test(key));
      if (outermost >= 0) {
        const path = chain
          .slice(outermost, outermost + STACK_DEPTH)
          .filter((key) => !key.startsWith("node_modules/react-dom/") && !key.startsWith("node_modules/scheduler/"))
          .reverse()
          .join("  >  ");
        stacks.set(path, (stacks.get(path) ?? 0) + ms);
      }
    }
    for (const key of seen) total.set(key, (total.get(key) ?? 0) + ms);
    const group = groups.find(({ pattern }) => [...seen].some((key) => pattern.test(key)));
    if (group) grouped.set(group.name, grouped.get(group.name) + ms);
  });
  return { wallMs, idleMs, busyMs: wallMs - idleMs, self, total, callers, grouped, stacks };
};

const top = (map, count) => [...map.entries()].sort((left, right) => right[1] - left[1]).slice(0, count);

const main = () => {
  const argv = process.argv.slice(2);
  const positional = [];
  const groups = [];
  let topCount = 30;
  let jsonOut = null;
  let stackPattern = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--top") topCount = Number(argv[++i]);
    else if (argv[i] === "--json") jsonOut = argv[++i];
    else if (argv[i] === "--stacks") stackPattern = new RegExp(argv[++i]);
    else if (argv[i] === "--group") {
      const [name, ...rest] = argv[++i].split("=");
      groups.push({ name, pattern: new RegExp(rest.join("=")) });
    } else positional.push(argv[i]);
  }
  const [profilePath, mapDirArg] = positional;
  if (!profilePath || !mapDirArg) {
    console.error("usage: symbolize_cpuprofile.mjs <profile> <sourcemap-dir> [--top N] [--group name=re] [--json f]");
    process.exit(2);
  }
  const mapDir = ["", "assets", "dist/assets"]
    .map((sub) => path.join(mapDirArg, sub))
    .find((dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith(".js.map")));
  if (!mapDir) throw new Error(`no *.js.map files in ${mapDirArg}`);

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const mapper = createMapper(mapDir);
  const frames = new Map();
  const frameKey = (callFrame) => {
    const id = `${callFrame.url}|${callFrame.lineNumber}|${callFrame.columnNumber}|${callFrame.functionName}`;
    if (!frames.has(id)) frames.set(id, mapper(callFrame));
    return frames.get(id).key;
  };
  const result = aggregateProfile(profile, frameKey, groups, stackPattern);
  const unmappedScripts = new Set(
    [...frames.values()].filter((frame) => !frame.mapped && frame.source).map((frame) => frame.source),
  );

  const pct = (ms) => `${((100 * ms) / result.busyMs).toFixed(1).padStart(5)}%`;
  console.log(
    `profile ${path.basename(profilePath)}: ${result.wallMs.toFixed(0)} ms wall, ${result.busyMs.toFixed(0)} ms busy ` +
      `(${result.idleMs.toFixed(0)} ms idle), maps from ${mapDir}`,
  );
  if (unmappedScripts.size)
    console.log(`frames with no mapping (wrapper code, or no .map): ${[...unmappedScripts].join(", ")}`);
  console.log(`\nSELF (ms, % of busy)`);
  for (const [key, ms] of top(result.self, topCount)) console.log(`${ms.toFixed(1).padStart(9)} ${pct(ms)}  ${key}`);
  console.log(`\nTOTAL (ms, % of busy; inclusive, once per sample)`);
  for (const [key, ms] of top(result.total, topCount).filter(([key]) => key !== "(root)")) {
    console.log(`${ms.toFixed(1).padStart(9)} ${pct(ms)}  ${key}`);
  }
  const natives = top(result.self, topCount).filter(([key]) => key.startsWith("(native)"));
  if (natives.length) {
    console.log(`\nNATIVE FRAMES AND THEIR CALLERS`);
    for (const [key, ms] of natives) {
      console.log(`${ms.toFixed(1).padStart(9)}  ${key}`);
      for (const [caller, callerMs] of top(result.callers.get(key) ?? new Map(), 3)) {
        console.log(`${"".padStart(13)}${callerMs.toFixed(1).padStart(8)} <- ${caller}`);
      }
    }
  }
  if (groups.length) {
    console.log(`\nGROUPS (inclusive, first match wins)`);
    for (const [name, ms] of result.grouped) console.log(`${ms.toFixed(1).padStart(9)} ${pct(ms)}  ${name}`);
  }
  if (stackPattern) {
    console.log(`\nSTACKS INTO ${stackPattern} (callers above it, React internals omitted)`);
    for (const [stack, ms] of top(result.stacks, 8)) console.log(`${ms.toFixed(1).padStart(9)} ${pct(ms)}  ${stack}`);
  }
  if (jsonOut) {
    const asObject = (map) => Object.fromEntries(top(map, Infinity));
    fs.writeFileSync(
      jsonOut,
      `${JSON.stringify(
        {
          wallMs: result.wallMs,
          busyMs: result.busyMs,
          idleMs: result.idleMs,
          self: asObject(result.self),
          total: asObject(result.total),
          groups: Object.fromEntries(result.grouped),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`wrote ${jsonOut}`);
  }
};

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`symbolize_cpuprofile: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  }
}
