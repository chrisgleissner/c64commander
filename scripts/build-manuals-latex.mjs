#!/usr/bin/env node
/**
 * Spike: a print-quality PDF of the manual, set with LaTeX.
 *
 * The shipping PDF is laid out by Paged.js in a headless Chromium. That is a
 * good browser doing its best at typesetting; this is a typesetter. What the
 * difference buys, and why the spike exists at all:
 *
 *   - real hyphenation and justification, so a 135 mm measure has no rivers
 *     and no line ends a word short;
 *   - microtype, which nudges margins and letter spacing so the text block
 *     reads as one grey field rather than a ragged one;
 *   - float placement, so a screenshot moves to where it fits instead of
 *     leaving half a page blank;
 *   - a real index, collated and page-numbered by makeindex rather than by a
 *     two-pass measure of the browser's own layout.
 *
 * The prose comes from `renderManualMarkdown` unchanged, so both pipelines
 * always describe the same app.
 *
 * Requires pandoc, LuaLaTeX with luaotfload, and makeindex. `./build --manual`
 * installs them if they are missing and then runs this.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSingleDisplayProfile,
  buildManualContexts,
  renderManualMarkdown,
  INDEX_TERMS,
} from "./build-manuals.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const preambleFile = path.join(scriptDir, "latex/preamble.tex");

const escapeTex = (value) =>
  value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

/** makeindex reads `!` as a subentry, `@` as a sort key and `|` as an encap. */
const escapeIndex = (value) => escapeTex(value).replace(/([!@|])/g, '"$1');

/**
 * Marks the first mention of each index term in each section of the markdown.
 *
 * The same rule the HTML pipeline follows: once per section, not once per
 * occurrence, because an index entry that lists the same page six times helps
 * nobody. Marking happens on the markdown rather than the LaTeX so that the
 * needle is matched against the words a reader sees, not against a stream of
 * macros. `\index{...}` survives pandoc untouched under `+raw_tex`.
 */
