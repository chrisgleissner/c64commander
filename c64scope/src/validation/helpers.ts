import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function adb(serial: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("adb", ["-s", serial, ...args]);
  return stdout;
}

export async function c64uGet(host: string, endpoint: string): Promise<string> {
  const { stdout } = await execFileAsync("curl", ["-fsS", "--connect-timeout", "5", `http://${host}${endpoint}`]);
  return stdout;
}

export async function c64uFtpList(host: string, ftpPath: string): Promise<string> {
  const { stdout } = await execFileAsync("curl", ["-fsS", "--connect-timeout", "5", `ftp://${host}${ftpPath}`]);
  return stdout;
}

export async function takeScreenshot(serial: string, localPath: string): Promise<void> {
  // Retry once on transient ADB failure (device busy)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await adb(serial, "shell", "screencap", "-p", "/data/local/tmp/c64s.png");
      await execFileAsync("adb", ["-s", serial, "pull", "/data/local/tmp/c64s.png", localPath]);
      await adb(serial, "shell", "rm", "/data/local/tmp/c64s.png");
      return;
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function captureLogcat(serial: string, localPath: string, lines: number = 200): Promise<string> {
  const logcat = await adb(serial, "logcat", "-d", "-t", String(lines), "--format", "threadtime");
  await writeFile(localPath, logcat, "utf-8");
  return logcat;
}

export function ts(): string {
  return new Date().toISOString();
}

/** Launch the C64 Commander app on the Android device and wait for it to start. */
export async function launchApp(serial: string): Promise<void> {
  await adb(serial, "shell", "am", "start", "-n", "uk.gleissner.c64commander/.MainActivity");
  // Give the app time to fully render
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

/** Check whether C64 Commander is the foreground activity. */
export async function isAppInForeground(serial: string): Promise<boolean> {
  const dump = await adb(serial, "shell", "dumpsys", "activity", "activities");
  // Look for our activity in the mResumedActivity line
  return dump.includes("uk.gleissner.c64commander");
}

/**
 * Upload a PRG binary to the C64 Ultimate and run it.
 * Uses POST /v1/runners:run_prg with Content-Type: application/octet-stream.
 */
export async function runPrgOnC64u(host: string, prg: Buffer): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `http://${host}/v1/runners:run_prg`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(prg),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Read C64 memory via DMA through the C64U REST API.
 * GET /v1/machine:readmem?address=XXXX&length=N → binary data
 */
export async function readC64Memory(host: string, address: number, length: number): Promise<Uint8Array> {
  const addrHex = address.toString(16).toUpperCase().padStart(4, "0");
  const url = `http://${host}/v1/machine:readmem?address=${addrHex}&length=${length}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`readmem failed: ${resp.status} ${resp.statusText}`);
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}
