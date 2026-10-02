/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the merge gate keeps of a run when it is given `--keep-dir`.
 *
 * Without it, every recording goes to `--tmp` under a fixed name and the next run overwrites it, so
 * a failure seen in three runs out of five leaves nothing to look at. With it, each run gets
 * `<keep-dir>/<timestamp>-<host>/`, each stage a directory inside that, and the audio stages also
 * sample the app's own pipeline stats while they measure.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where one run of `stage` keeps its evidence, or null without `--keep-dir`. */
export const keptStageDir = (keepDir, runStamp, host, stage) =>
  keepDir ? path.resolve(keepDir, `${runStamp}-${host}`, stage) : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createGateEvidence = ({ keepDir, host, tmp, cdpPort, repo }) => {
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resolvedKeepDir = keepDir ? path.resolve(repo, keepDir) : "";

  const stageDir = async (stage) => {
    const dir = keptStageDir(resolvedKeepDir, runStamp, host, stage);
    if (dir) await mkdir(dir, { recursive: true });
    return dir;
  };

  /** A recording's path: inside the stage's kept directory when there is one, in `tmp` otherwise. */
  const recordingPath = (dir, name, tmpName) => (dir ? path.join(dir, name) : path.join(tmp, tmpName));

  /**
   * Sample the app's native audio pipeline (`app_audio_stats.mjs`) while `body` runs, when there is a
   * kept directory to put the samples in. The sampler is stopped however `body` ends.
   */
  const withAppAudioStats = async (dir, body) => {
    if (!dir) return body();
    const child = spawn(
      process.execPath,
      [path.join(HERE, "app_audio_stats.mjs"), "--cdp-port", cdpPort, "--out", path.join(dir, "app-audio-stats.json")],
      { cwd: repo, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    child.stdout.on("data", (chunk) => (log += chunk));
    child.stderr.on("data", (chunk) => (log += chunk));
    const exited = new Promise((resolve) => child.on("exit", resolve));
    try {
      return await body();
    } finally {
      child.kill("SIGTERM");
      const stopped = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
      if (!stopped) {
        child.kill("SIGKILL");
        console.error("  WARN the app audio stats sampler ignored SIGTERM and was killed; its file may be partial");
      }
      await writeFile(path.join(dir, "app-audio-stats.log"), log);
      const summary = log
        .trim()
        .split("\n")
        .filter((line) => line.startsWith("app audio stats:"))
        .pop();
      console.log(`  ${summary ?? "app audio stats: the sampler printed no summary, see app-audio-stats.log"}`);
    }
  };

  /** The gate's own result table beside the stage directories. */
  const writeRunSummary = async (summary) => {
    if (!resolvedKeepDir) return;
    const runDir = path.dirname(keptStageDir(resolvedKeepDir, runStamp, host, "gate"));
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "gate.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`kept this run's evidence in ${runDir}`);
  };

  return { stageDir, recordingPath, withAppAudioStats, writeRunSummary };
};