const markIndexTerms = (markdown) => {
  const lines = markdown.split("\n");
  const seen = new Set();
  const placed = new Set();
  let inFence = false;

  const marked = lines
    .map((line) => {
      if (line.startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      if (/^#{1,4}\s/.test(line)) {
        seen.clear();
        return line;
      }
      if (line.startsWith("|") || line.startsWith("![")) return line;

      let output = line;
      INDEX_TERMS.forEach((entry, index) => {
        if (entry.see || seen.has(index)) return;
        for (const phrase of entry.match) {
          const needle = phrase.replace(/\*\*/g, "");
          const at = output.indexOf(needle);
          if (at < 0) continue;
          const before = output[at - 1];
          const after = output[at + needle.length];
          if ((before && /[\w-]/.test(before)) || (after && /[\w]/.test(after))) continue;
          const cut = at + needle.length;
          output = `${output.slice(0, cut)}\\index{${escapeIndex(entry.term)}}${output.slice(cut)}`;
          seen.add(index);
          placed.add(entry.term);
          break;
        }
      });
      return output;
    })
    .join("\n");

  return { markdown: marked, placed };
};

/**
 * The index's cross-references, as makeindex `see` records.
 *
 * `\index{X|see{Y}}` prints "X, see Y" and no page number, which is what a
 * pointer entry is for. They are emitted once, in a group of their own, because
 * a cross-reference belongs to the book rather than to any page of it.
 *
 * A pointer whose target never appeared in this edition is dropped with it: the
 * keypad edition has no Lighting, so "lighting studio, see Lighting" would send
 * a reader to an entry that is not there.
 */
const indexCrossReferences = (placed) =>
  INDEX_TERMS.filter((entry) => entry.see && placed.has(entry.see))
    .map((entry) => `\\index{${escapeIndex(entry.term)}|see{${escapeIndex(entry.see)}}}`)
    .join("\n");

/** Intrinsic pixel size of a PNG, from its IHDR chunk. */
const pngSize = (absolutePath) => {
  try {
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
};

/**
 * Picks a printed width from the shape of the picture.
 *
 * A phone screenshot is roughly 3:4 and belongs in a narrow column; stretched
 * to the measure it prints one control per inch and looks like a mistake. A
 * photograph of the hardware is wide and is unreadable in the same column.
 */
const figureWidth = (absolutePath) => {
  const size = pngSize(absolutePath);
  if (!size) return "0.62\\linewidth";
  const ratio = size.width / size.height;
  // Deliberately modest. A phone capture set much larger than this is taller
  // than half the text block, and two of them in one section then cannot share
  // a page with the text that introduces them: LaTeX defers both, and the
  // reader meets a pair of pictures on a page of their own.
  if (ratio < 0.62) return "0.33\\linewidth";
  if (ratio < 0.95) return "0.42\\linewidth";
  if (ratio < 1.5) return "0.62\\linewidth";
  return "0.88\\linewidth";
};

/**
 * Everything pandoc cannot know about this particular book.
 *
 * Each rewrite is a presentation decision the markdown has no way to carry:
 * how wide a screenshot prints, that a table head is sans, that the first
 * paragraph after a heading should not be indented away from it.
 */
/**
 * Replaces `\macro{Label: body}` with a callout environment holding the body.
 *
 * Brace-counted rather than matched by regular expression: the body regularly
 * contains `\textbf{...}`, and a non-greedy `}` stops at the inner one, which
 * silently cuts the sentence in half and leaves a stray brace behind.
 */
const liftBalanced = (tex, opener, environment, shouldLift = () => true) => {
  let output = "";
  let rest = tex;
  for (;;) {
    const at = rest.indexOf(opener);
    if (at < 0) return output + rest;
    let depth = 1;
    let cursor = at + opener.length;
    while (cursor < rest.length && depth > 0) {
      const character = rest[cursor];
      if (character === "{" && rest[cursor - 1] !== "\\") depth += 1;
      else if (character === "}" && rest[cursor - 1] !== "\\") depth -= 1;
      cursor += 1;
    }
    const body = rest.slice(at + opener.length, cursor - 1).trim();
    output += rest.slice(0, at);
    output += shouldLift(body)
      ? `\\begin{${environment}}\n${body}\n\\end{${environment}}`
      : // Left as the emphasised sentence it already was, rather than dropped:
        // the fact is still worth having, it just does not warrant a box.
        `\\emph{Availability: ${body}}`;
    rest = rest.slice(cursor);
  }
};

const dressLatex = (tex, manualDir) => {
  let output = tex;

  // Screenshots: sized by shape, framed, absolute-pathed because the build
  // directory sits deeper than the markdown's own `../../img/...` would resolve
  // from.
  output = output.replace(/\\includegraphics(\[[^\]]*\])?\{([^}]+)\}/g, (full, options, src) => {
    const absolute = path.resolve(manualDir, src);
    return `\\screenshot{${figureWidth(absolute)}}{${absolute}}`;
  });

  // A picture never floats. In a manual the screenshot IS the sentence before
  // it, so pandoc's `figure` becomes a block that is set exactly where it was
  // written. Left as floats, LaTeX defers them: a reader gets a picture at the
  // top of a page whose text is overleaf, and four of them stacked on the page
  // after that.
  output = output.replace(
    /\\begin\{figure\}(?:\[[^\]]*\])?\s*\\centering\s*([\s\S]*?)\\caption\{([\s\S]*?)\}([\s\S]*?)\\end\{figure\}/g,
    (full, graphic, caption) =>
      `\\begin{manualfigure}\n${graphic.trim()}\n\\captionof{figure}{${caption.trim()}}\n\\end{manualfigure}`,
  );

  // A picture pandoc read as inline, because its markdown line had no blank line
  // above it, is still a picture: it would otherwise hang off the end of a line
  // of prose, right-aligned, half outside the measure and with no caption. The
  // markdown is the place to fix that, and was; this catches the next one.
  //
  // Applied only outside the blocks the rewrite above just made, so a screenshot
  // that is already a proper figure is left alone.
  output = output
    .split(/(\\begin\{manualfigure\}[\s\S]*?\\end\{manualfigure\})/)
    .map((part) =>
      part.startsWith("\\begin{manualfigure}")
        ? part
        : part.replace(
            /[ ]*\\screenshot\{([^}]*)\}\{([^}]*)\}/g,
            (full, width, src) => `\n\n\\begin{manualfigure}\n\\screenshot{${width}}{${src}}\n\\end{manualfigure}\n\n`,
          ),
    )
    .join("");

  // "Availability: on by default..." is the one line that tells a reader whether
  // the feature they just read about is even switched on. It was an italic
  // afterthought at the end of a section; as a callout it can be found while
  // skimming.
  // Only the availability lines that ask something of the reader become callouts.
  //
  // "On by default" and "Always on in this edition" tell someone that the thing
  // they just read about already works. Set as a boxed callout beside every
  // feature, that is a page of furniture saying nothing, and it devalues the
  // boxes that do carry an instruction. Those lines stay as ordinary prose.
  //
  // "Off to begin with. Turn it on under X in Settings" is different: a reader
  // who does not act on it will go looking for a control that is not there.
  output = liftBalanced(output, "\\emph{Availability:", "manualavail", (body) => /^Off to begin with/i.test(body));

  // Same for the "Preferred path" line that closes every flow in Everyday Flows.
  // Same test for the "Preferred path" line that closes every flow. Most carry a
  // real steer - which source to use for which file, what a filter does and does
  // not change - and those become callouts. The short ones only restate the step
  // list directly above them ("Diagnostics from the badge."), and a box around a
  // restatement is furniture. Eight words is where the two groups separate.
  output = output.replace(/^Preferred path:\s*([\s\S]*?)(?=\n\n)/gm, (full, body) => {
    const text = body.trim();
    return text.split(/\s+/).length >= 8
      ? `\\begin{manualpath}\n${text}\n\\end{manualpath}`
      : `\\emph{Preferred path:} ${text}`;
  });

  // A markdown blockquote is the manual's callout convention: `> **Tip.** ...`
  // or `> **Take care.** ...`. The bold lead becomes the box label, so a reader
  // skimming for advice finds it without reading the paragraph.
  output = output.replace(
    /\\begin\{quote\}\s*\\textbf\{([^}]+?)\.?\}\s*([\s\S]*?)\\end\{quote\}/g,
    (full, label, body) => `\\begin{manualnote}[${label.replace(/\.$/, "")}]\n${body.trim()}\n\\end{manualnote}`,
  );
  output = output.replace(
    /\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g,
    (full, body) => `\\begin{manualnote}\n${body.trim()}\n\\end{manualnote}`,
  );

  // The header row tinted in the chapter's hue. A reference table runs for
  // pages, and the tint is what tells a reader at a glance which row is the
  // heading when the table breaks across one.
  output = output.replace(/\\toprule\\noalign\{\}\n/g, "\\toprule\\noalign{}\n\\rowcolor{accent!12!c64paper}\n");

  // Table rules in the chapter's hue, and the whole table a step smaller so a
  // wide reference table keeps to the measure.
  output = output.replace(
    /\\begin\{longtable\}/g,
    "\\begingroup\\small\\arrayrulecolor{accent!55!c64ink}\\begin{longtable}",
  );
  output = output.replace(/\\end\{longtable\}/g, "\\end{longtable}\\endgroup");

  // `\tightlist` from pandoc fights the list spacing set in the preamble.
  output = output.replace(/\\tightlist\n?/g, "");

  return output;
};

