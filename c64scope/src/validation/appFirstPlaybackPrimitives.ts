/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dumpUiHierarchy } from "./helpers.js";
import {
  checkboxTapPointForLabel,
  findFirstNodeByClass,
  findTopmostVisibleText,
  findVisibleText,
  findVisibleTextContaining,
  parseBoundsCenter,
  parseUiNodes,
} from "./appFirstUi.js";
import { tapByResourceId, tapByText, tapByTextContaining } from "./appFirstPrimitives.js";
import { DroidmindClient } from "./droidmindClient.js";

const SOURCE_OPTION_RESOURCE_IDS: Record<string, string> = {
  c64u: "import-option-c64u",
  "c64 ultimate": "import-option-c64u",
  "commodore 64 ultimate": "import-option-c64u",
  local: "import-option-local",
  hvsc: "import-option-hvsc",
};

const SOURCE_OPTION_TEXT_CANDIDATES: Record<string, readonly string[]> = {
  c64u: ["Add file / folder from C64U", "Add file / folder from C64 Ultimate", "C64 Ultimate", "C64U"],
  "c64 ultimate": ["Add file / folder from C64U", "Add file / folder from C64 Ultimate", "C64 Ultimate", "C64U"],
  "commodore 64 ultimate": [
    "Add file / folder from C64U",
    "Add file / folder from C64 Ultimate",
    "C64 Ultimate",
    "C64U",
  ],
  local: ["Add file / folder from Local", "Local"],
  hvsc: ["Add file / folder from HVSC", "HVSC"],
};
const SOURCE_OPTION_REVEAL_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPickerPathFromNodes(nodes: ReturnType<typeof parseUiNodes>): string | null {
  const pathNode = findVisibleTextContaining(nodes, "Path:");
  if (!pathNode) {
    return null;
  }

  const rawLabel = (pathNode.text || pathNode.contentDesc).trim();
  if (!rawLabel.toLowerCase().startsWith("path:")) {
    return null;
  }
  return normalizePath(rawLabel.slice("Path:".length));
}

function c64uPickerLooksReady(nodes: ReturnType<typeof parseUiNodes>): boolean {
  return (
    readPickerPathFromNodes(nodes) !== null ||
    findVisibleText(nodes, "Select items") !== null ||
    readSelectedCount(nodes) !== null ||
    findVisibleText(nodes, "Filter files…") !== null ||
    findVisibleText(nodes, "Filter files...") !== null
  );
}

function readSelectedCount(nodes: ReturnType<typeof parseUiNodes>): number | null {
  const selectedNode = findVisibleTextContaining(nodes, "selected");
  if (!selectedNode) {
    return null;
  }
  const label = (selectedNode.text || selectedNode.contentDesc).trim();
  const match = label.match(/^(\d+)\s+selected$/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] ?? "", 10);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function joinPath(basePath: string, segment: string): string {
  const normalizedBase = normalizePath(basePath);
  const trimmedSegment = segment.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmedSegment) {
    return normalizedBase;
  }
  return normalizedBase === "/" ? `/${trimmedSegment}` : `${normalizedBase}/${trimmedSegment}`;
}

function currentPathAlreadyAtSegment(currentPath: string, segment: string): boolean {
  const normalizedCurrentPath = normalizePath(currentPath);
  const normalizedSegment = segment.trim().replace(/^\/+|\/+$/g, "");
  if (!normalizedSegment) {
    return true;
  }
  const currentSegments = normalizedCurrentPath.split("/").filter(Boolean);
  return currentSegments.at(-1) === normalizedSegment;
}

async function readPickerPath(serial: string): Promise<string | null> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  return readPickerPathFromNodes(nodes);
}

