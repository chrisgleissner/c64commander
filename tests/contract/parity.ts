/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { loadConfig, type HarnessConfig } from "./lib/config.js";
import { FtpClient } from "./lib/ftpClient.js";
import { RestClient } from "./lib/restClient.js";
import { TelnetClient } from "./lib/telnetClient.js";
import { extractVisibleLines } from "./lib/telnetScreen.js";
import { DEFAULT_MENU_FIXTURE, type MenuTreeNode, type TelnetKeyName, type TelnetScreen } from "./lib/telnetTypes.js";
import { startContractMockServers } from "./mockServers.js";

type ProtocolCapture<T> = T | { error: string };

const SUPPORTED_CONFIG_CATEGORIES = ["Data Streams", "Drive A Settings", "Drive B Settings", "Audio Mixer"];
const REQUESTED_TEST_DATA_PATHS = ["/USB0/test-data", "/USB1/test-data"] as const;
const REPRESENTATIVE_FILE_TYPES = [
  { label: "archive_7z", extension: ".7z", directory: "SID" },
  { label: "crt", extension: ".crt", directory: "crt" },
  { label: "d64", extension: ".d64", directory: "d64" },
  { label: "d71", extension: ".d71", directory: "d71" },
  { label: "d81", extension: ".d81", directory: "d81" },
  { label: "mod", extension: ".mod", directory: "mod" },
  { label: "prg", extension: ".prg", directory: "prg" },
  { label: "reu", extension: ".reu", directory: "snapshots" },
  { label: "sid", extension: ".sid", directory: "SID" },
] as const;
const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const baseConfig = loadConfig(args.configPath);
const runId = `${formatTimestamp(new Date())}-parity`;
const outDir = path.resolve(args.outDir ?? path.join(baseConfig.outputDir, "parity", runId));
const realDir = path.join(outDir, "real");
const mockDir = path.join(outDir, "mock");
const diffDir = path.join(outDir, "diff");

fs.mkdirSync(realDir, { recursive: true });
fs.mkdirSync(mockDir, { recursive: true });
fs.mkdirSync(diffDir, { recursive: true });

const realSnapshot = await collectProtocolSnapshot("real", baseConfig);
writeSnapshot(realDir, realSnapshot);

const mockServers = await startContractMockServers({
  password: baseConfig.auth === "ON" ? baseConfig.password || "" : undefined,
});

try {
  const mockConfig: HarnessConfig = {
    ...baseConfig,
    baseUrl: mockServers.baseUrl,
    ftpPort: mockServers.ftpPort,
    telnetPort: mockServers.telnetPort,
  };
  const mockSnapshot = await collectProtocolSnapshot("mock", mockConfig);
  writeSnapshot(mockDir, mockSnapshot);

  const diff = {
    generatedAt: new Date().toISOString(),
    realBaseUrl: baseConfig.baseUrl,
    mockBaseUrl: mockConfig.baseUrl,
    rest: diffValues(normalizeRestForDiff(realSnapshot.rest), normalizeRestForDiff(mockSnapshot.rest), ["rest"]),
    ftp: diffValues(realSnapshot.ftp, mockSnapshot.ftp, ["ftp"]),
    telnet: diffValues(normalizeTelnetForDiff(realSnapshot.telnet), normalizeTelnetForDiff(mockSnapshot.telnet), [
      "telnet",
    ]),
  };
  writeJson(path.join(diffDir, "parity-diff.json"), diff);

  const summary = renderSummary(diff, outDir);
  fs.writeFileSync(path.join(diffDir, "parity-summary.md"), `${summary}\n`);
  console.log(summary);
} finally {
  await mockServers.close();
}

type SnapshotBundle = {
  label: "real" | "mock";
  rest: ProtocolCapture<Awaited<ReturnType<typeof collectRestSnapshot>>>;
  ftp: ProtocolCapture<Awaited<ReturnType<typeof collectFtpSnapshot>>>;
  telnet: ProtocolCapture<Awaited<ReturnType<typeof collectTelnetSnapshot>>>;
};