const fontsDir = path.join(scriptDir, "latex/fonts");

/**
 * The pinned pandoc, in preference to whatever is on PATH.
 *
 * Versions are not interchangeable here: 3.11 wraps every image in
 * `\pandocbounded` and writes `\LTcaptype{none}` before an uncaptioned table,
 * neither of which 3.1.3 emits. A machine using its distribution's pandoc
 * produced LaTeX that would not compile. `./build --manual-deps` puts the pinned
 * binary in `scripts/latex/bin`, and this prefers it, so a local build and a CI
 * build are the same build.
 */
const pandocBin = (() => {
  const pinned = path.join(scriptDir, "latex/bin/pandoc");
  return fs.existsSync(pinned) ? pinned : "pandoc";
})();

/**
 * The manual is set with LuaLaTeX, and only with LuaLaTeX.
 *
 * There used to be a pdfLaTeX path that fell back to the TeX Gyre revivals when
 * IBM Plex could not be loaded. A silent fallback to another typeface is a worse
 * outcome than a build that stops: the manual still came out, looking like a
 * different book, and nothing in the file said so. The faces are vendored now,
 * so the only way left to reach that fallback was a missing engine, which is a
 * thing to install rather than to paper over.
 */
const requireToolchain = () => {
  const missing = [];
  for (const tool of ["lualatex", "makeindex"]) {
    try {
      execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
    } catch {
      missing.push(tool);
    }
  }
  try {
    execFileSync("kpsewhich", ["luaotfload.sty"], { stdio: "ignore" });
  } catch {
    missing.push("luaotfload");
  }
  try {
    execFileSync(pandocBin, ["--version"], { stdio: "ignore" });
  } catch {
    missing.push("pandoc");
  }
  if (missing.length > 0) {
    throw new Error(
      `cannot typeset the manual; missing: ${missing.join(", ")}\nInstall the toolchain with: ./build --manual-deps`,
    );
  }
};

