#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const usage = () => {
  const message = `
Usage:
  node scripts/merge-files.mjs [options] <fileOrDir...>

Options:
  -d, --dir <path>       Directory to merge (can be used multiple times)
  -r, --recursive        Include subdirectories when a directory is provided
  -o, --output <path>    Write merged output to file (default: stdout)
  -h, --help             Show this help

Examples:
  node scripts/merge-files.mjs src/fileA.ts src/fileB.ts
  node scripts/merge-files.mjs --dir src/pages --recursive -o merged.txt
  node scripts/merge-files.mjs src/pages
`;
  process.stdout.write(message);
};

const normalizeDisplayPath = (filePath) => path.relative(process.cwd(), filePath).split(path.sep).join('/');

const collectFilesFromDir = async (dirPath, recursive) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...await collectFilesFromDir(fullPath, true));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const parseArgs = (argv) => {
  const options = {
    dirs: [],
    recursive: false,
    output: null,
    paths: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      break;
    }
    if (arg === '-r' || arg === '--recursive') {
      options.recursive = true;
      continue;
    }
    if (arg === '-d' || arg === '--dir') {
      const dir = argv[i + 1];
      if (!dir) throw new Error('Missing value for --dir');
      options.dirs.push(dir);
      i += 1;
      continue;
    }
    if (arg === '-o' || arg === '--output') {
      const output = argv[i + 1];
      if (!output) throw new Error('Missing value for --output');
      options.output = output;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.paths.push(arg);
  }

  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const inputs = [...options.paths, ...options.dirs];
  if (!inputs.length) {
    usage();
    process.exitCode = 1;
    return;
  }

  const outputPath = options.output ? path.resolve(options.output) : null;
  const fileSet = new Set();

  for (const input of inputs) {
    const resolved = path.resolve(input);
    const stats = await fs.stat(resolved).catch(() => null);
    if (!stats) {
      throw new Error(`Path not found: ${input}`);
    }
    if (stats.isDirectory()) {
      const files = await collectFilesFromDir(resolved, options.recursive);
      files.forEach((file) => fileSet.add(file));
      continue;
    }
    if (stats.isFile()) {
      fileSet.add(resolved);
      continue;
    }
    throw new Error(`Unsupported path type: ${input}`);
  }

  if (outputPath) {
    fileSet.delete(outputPath);
  }

  const files = Array.from(fileSet).sort((a, b) => normalizeDisplayPath(a).localeCompare(normalizeDisplayPath(b)));
  if (!files.length) {
    throw new Error('No files found to merge.');
  }

  let merged = '';
  for (const filePath of files) {
    const displayName = normalizeDisplayPath(filePath);
    const contents = await fs.readFile(filePath, 'utf8');
    merged += `===== BEGIN ${displayName} =====\n`;
    merged += contents;
    if (!contents.endsWith('\n')) {
      merged += '\n';
    }
    merged += `===== END ${displayName} =====\n\n`;
  }

  if (outputPath) {
    await fs.writeFile(outputPath, merged, 'utf8');
    return;
  }

  process.stdout.write(merged);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