async function waitForPickerPath(
  serial: string,
  expectedPath: string,
  retries: number,
  delayMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const observedPath = await readPickerPath(serial);
    if (observedPath === expectedPath) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function waitForC64UPickerReady(serial: string, retries: number, delayMs: number): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const xml = await dumpUiHierarchy(serial);
    const nodes = parseUiNodes(xml);
    if (c64uPickerLooksReady(nodes)) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function swipePickerContents(client: DroidmindClient, serial: string): Promise<void> {
  await client.swipe(serial, 540, 1620, 540, 1080, 260);
  await sleep(300);
}

async function dismissConnectionStatusOverlay(client: DroidmindClient, serial: string): Promise<void> {
  const closed =
    (await tapByResourceId(client, serial, "connection-status-close")) || (await tapByText(client, serial, "Close"));

  if (closed) {
    await sleep(400);
  }
}

export async function openAddItemsDialog(client: DroidmindClient, serial: string): Promise<void> {
  await dismissConnectionStatusOverlay(client, serial);
  const opened =
    (await tapByResourceId(client, serial, "add-items-to-playlist")) ||
    (await tapByText(client, serial, "Add items")) ||
    (await tapByText(client, serial, "Add more items")) ||
    (await tapByText(client, serial, "Add items to playlist")) ||
    (await tapByTextContaining(client, serial, "Add items"));
  if (!opened) {
    throw new Error("Could not open the Add items dialog.");
  }
}

export async function chooseSource(client: DroidmindClient, serial: string, labels: readonly string[]): Promise<void> {
  for (const label of labels) {
    const normalizedLabel = label.trim().toLowerCase();
    const resourceId = SOURCE_OPTION_RESOURCE_IDS[normalizedLabel];
    const labelCandidates = SOURCE_OPTION_TEXT_CANDIDATES[normalizedLabel] ?? [label];
    if (resourceId === "import-option-c64u") {
      const existingPickerReady = await waitForC64UPickerReady(serial, 1, 1);
      if (existingPickerReady) {
        return;
      }
    }
    const selectionAttempts = resourceId === "import-option-c64u" ? 3 : SOURCE_OPTION_REVEAL_ATTEMPTS;
    for (let attempt = 1; attempt <= selectionAttempts; attempt += 1) {
      let selected = resourceId ? await tapByResourceId(client, serial, resourceId) : false;
      if (!selected) {
        for (const candidateLabel of labelCandidates) {
          selected =
            (await tapByText(client, serial, candidateLabel)) ||
            (await tapByTextContaining(client, serial, candidateLabel));
          if (selected) {
            break;
          }
        }
      }
      if (!selected) {
        if (attempt < selectionAttempts) {
          await swipePickerContents(client, serial);
        }
        continue;
      }
      if (resourceId === "import-option-c64u") {
        const pickerReady = await waitForC64UPickerReady(serial, 20, 400);
        if (pickerReady) {
          return;
        }
        if (attempt < selectionAttempts) {
          await swipePickerContents(client, serial);
        }
        continue;
      }
      return;
    }
    if (resourceId === "import-option-c64u") {
      throw new Error("C64U source picker did not become ready after selecting the source.");
    }
  }
  throw new Error(`Could not select any source option from: ${labels.join(", ")}`);
}

export async function openPathSegments(
  client: DroidmindClient,
  serial: string,
  segments: readonly string[],
): Promise<void> {
  let currentPath = (await readPickerPath(serial)) ?? "/";
  const currentSegments = currentPath.split("/").filter(Boolean);
  const targetFirstSegment = segments[0]?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const shouldResetToRoot =
    currentSegments.length > 1 ||
    (targetFirstSegment.length > 0 && currentSegments.length > 0 && currentSegments[0] !== targetFirstSegment);

  if (shouldResetToRoot) {
    await tapByText(client, serial, "Root");
    const rootVisible = await waitForPickerPath(serial, "/", 6, 250);
    currentPath = rootVisible ? "/" : ((await readPickerPath(serial)) ?? "/");
  }
  for (const segment of segments) {
    if (currentPathAlreadyAtSegment(currentPath, segment)) {
      continue;
    }
    let opened = false;
    const expectedPath = joinPath(currentPath, segment);
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      opened =
        (await tapByText(client, serial, `Open ${segment}`)) ||
        (await tapByTextContaining(client, serial, `Open ${segment}`)) ||
        (await tapByText(client, serial, segment)) ||
        (await tapByTextContaining(client, serial, segment));
      if (opened) {
        const pathAdvanced = await waitForPickerPath(serial, expectedPath, 6, 250);
        if (pathAdvanced) {
          currentPath = expectedPath;
          break;
        }
        opened = false;
      }
      await swipePickerContents(client, serial);
    }
    if (!opened) {
      throw new Error(`Could not open path segment '${segment}'.`);
    }
  }
}