const coverTex = ({ productName, subtitle, launchImage, logo, edition, buildDate, typeface }) => `
% The cover follows the 1982 guide's instinct: one strong band of colour, the
% name of the machine large enough to read across a room, and a picture of the
% thing itself. Everything else waits until page one.
\\begin{titlingpage}
\\thispagestyle{empty}
\\AddToShipoutPictureBG*{%
  \\AtPageUpperLeft{\\raisebox{-38mm}{\\color{accent}\\rule{\\paperwidth}{7mm}}}%
  \\AtPageLowerLeft{\\raisebox{24mm}{\\color{accent!25!c64paper}\\rule{\\paperwidth}{2.4mm}}}}
\\begin{center}
\\vspace*{34mm}
${logo ? `\\includegraphics[height=16mm]{${logo}}\\par\\vspace{10mm}` : ""}
{\\sffamily\\fontsize{10.5}{13}\\selectfont\\color{c64muted}\\lsstyle\\MakeUppercase{User Manual}\\par}
\\vspace{7mm}
{\\sffamily\\bfseries\\fontsize{44}{48}\\selectfont\\color{c64ink}${escapeTex(productName)}\\par}
\\vspace{8mm}
{\\fontsize{13.5}{19}\\selectfont\\color{c64muted}\\parbox{116mm}{\\centering ${escapeTex(subtitle)}}\\par}
\\vspace{11mm}
${launchImage ? `\\screenshot{0.36\\linewidth}{${launchImage}}\\par\\vspace{9mm}` : ""}
{\\sffamily\\small\\color{c64muted}Edition ${escapeTex(edition)}\\quad\\textbullet\\quad ${escapeTex(buildDate)}\\par}
\\end{center}
\\end{titlingpage}

\\thispagestyle{empty}
\\vspace*{\\fill}
{\\sffamily\\bfseries\\large\\color{c64ink}${escapeTex(productName)}\\par}
{\\sffamily\\color{c64muted}User Manual\\par}
\\vspace{3mm}{\\color{accent}\\rule{28mm}{2pt}\\par}
\\vspace{6mm}
{\\small This manual describes ${escapeTex(productName)} as released in the edition below. The app is under
active development, so a later release may add controls this edition does not describe; the manual is
reissued with each release.\\par}
\\vspace{7mm}
{\\small\\begin{tabular}{@{}p{26mm}p{82mm}@{}}
\\textsf{\\bfseries Edition} & ${escapeTex(edition)} \\\\
\\textsf{\\bfseries Published} & ${escapeTex(buildDate)} \\\\
\\textsf{\\bfseries Set in} & ${escapeTex(typeface)} \\\\
\\end{tabular}\\par}
\\vspace{9mm}
{\\footnotesize\\color{c64muted}Copyright \\textcopyright{} 2026 Christian Gleissner. Commodore, the Commodore
logo, C64 and Commodore 64 are trademarks of their respective owners. Every screenshot in this manual is
captured from the running app rather than drawn, so what is printed here is what the app puts on screen.\\par}
\\vspace*{\\fill}
\\clearpage
`;