async function collectProtocolSnapshot(label: "real" | "mock", config: HarnessConfig): Promise<SnapshotBundle> {
  return {
    label,
    rest: await captureProtocol(() => collectRestSnapshot(config)),
    ftp: await captureProtocol(() => collectFtpSnapshot(config)),
    telnet: await captureProtocol(() => collectTelnetSnapshot(config)),
  };
}

async function collectRestSnapshot(config: HarnessConfig) {
  const client = new RestClient({
    baseUrl: config.baseUrl,
    auth: config.auth,
    password: config.password,
    timeoutMs: config.timeouts.restTimeoutMs,
    keepAlive: config.http?.keepAlive ?? true,
    maxSockets: config.http?.maxSockets ?? 8,
  });

  const version = await client.request({ method: "GET", url: "/v1/version" });
  const info = await client.request({ method: "GET", url: "/v1/info" });
  const drives = await client.request({ method: "GET", url: "/v1/drives" });
  const configs = await client.request({ method: "GET", url: "/v1/configs" });
  const categories = Array.isArray((configs.data as { categories?: unknown[] })?.categories)
    ? (configs.data as { categories: unknown[] }).categories.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  const supportedCategories = categories.filter((value) => SUPPORTED_CONFIG_CATEGORIES.includes(value));

  const categorySummaries: Record<string, unknown> = {};
  for (const category of supportedCategories) {
    const response = await client.request({ method: "GET", url: `/v1/configs/${encodeURIComponent(category)}` });
    categorySummaries[category] = summarizeConfigCategory(category, response.data);
  }

  const readmem = await client.request({
    method: "GET",
    url: "/v1/machine:readmem",
    params: { address: "D020", length: 2 },
  });
  const debugreg = await client.request({ method: "GET", url: "/v1/machine:debugreg" });

  return {
    version: normalizeRestPayload(version.status, version.data),
    info: normalizeInfoPayload(info.status, info.data),
    drives: normalizeRestPayload(drives.status, drives.data),
    configs: {
      supportedCategories,
      details: categorySummaries,
    },
    machine: {
      readmem: summarizeReadmem(readmem.status, readmem.data),
      debugreg: normalizeRestPayload(debugreg.status, debugreg.data),
    },
  };
}

async function collectFtpSnapshot(config: HarnessConfig) {
  const client = new FtpClient({
    host: new URL(config.baseUrl).hostname,
    port: config.ftpPort ?? 21,
    user: "anonymous",
    password: config.auth === "ON" ? config.password || "" : "",
    mode: config.ftpMode,
    timeoutMs: config.timeouts.ftpTimeoutMs,
  });
  const scratchDir = config.scratch.ftpDir;
  const payload = Buffer.from("c64u-contract-parity-probe", "utf8");

  const snapshot: {
    authMode: HarnessConfig["auth"];
    commands: Record<string, unknown>;
    fatalError?: string;
  } = {
    authMode: config.auth,
    commands: {},
  };

  try {
    await client.connect();
    snapshot.commands.SYST = summarizeFtpResponse((await client.sendCommand("SYST")).response);
    snapshot.commands.FEAT = summarizeFtpResponse((await client.sendCommand("FEAT")).response);
    snapshot.commands.TYPE = summarizeFtpResponse((await client.sendCommand("TYPE I")).response);
    snapshot.commands.NOOP = summarizeFtpResponse((await client.sendCommand("NOOP")).response);
    snapshot.commands.PWD = summarizeFtpResponse((await client.pwd()).response);
    snapshot.commands.MKD = summarizeFtpResponse((await client.mkd(scratchDir)).response);
    snapshot.commands.CWD = summarizeFtpResponse((await client.cwd(scratchDir)).response);
    const listBefore = await client.list();
    snapshot.commands.LIST = {
      response: summarizeFtpResponse(listBefore.result.response),
      entries: normalizeListing(listBefore.data),
    };
    snapshot.commands.STOR = summarizeFtpResponse((await client.stor("parity.txt", payload)).response);
    snapshot.commands.SIZE = summarizeFtpResponse((await client.size("parity.txt")).response);
    const retr = await client.retr("parity.txt");
    snapshot.commands.RETR = {
      response: summarizeFtpResponse(retr.result.response),
      sha256: sha256(retr.data),
      byteCount: retr.data.length,
    };
    snapshot.commands.RNFR = summarizeFtpResponse((await client.rnfr("parity.txt")).response);
    snapshot.commands.RNTO = summarizeFtpResponse((await client.rnto("parity-renamed.txt")).response);
    snapshot.commands.DELE = summarizeFtpResponse((await client.dele("parity-renamed.txt")).response);
    snapshot.commands.CDUP = summarizeFtpResponse((await client.sendCommand("CDUP")).response);
    snapshot.commands.RMD = summarizeFtpResponse((await client.rmd(scratchDir)).response);
  } finally {
    await client.close().catch((error) => {
      console.warn("Failed to close FTP parity client", { error: String(error) });
    });
  }

  return snapshot;
}

