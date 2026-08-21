/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

/**
 * The part of the 7z-wasm module this file touches: its Emscripten in-memory
 * filesystem. Typed structurally so callers keep their own module handle and
 * this file never has to know how the module was built or memoised.
 */
export type SevenZipFileSystem = {
  FS: {
    readdir: (path: string) => string[];
    stat: (path: string) => { mode: number };
    isDir: (mode: number) => boolean;
    mkdir: (path: string) => void;
    rmdir: (path: string) => void;
    unlink: (path: string) => void;
    open: (path: string, flags: string) => unknown;
    write: (stream: unknown, buffer: Uint8Array, offset: number, length: number) => void;
    close: (stream: unknown) => void;
    readFile: (path: string, options: { encoding: "binary" }) => Uint8Array;
  };
};

/** The three paths an extraction works in, all under `workingDir`. */
export type SevenZipScratchPaths = {
  workingDir: string;
  outputDir: string;
  archivePath: string;
};

/** Create the scratch directories and write the archive into `archivePath`. */
export const writeArchiveToScratch = (
  module: SevenZipFileSystem,
  paths: SevenZipScratchPaths,
  buffer: Uint8Array,
): void => {
  module.FS.mkdir(paths.workingDir);
  module.FS.mkdir(paths.outputDir);
  const stream = module.FS.open(paths.archivePath, "w+");
  module.FS.write(stream, buffer, 0, buffer.length);
  module.FS.close(stream);
};

/**
 * Visit every file under `dir`, depth first, with the path it should be
 * reported under. `path` is relative to the starting directory; `fullPath` is
 * where it actually lives in the module filesystem.
 */
export const walkScratchFiles = (
  module: SevenZipFileSystem,
  dir: string,
  visit: (file: { path: string; fullPath: string }) => void,
  prefix = "",
): void => {
  const entries = module.FS.readdir(dir);
  entries.forEach((entry) => {
    if (entry === "." || entry === "..") return;
    const fullPath = `${dir}/${entry}`;
    const stat = module.FS.stat(fullPath);
    if (module.FS.isDir(stat.mode)) {
      walkScratchFiles(module, fullPath, visit, `${prefix}${entry}/`);
      return;
    }
    visit({ path: `${prefix}${entry}`, fullPath });
  });
};

const removeTreeContents = (module: SevenZipFileSystem, dir: string) => {
  const entries = module.FS.readdir(dir);
  entries.forEach((entry) => {
    if (entry === "." || entry === "..") return;
    const fullPath = `${dir}/${entry}`;
    const stat = module.FS.stat(fullPath);
    if (module.FS.isDir(stat.mode)) {
      removeTreeContents(module, fullPath);
      module.FS.rmdir(fullPath);
    } else {
      module.FS.unlink(fullPath);
    }
  });
};

/**
 * Tear the scratch tree down. Each of the four steps is attempted and logged
 * independently, so one that cannot complete — a file the extraction already
 * removed, a directory that was never created because the failure came earlier
 * — does not leave the remaining steps unrun. The module filesystem is a heap
 * allocation that lives as long as the module, so anything left behind is a
 * leak for the rest of the session.
 */
export const removeScratchTree = (module: SevenZipFileSystem, paths: SevenZipScratchPaths): void => {
  const step = (name: string, run: () => void) => {
    try {
      run();
    } catch (error) {
      addErrorLog("SevenZip cleanup failed", { error: (error as Error).message, step: name });
    }
  };
  step("cleanupDir", () => removeTreeContents(module, paths.outputDir));
  step("rmdir-output", () => module.FS.rmdir(paths.outputDir));
  step("unlink-archive", () => module.FS.unlink(paths.archivePath));
  step("rmdir-workdir", () => module.FS.rmdir(paths.workingDir));
};