export async function tapCheckboxForText(client: DroidmindClient, serial: string, label: string): Promise<void> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const node = findVisibleText(nodes, label);
  if (!node) {
    throw new Error(`Could not find selectable row for '${label}'.`);
  }
  const beforeSelectedCount = readSelectedCount(nodes);
  const tapCandidates = [48, 72, 80, 96]
    .map((padding) => checkboxTapPointForLabel(node, padding))
    .filter((point, index, all): point is NonNullable<typeof point> => {
      if (!point) {
        return false;
      }
      return all.findIndex((candidate) => candidate?.x === point.x && candidate?.y === point.y) === index;
    });
  const [point] = tapCandidates;
  if (!point) {
    throw new Error(`Selectable row for '${label}' did not expose checkbox tap bounds.`);
  }
  let observedSelectedCount: number | null = beforeSelectedCount;
  for (const candidate of tapCandidates) {
    await client.tap(serial, candidate.x, candidate.y);
    await sleep(350);

    const afterTapXml = await dumpUiHierarchy(serial);
    const afterTapNodes = parseUiNodes(afterTapXml);
    const afterTapCount = readSelectedCount(afterTapNodes);
    observedSelectedCount = afterTapCount;
    if (afterTapCount !== null && (beforeSelectedCount === null || afterTapCount > beforeSelectedCount)) {
      return;
    }
  }

  throw new Error(
    `Could not confirm checkbox selection for '${label}' after ${tapCandidates.length} attempts (selected count=${observedSelectedCount ?? "<unknown>"}).`,
  );
}

export async function confirmAddItems(client: DroidmindClient, serial: string): Promise<void> {
  const confirmed = await tapByText(client, serial, "Add to playlist");
  if (!confirmed) {
    throw new Error("Could not confirm the Add items dialog.");
  }
}

export async function setDurationSeconds(client: DroidmindClient, serial: string, seconds: number): Promise<void> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const inputNode = findFirstNodeByClass(nodes, "android.widget.EditText");
  if (!inputNode) {
    throw new Error("Could not find the duration input field.");
  }
  const center = parseBoundsCenter(inputNode.bounds);
  if (!center) {
    throw new Error("Duration input field did not expose tap bounds.");
  }

  await client.tap(serial, center.x, center.y);
  await sleep(250);
  await client.pressKey(serial, 123);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await client.pressKey(serial, 67);
  }
  await client.inputText(serial, String(seconds));
  await sleep(250);

  const blurTarget = findVisibleText(nodes, "Songlengths file") ?? findVisibleText(nodes, "Default duration");
  const blurCenter = blurTarget ? parseBoundsCenter(blurTarget.bounds) : null;
  if (blurCenter) {
    await client.tap(serial, blurCenter.x, blurCenter.y);
  } else {
    await client.tap(serial, Math.min(center.x + 180, 980), center.y);
  }
  await sleep(350);

  // Real devices can surface the Android keyboard contacts/accounts permission sheet
  // the first time text input is used. Dismiss it so playback automation can continue.
  if ((await tapByText(client, serial, "Don't allow")) || (await tapByText(client, serial, "Don’t allow"))) {
    await sleep(250);
  }
}

export async function readTopmostTrackLabel(serial: string, candidates: readonly string[]): Promise<string | null> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const node = findTopmostVisibleText(nodes, candidates);
  return node?.text ?? null;
}

export async function waitForTrackLabel(
  serial: string,
  expectedLabel: string,
  candidates: readonly string[],
  retries: number,
  delayMs: number,
): Promise<string> {
  let lastObserved = "";
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const observed = await readTopmostTrackLabel(serial, candidates);
    lastObserved = observed ?? "";
    if (observed === expectedLabel) {
      return observed;
    }
    await sleep(delayMs);
  }
  throw new Error(`Expected current track '${expectedLabel}', observed '${lastObserved || "<none>"}'.`);
}