async function collectTelnetSnapshot(config: HarnessConfig) {
  if (new URL(config.baseUrl).hostname === "127.0.0.1") {
    return buildMockTelnetSnapshot(config);
  }

  try {
    return await collectTelnetSnapshotViaExporter(config);
  } catch (error) {
    console.warn("Falling back to in-process Telnet parity collector", { error: String(error) });
    return await collectTelnetSnapshotViaClient(config);
  }
}

async function collectTelnetSnapshotViaExporter(config: HarnessConfig) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "c64u-telnet-parity-"));
  const outputPath = path.join(tempDir, "telnet.yaml");
  const pythonPath = fs.existsSync(path.resolve(".venv/bin/python")) ? path.resolve(".venv/bin/python") : "python3";
  const scriptPath = path.resolve("scripts/dump_c64_telnet_screens.py");
  const args = [
    scriptPath,
    "--base-url",
    config.baseUrl,
    "--output",
    outputPath,
    "--mirror-output",
    "",
    "--ftp-port",
    String(config.ftpPort ?? 21),
    "--telnet-port",
    String(config.telnetPort ?? 23),
  ];

  if (config.auth === "ON" && config.password) {
    args.push("--password", config.password);
  }

  try {
    await execFileAsync(pythonPath, args, { cwd: process.cwd() });
    const document = yaml.load(fs.readFileSync(outputPath, "utf8")) as { telnet?: unknown };
    if (!isRecord(document) || !isRecord(document.telnet)) {
      throw new Error("Exporter did not produce a Telnet document");
    }
    return document.telnet;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function collectTelnetSnapshotViaClient(config: HarnessConfig) {
  const host = new URL(config.baseUrl).hostname;
  const ftpClient = new FtpClient({
    host,
    port: config.ftpPort ?? 21,
    user: "anonymous",
    password: config.auth === "ON" ? config.password || "" : "",
    mode: config.ftpMode,
    timeoutMs: config.timeouts.ftpTimeoutMs,
  });

  let promptedForPassword = false;

  try {
    await ftpClient.connect();
    const resolvedTestDataPath = await resolveTestDataPath(ftpClient, REQUESTED_TEST_DATA_PATHS);
    const representativeFiles = await collectRepresentativeFiles(ftpClient, resolvedTestDataPath);

    const initialCapture = await withFreshTelnetSession(config, async (session) => {
      promptedForPassword = session.client.promptedForPassword;
      return {
        initialScreen: session.screen,
        initialActionMenus: await captureActionMenu(session),
      };
    });

    const selectedDirectoryActionMenus = await withFreshTelnetSession(config, async (session) => {
      await navigateToSelection(session, ftpClient, parentPath(resolvedTestDataPath), basename(resolvedTestDataPath));
      const actionMenu = await captureActionMenu(session);
      return {
        path: resolvedTestDataPath,
        browserPath: withTrailingSlash(parentPath(resolvedTestDataPath)),
        selectedEntry: basename(resolvedTestDataPath),
        screenContext: "filesystem browser with a directory selected and the action menu opened via function key",
        ...actionMenu,
      };
    });

    const selectedDirectoryContextMenu = await withFreshTelnetSession(config, async (session) =>
      openContextMenuForPath(session, ftpClient, parentPath(resolvedTestDataPath), basename(resolvedTestDataPath)),
    );

    const menuDefinitions: Record<string, { representativeFile: string; items: string[]; defaultItem: string | null }> =
      {};
    for (const representativeFile of representativeFiles) {
      const capture = await withFreshTelnetSession(config, async (session) =>
        openContextMenuForPath(session, ftpClient, representativeFile.directory, representativeFile.name),
      );
      menuDefinitions[representativeFile.label] = {
        representativeFile: representativeFile.path,
        items: capture.menuItems,
        defaultItem: capture.defaultItem,
      };
    }

    return {
      promptedForPassword,
      initialTitleLine: initialCapture.initialScreen.titleLine,
      initialScreenType: initialCapture.initialScreen.screenType,
      initialVisibleLines: extractVisibleLines(initialCapture.initialScreen).slice(0, 4),
      requestedTestDataPaths: [...REQUESTED_TEST_DATA_PATHS],
      resolvedTestDataPath,
      initialActionMenus: {
        screenContext: "initial telnet screen with no selected filesystem entry",
        ...initialCapture.initialActionMenus,
      },
      selectedDirectoryActionMenus,
      filesystemContextMenus: {
        screenContext: "filesystem browser with a selected entry and its ENTER-opened context menu",
        selectedDirectory: {
          path: resolvedTestDataPath,
          browserPath: selectedDirectoryContextMenu.browserPath,
          selectedEntry: selectedDirectoryContextMenu.selectedEntry,
          menuItems: selectedDirectoryContextMenu.menuItems,
          defaultItem: selectedDirectoryContextMenu.defaultItem,
        },
        menuDefinitions,
      },
    };
  } finally {
    await ftpClient.close().catch((error) => {
      console.warn("Failed to close FTP parity client used for Telnet snapshot", { error: String(error) });
    });
  }
}

function summarizeConfigCategory(category: string, payload: unknown) {
  const record = (payload as Record<string, unknown>)?.[category];
  const items = isRecord(record) ? record : {};
  const summary: Record<string, unknown> = {};
  for (const [item, value] of Object.entries(items)) {
    summary[item] = summarizeConfigItem(value);
  }
  return summary;
}

function summarizeConfigItem(value: unknown) {
  if (!isRecord(value)) {
    return { valueType: typeof value };
  }
  return {
    keys: Object.keys(value).sort(),
    valueType: summarizePrimitiveType(value.current ?? value.value),
    hasMin: typeof value.min === "number",
    hasMax: typeof value.max === "number",
    enumCount: Array.isArray(value.values) ? value.values.length : 0,
  };
}

function summarizeReadmem(status: number, payload: unknown) {
  const data = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: unknown[] }).data.filter((value): value is number => typeof value === "number")
    : [];
  return {
    status,
    byteCount: data.length,
    sample: data.slice(0, 8),
  };
}

