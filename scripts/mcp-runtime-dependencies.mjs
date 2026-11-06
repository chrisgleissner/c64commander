/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Direct dependencies whose installed version differs from the one package-lock.json pins.
 * A checkout that pulled a dependency bump without reinstalling still has every package present,
 * so a presence check passes and the server then fails at import on the old version's API.
 */
export const findOutdatedDependencies = (packageDir) => {
  const lockPath = path.join(packageDir, "package-lock.json");
  if (!existsSync(lockPath)) return [];
  const lock = readJson(lockPath);
  const root = lock.packages?.[""] ?? {};
  const outdated = [];
  for (const name of Object.keys({ ...root.dependencies, ...root.devDependencies })) {
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (!locked) continue;
    const manifest = path.join(packageDir, "node_modules", name, "package.json");
    const installed = existsSync(manifest) ? readJson(manifest).version : null;
    if (installed !== locked) outdated.push({ name, locked, installed });
  }
  return outdated;
};

/**
 * Installs the package's dependencies when a required one is missing or any direct one differs
 * from the lockfile. The install's output goes to stderr: stdout carries the MCP protocol.
 */
export const ensureRuntimeDependencies = ({ packageDir, label, requiredPackages, env }) => {
  const missing = requiredPackages.filter((segments) => !existsSync(path.join(packageDir, ...segments)));
  const outdated = findOutdatedDependencies(packageDir);
  if (missing.length === 0 && outdated.length === 0) return;

  if (outdated.length > 0) {
    const summary = outdated.map(
      ({ name, locked, installed }) => `${name} ${installed ?? "missing"} (locked ${locked})`,
    );
    console.error(`${label} dependencies differ from package-lock.json: ${summary.join(", ")}; reinstalling`);
  }

  const command = existsSync(path.join(packageDir, "package-lock.json")) ? "ci" : "install";
  const result = spawnSync("npm", [command], { cwd: packageDir, env, stdio: ["ignore", 2, 2] });
  if (result.error) {
    throw new Error(`Failed to install ${label} dependencies: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} dependency install (npm ${command}) exited with status ${result.status ?? 1}`);
  }
  const stillMissing = requiredPackages.filter((segments) => !existsSync(path.join(packageDir, ...segments)));
  const stillOutdated = findOutdatedDependencies(packageDir);
  if (stillMissing.length > 0 || stillOutdated.length > 0) {
    throw new Error(
      `${label} dependencies are still missing or outdated after npm ${command}: ${[
        ...stillMissing.map((segments) => segments.join("/")),
        ...stillOutdated.map(({ name }) => name),
      ].join(", ")}`,
    );
  }
};