const buildOne = async (context, outputDir) => {
  const { variant, manualDir, title, subtitle, appVersion } = context;
  const productName = title.replace(/\s+Manual$/, "");
  const markdown = renderManualMarkdown(context);

  // The same guard the shipping pipeline runs. Every app screenshot a manual
  // embeds must come from that manual's own display profile; without this an
  // edition can be published showing another edition's screen size, and the
  // failure is invisible in the output because the picture is simply a
  // different shape.
  assertSingleDisplayProfile(markdown, variant.id === "c64u-remote" ? "compact" : "medium", variant.id);

  const engine = "lualatex";
  const typeface = "IBM Plex Serif and IBM Plex Sans";

  // Everything before the first real chapter is the title block and the in-app
  // contents list. The print edition replaces both with a cover and a
  // page-numbered Table of Contents, so they are dropped from the body.
  const bodyStart = markdown.search(/\n## (?!Table of Contents)/);
  const preamble = bodyStart >= 0 ? markdown.slice(0, bodyStart) : "";
  const body = bodyStart >= 0 ? markdown.slice(bodyStart) : markdown;
  const launchMatch = /!\[[^\]]*]\(([^)]+)\)/.exec(preamble);

  const { markdown: marked, placed } = markIndexTerms(body);
  const markdownFile = path.join(outputDir, `${variant.exportedFileBasename}-body.md`);
  await writeFile(markdownFile, marked, "utf8");

  const texBody = execFileSync(
    pandocBin,
    [
      markdownFile,
      // `-tex_math_dollars`: the manual writes C64 addresses as $0000-$FFFF, and
      // with math enabled pandoc reads the pair as an equation and sets the
      // digits in Computer Modern italics.
      "--from=markdown+raw_tex+pipe_tables+backtick_code_blocks-tex_math_dollars",
      "--to=latex",
      "--top-level-division=chapter",
      // The body starts at `##`, because `#` was the title block the print
      // edition replaces with a cover. Lifting every heading one level makes
      // those `##` chapters rather than sections.
      "--shift-heading-level-by=-1",
      "--wrap=preserve",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const logoPath = path.join(rootDir, "variants/assets", variant.id, "logo.png");
  // The preamble names the vendored faces by absolute path, which it cannot know
  // for itself.
  const preambleText = (await readFile(preambleFile, "utf8")).replaceAll("%%FONTDIR%%", fontsDir);

  const document = `\\documentclass[11pt,a4paper,twoside,openright]{memoir}
${preambleText}
\\usepackage{imakeidx}
\\makeindex[title=Index,columns=2,intoc,options={-s ${path.join(outputDir, "index.ist")}}]

\\begin{document}
\\frenchspacing
${coverTex({
  productName,
  subtitle,
  launchImage: launchMatch ? path.resolve(manualDir, launchMatch[1]) : null,
  logo: fs.existsSync(logoPath) ? logoPath : null,
  edition: appVersion,
  buildDate: new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long" }),
  typeface,
})}

\\cleardoublepage
\\begingroup
\\renewcommand{\\cftchapterfont}{\\sffamily\\bfseries\\color{c64ink}}
\\renewcommand{\\cftchapterpagefont}{\\sffamily\\bfseries\\color{c64ink}}
\\renewcommand{\\cftsectionfont}{\\color{c64muted}}
\\renewcommand{\\cftsectionpagefont}{\\color{c64muted}}
\\setlength{\\cftbeforechapterskip}{9pt}
\\settocdepth{section}
\\tableofcontents*
\\endgroup
\\cleardoublepage

\\pagestyle{c64page}
% The index's cross-references. They print no page number, so where they are
% raised does not matter - but it has to be somewhere that still ships a page.
% printindex closes the idx stream before it typesets, so a mark raised after
% the last cleardoublepage is silently dropped.
${indexCrossReferences(placed)}
${dressLatex(texBody, manualDir)}

\\cleardoublepage
\\rotateaccent
\\printindex
\\end{document}
`;

  // makeindex style: letter headings, sans, and no page-number dots.
  await writeFile(
    path.join(outputDir, "index.ist"),
    [
      "headings_flag 1",
      'heading_prefix "  \\\\indexletter{"',
      'heading_suffix "}\\\\nopagebreak\\n"',
      'delim_0 ", "',
      'delim_1 ", "',
      'delim_2 ", "',
      "",
    ].join("\n"),
    "utf8",
  );

  const texFile = path.join(outputDir, `${variant.exportedFileBasename}-manual.tex`);
  await writeFile(texFile, document, "utf8");

  const run = (command, args) =>
    execFileSync(command, args, { cwd: outputDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const latexArgs = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", path.basename(texFile)];
  for (const pass of [1, 2]) {
    try {
      run(engine, latexArgs);
    } catch (error) {
      const log = `${error.stdout ?? ""}`;
      const first = log.split("\n").filter((line) => /^[^\s]+\.tex:\d+:|^! /.test(line))[0];
      throw new Error(`${engine} pass ${pass} failed for ${variant.id}: ${first ?? "see log"}`);
    }
    if (pass === 1) {
      // No `.idx` means the pass laid down no `\index` marks at all, which is a
      // legitimate state for a document with no index. A `.idx` that makeindex
      // then refuses, or a makeindex that is not installed, is not: swallowing
      // that publishes a manual whose index is silently missing.
      const idxFile = `${variant.exportedFileBasename}-manual.idx`;
      if (fs.existsSync(path.join(outputDir, idxFile))) {
        try {
          run("makeindex", ["-q", "-s", "index.ist", idxFile]);
        } catch (error) {
          const detail = `${error.stderr ?? ""}${error.stdout ?? ""}`.trim().split("\n")[0];
          throw new Error(`makeindex failed for ${variant.id}: ${detail || error.message}`);
        }
      }
    }
  }
  run(engine, latexArgs);

  return path.join(outputDir, `${variant.exportedFileBasename}-manual.pdf`);
};

const main = async () => {
  requireToolchain();
  const contexts = await buildManualContexts();
  const outputRoot = path.join(rootDir, "docs/manual/latex");
  await rm(outputRoot, { recursive: true, force: true });

  for (const context of contexts) {
    const outputDir = path.join(outputRoot, context.variant.id);
    await mkdir(outputDir, { recursive: true });
    const pdf = await buildOne(context, outputDir);
    console.log(`Generated ${path.relative(rootDir, pdf)}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