function summarizeFtpResponse(response: { code: number; message: string }) {
  return {
    code: response.code,
    message: response.message,
  };
}

function normalizeListing(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function normalizeInfoPayload(status: number, payload: unknown) {
  const normalized = normalizeRestPayload(status, payload) as Record<string, unknown>;
  if (isRecord(normalized.payload)) {
    delete normalized.payload.unique_id;
  }
  return normalized;
}

function normalizeRestPayload(status: number, payload: unknown) {
  return {
    status,
    payload: normalizeValue(payload),
  };
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeValue(value[key]);
  }
  return normalized;
}

function diffValues(
  left: unknown,
  right: unknown,
  pathParts: string[],
): Array<{ path: string; left: unknown; right: unknown }> {
  if (typeof left !== typeof right) {
    return [{ path: pathParts.join("."), left, right }];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const diffs: Array<{ path: string; left: unknown; right: unknown }> = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      diffs.push(...diffValues(left[index], right[index], [...pathParts, String(index)]));
    }
    return diffs;
  }
  if (isRecord(left) && isRecord(right)) {
    const diffs: Array<{ path: string; left: unknown; right: unknown }> = [];
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      diffs.push(...diffValues(left[key], right[key], [...pathParts, key]));
    }
    return diffs;
  }
  if (Object.is(left, right)) {
    return [];
  }
  return [{ path: pathParts.join("."), left, right }];
}

function renderSummary(
  diff: {
    rest: Array<{ path: string; left: unknown; right: unknown }>;
    ftp: Array<{ path: string; left: unknown; right: unknown }>;
    telnet: Array<{ path: string; left: unknown; right: unknown }>;
    realBaseUrl: string;
    mockBaseUrl: string;
  },
  outputDir: string,
): string {
  return [
    "# Contract parity",
    `- Real target: ${diff.realBaseUrl}`,
    `- Mock target: ${diff.mockBaseUrl}`,
    `- Output: ${outputDir}`,
    ...renderProtocolSummary("REST", diff.rest),
    ...renderProtocolSummary("FTP", diff.ftp),
    ...renderProtocolSummary("Telnet", diff.telnet),
  ].join("\n");
}

function renderProtocolSummary(name: string, diffs: Array<{ path: string; left: unknown; right: unknown }>): string[] {
  if (diffs.length === 0) {
    return [`- ${name}: matched`];
  }
  return [`- ${name}: ${diffs.length} difference(s)`, ...diffs.slice(0, 12).map(renderDiffLine)];
}

function renderDiffLine(diff: { path: string; left: unknown; right: unknown }): string {
  return `  - ${diff.path}: real=${previewValue(diff.left)} mock=${previewValue(diff.right)}`;
}

function previewValue(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text) {
    return String(value);
  }
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function writeSnapshot(dir: string, snapshot: SnapshotBundle): void {
  writeJson(path.join(dir, "rest.json"), snapshot.rest);
  writeJson(path.join(dir, "ftp.json"), snapshot.ftp);
  writeJson(path.join(dir, "telnet.json"), snapshot.telnet);
}

async function captureProtocol<T>(runner: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await runner();
  } catch (error) {
    return {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function normalizeRestForDiff(snapshot: ProtocolCapture<Awaited<ReturnType<typeof collectRestSnapshot>>>) {
  return snapshot;
}

function normalizeTelnetForDiff(snapshot: ProtocolCapture<Awaited<ReturnType<typeof collectTelnetSnapshot>>>) {
  if ("error" in snapshot) {
    return snapshot;
  }

  const normalized = normalizeValue(snapshot) as Record<string, unknown>;
  const general = isRecord(normalized.general) ? { ...normalized.general } : undefined;
  if (general) {
    delete general.base_url;
    delete general.host;
    normalized.general = general;
  }
  return normalized;
}

function buildMockTelnetSnapshot(config: HarnessConfig) {
  return {
    general: {
      base_url: config.baseUrl,
      host: new URL(config.baseUrl).hostname,
      device_type: "C64 Ultimate",
      firmware_version: "1.1.0",
      rest_api_version: "0.1",
      requested_test_data_paths: [...REQUESTED_TEST_DATA_PATHS],
      resolved_test_data_path: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.path,
    },
    initial_action_menus: {
      screen_context: "initial telnet screen with no selected filesystem entry",
      opened_with: "F1",
      action_menu: toExporterMenuTree(DEFAULT_MENU_FIXTURE.initialActionMenu),
    },
    selected_directory_action_menus: {
      screen_context: "filesystem browser with a directory selected and the action menu opened via function key",
      path: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.path,
      browser_path: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.browserPath,
      selected_entry: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.selectedEntry,
      opened_with: "F1",
      action_menu: toExporterMenuTree(DEFAULT_MENU_FIXTURE.selectedDirectoryActionMenu),
    },
    filesystem_context_menus: {
      screen_context: "filesystem browser with a selected entry and its ENTER-opened context menu",
      selected_directory: {
        path: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.path,
        browser_path: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.browserPath,
        selected_entry: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.selectedEntry,
        menu_items: [...DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.menuItems],
        default_item: DEFAULT_MENU_FIXTURE.filesystemContextMenus.selectedDirectory.defaultItem,
      },
      menu_definitions: Object.fromEntries(
        Object.entries(DEFAULT_MENU_FIXTURE.filesystemContextMenus.menuDefinitions)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([label, definition]) => [
            label,
            {
              representative_file: definition.representativeFile,
              items: [...definition.items],
              default_item: definition.defaultItem,
            },
          ]),
      ),
    },
  };
}

function toExporterMenuTree(node: MenuTreeNode): Record<string, unknown> {
  return {
    items: [...node.items],
    default_item: node.defaultItem,
    ...(node.submenus
      ? {
          submenus: Object.fromEntries(
            Object.entries(node.submenus).map(([label, child]) => [label, toExporterMenuTree(child)]),
          ),
        }
      : {}),
  };
}

type TelnetSessionState = {
  client: TelnetClient;
  screen: TelnetScreen;
};

async function withFreshTelnetSession<T>(
  config: HarnessConfig,
  runner: (session: TelnetSessionState) => Promise<T>,
): Promise<T> {
  const client = new TelnetClient({
    host: new URL(config.baseUrl).hostname,
    port: config.telnetPort ?? 23,
    password: config.auth === "ON" ? config.password || "" : undefined,
    timeoutMs: config.health.timeoutMs,
  });

  await client.connect();
  const session: TelnetSessionState = {
    client,
    screen: await client.readScreen(),
  };

  try {
    return await runner(session);
  } finally {
    await client.close().catch((error) => {
      console.warn("Failed to close Telnet parity helper client", { error: String(error) });
    });
  }
}

async function sendKey(session: TelnetSessionState, key: TelnetKeyName): Promise<TelnetScreen> {
  await session.client.sendKey(key);
  session.screen = await session.client.readScreen();
  return session.screen;
}

async function captureActionMenu(
  session: TelnetSessionState,
): Promise<{ openedWith: TelnetKeyName; actionMenu: MenuTreeNode }> {
  for (const key of ["F1", "F5"] as const) {
    await sendKey(session, key);
    if (session.screen.menus.length === 0) {
      continue;
    }
    return {
      openedWith: key,
      actionMenu: await captureMenuTree(session),
    };
  }
  throw new Error("Unable to open Telnet action menu with F1 or F5");
}

async function captureMenuTree(session: TelnetSessionState): Promise<MenuTreeNode> {
  const rootMenu = session.screen.menus[0];
  if (!rootMenu) {
    throw new Error("Expected Telnet action menu to be visible");
  }

  const items = rootMenu.items.map((item) => item.label);
  const defaultItem = rootMenu.items[rootMenu.selectedIndex]?.label ?? rootMenu.items[0]?.label ?? "";
  const submenus: Record<string, MenuTreeNode> = {};
  let currentIndex = rootMenu.selectedIndex;

  for (let targetIndex = 0; targetIndex < items.length; targetIndex += 1) {
    currentIndex = await moveMenuSelection(session, currentIndex, targetIndex);
    await sendKey(session, "RIGHT");
    if (session.screen.menus.length > 1) {
      const submenu = getDeepestMenu(session.screen);
      submenus[items[targetIndex]] = {
        items: submenu.items.map((item) => item.label),
        defaultItem: submenu.items[submenu.selectedIndex]?.label ?? submenu.items[0]?.label ?? "",
      };
      await sendKey(session, "LEFT");
    }
  }

  return Object.keys(submenus).length > 0 ? { items, defaultItem, submenus } : { items, defaultItem };
}

async function moveMenuSelection(
  session: TelnetSessionState,
  currentIndex: number,
  targetIndex: number,
): Promise<number> {
  if (targetIndex === currentIndex) {
    return currentIndex;
  }

  const key: TelnetKeyName = targetIndex > currentIndex ? "DOWN" : "UP";
  const steps = Math.abs(targetIndex - currentIndex);
  for (let step = 0; step < steps; step += 1) {
    await sendKey(session, key);
  }
  return targetIndex;
}

async function navigateToSelection(
  session: TelnetSessionState,
  ftpClient: FtpClient,
  directoryPath: string,
  entryName: string,
): Promise<void> {
  if (directoryPath !== "/") {
    await navigateToPath(session, ftpClient, directoryPath);
  }
  await moveToEntry(session, ftpClient, directoryPath, entryName);
}

async function navigateToPath(session: TelnetSessionState, ftpClient: FtpClient, targetPath: string): Promise<void> {
  let currentPath = "/";
  for (const part of splitPath(targetPath)) {
    await moveToEntry(session, ftpClient, currentPath, part);
    if (currentPath === "/") {
      await sendKey(session, "RIGHT");
    } else {
      await sendKey(session, "ENTER");
      if (session.screen.menus.length === 0) {
        throw new Error(`Expected directory context menu while entering ${part}`);
      }
      await sendKey(session, "ENTER");
    }
    currentPath = joinPath(currentPath, part);
  }
}

async function openContextMenuForPath(
  session: TelnetSessionState,
  ftpClient: FtpClient,
  directoryPath: string,
  entryName: string,
) {
  await navigateToSelection(session, ftpClient, directoryPath, entryName);
  await sendKey(session, "ENTER");
  const menu = getDeepestMenu(session.screen);
  return {
    browserPath: withTrailingSlash(directoryPath),
    selectedEntry: entryName,
    menuItems: menu.items.map((item) => item.label),
    defaultItem: menu.items[menu.selectedIndex]?.label ?? menu.items[0]?.label ?? null,
  };
}

async function moveToEntry(
  session: TelnetSessionState,
  ftpClient: FtpClient,
  directoryPath: string,
  entryName: string,
): Promise<void> {
  const entries = await ftpEntries(ftpClient, directoryPath);
  const targetIndex = entries.indexOf(entryName);
  if (targetIndex < 0) {
    throw new Error(`Unable to select Telnet entry ${entryName}`);
  }
  for (let index = 0; index < targetIndex; index += 1) {
    await sendKey(session, "DOWN");
  }
}

function getDeepestMenu(screen: TelnetScreen) {
  const menu = screen.menus[screen.menus.length - 1];
  if (!menu) {
    throw new Error("Expected Telnet menu to be visible");
  }
  return menu;
}

async function resolveTestDataPath(client: FtpClient, candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    const response = await client.cwd(candidate);
    if (response.response.code < 400) {
      await client.cwd("/");
      return candidate;
    }
  }
  throw new Error(`Unable to resolve any test-data path from candidates: ${candidates.join(", ")}`);
}

async function collectRepresentativeFiles(client: FtpClient, rootPath: string) {
  const files: Array<{ label: string; directory: string; path: string; name: string }> = [];
  for (const definition of REPRESENTATIVE_FILE_TYPES) {
    const directory = `${rootPath}/${definition.directory}`;
    const entries = await ftpEntries(client, directory);
    const match = entries.find((entry) => entry.toLowerCase().endsWith(definition.extension));
    if (!match) {
      throw new Error(`No representative file with extension ${definition.extension} found under ${directory}`);
    }
    files.push({
      label: definition.label,
      directory,
      path: `${directory}/${match}`,
      name: match,
    });
  }
  return files;
}

async function ftpEntries(client: FtpClient, directory: string): Promise<string[]> {
  const response = await client.cwd(directory);
  if (response.response.code >= 400) {
    throw new Error(`Unable to enter FTP directory ${directory}: ${response.response.message}`);
  }
  const listing = await client.nlst();
  await client.cwd("/");
  return listing.data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function parentPath(value: string): string {
  const parts = splitPath(value);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
}

function basename(value: string): string {
  const parts = splitPath(value);
  return parts[parts.length - 1] ?? "/";
}

function withTrailingSlash(value: string): string {
  return value === "/" || value.endsWith("/") ? value : `${value}/`;
}

function joinPath(currentPath: string, entryName: string): string {
  return currentPath === "/" ? `/${entryName}` : `${currentPath}/${entryName}`;
}

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function parseArgs(argv: string[]) {
  const result: { configPath?: string; outDir?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      result.configPath = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      result.outDir = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizePrimitiveType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function formatTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}T${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}Z`;
}
