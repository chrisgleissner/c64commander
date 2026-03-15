/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dumpUiHierarchy } from "./helpers.js";
import {
  activeBottomTabLabel,
  findBottomTabByText,
  findNodeByResourceId,
  findVisibleText,
  findVisibleTextContaining,
  parseBoundsCenter,
  parseUiNodes,
} from "./appFirstUi.js";
import { DroidmindClient } from "./droidmindClient.js";

export const APP_PACKAGE = "uk.gleissner.c64commander";
export const APP_ACTIVITY = ".MainActivity";

const TAB_LABEL_BY_ROUTE: Record<string, string> = {
  "/": "Home",
  "/play": "Play",
  "/disks": "Disks",
  "/config": "Config",
  "/settings": "Settings",
  "/docs": "Docs",
};

const TAB_RESOURCE_ID_BY_ROUTE: Record<string, string> = {
  "/": "tab-home",
  "/play": "tab-play",
  "/disks": "tab-disks",
  "/config": "tab-config",
  "/settings": "tab-settings",
  "/docs": "tab-docs",
};

const ROUTE_MARKERS: Record<string, readonly string[]> = {
  "/": ["HOME", "Save RAM", "QUICK CONFIG"],
  "/play": ["PLAY FILES", "Playlist"],
  "/disks": ["DISKS", "DRIVES"],
  "/config": ["CONFIG", "categories"],
  "/settings": ["SETTINGS", "Connection"],
  "/docs": ["DOCS", "How to use this app"],
};

const TAB_FALLBACK_COORDS: Record<string, { x: number; y: number }> = {
  Home: { x: 107, y: 2077 },
  Play: { x: 272, y: 2077 },
  Disks: { x: 433, y: 2077 },
  Config: { x: 606, y: 2077 },
  Settings: { x: 797, y: 2077 },
  Docs: { x: 978, y: 2077 },
};
const TAB_LABELS = Object.values(TAB_LABEL_BY_ROUTE);

function hasMarker(nodes: ReturnType<typeof parseUiNodes>, marker: string): boolean {
  const normalized = marker.trim().toLowerCase();
  return nodes.some((node) => {
    if (!node.text || !node.enabled) {
      return false;
    }
    const center = parseBoundsCenter(node.bounds);
    if (!center) {
      return false;
    }
    return node.text.trim().toLowerCase().includes(normalized);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function maybeDismissFocusedInput(client: DroidmindClient, serial: string): Promise<void> {
  if (typeof client.pressKey !== 'function') {
    return;
  }

  await client.pressKey(serial, 4);
  await sleep(500);
}

async function dismissConnectionStatusOverlay(client: DroidmindClient, serial: string): Promise<void> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const overlayVisible = findVisibleText(nodes, "Connection Status");
  if (!overlayVisible) {
    return;
  }

  const closeButton = findVisibleText(nodes, "Close");
  if (!closeButton) {
    return;
  }

  const center = parseBoundsCenter(closeButton.bounds);
  if (!center) {
    return;
  }

  await client.tap(serial, center.x, center.y);
  await sleep(600);
}

async function isKeyguardShowing(client: DroidmindClient, serial: string): Promise<boolean> {
  const windowDump = await client.shell(serial, "dumpsys window | grep isKeyguardShowing");
  return windowDump.includes("isKeyguardShowing=true");
}

function routeLabel(route: string): string {
  const label = TAB_LABEL_BY_ROUTE[route];
  if (!label) {
    throw new Error(`Unsupported route '${route}' for app-first navigation.`);
  }
  return label;
}

export async function ensureDeviceUnlocked(client: DroidmindClient, serial: string): Promise<void> {
  if (!(await isKeyguardShowing(client, serial))) {
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await client.pressKey(serial, 224);
    await sleep(150);
    await client.shell(serial, "wm dismiss-keyguard");
    await sleep(150);
    await client.pressKey(serial, 82);
    await sleep(300);
    await client.swipe(serial, 540, 1700, 540, 350, 220);
    await sleep(800);

    if (!(await isKeyguardShowing(client, serial))) {
      return;
    }
  }

  throw new Error("Device remained locked after app-first unlock attempts.");
}

export async function launchAppForeground(client: DroidmindClient, serial: string): Promise<void> {
  await ensureDeviceUnlocked(client, serial);
  await client.startApp(serial, APP_PACKAGE, APP_ACTIVITY);
  await sleep(1500);
}

export async function restartApp(client: DroidmindClient, serial: string): Promise<void> {
  await client.stopApp(serial, APP_PACKAGE);
  await sleep(300);
  await launchAppForeground(client, serial);
}

export async function tapByText(client: DroidmindClient, serial: string, text: string): Promise<boolean> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const node = findVisibleText(nodes, text);
  if (!node) {
    return false;
  }

  const center = parseBoundsCenter(node.bounds);
  if (!center) {
    return false;
  }

  await client.tap(serial, center.x, center.y);
  await sleep(900);
  return true;
}

export async function tapByTextContaining(client: DroidmindClient, serial: string, text: string): Promise<boolean> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const node = findVisibleTextContaining(nodes, text);
  if (!node) {
    return false;
  }

  const center = parseBoundsCenter(node.bounds);
  if (!center) {
    return false;
  }

  await client.tap(serial, center.x, center.y);
  await sleep(900);
  return true;
}

export async function tapByResourceId(
  client: DroidmindClient,
  serial: string,
  resourceIdSuffix: string,
): Promise<boolean> {
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const node = findNodeByResourceId(nodes, resourceIdSuffix);
  if (!node) {
    return false;
  }

  const center = parseBoundsCenter(node.bounds);
  if (!center) {
    return false;
  }

  await client.tap(serial, center.x, center.y);
  await sleep(900);
  return true;
}

function computeBottomTabThreshold(nodes: ReturnType<typeof parseUiNodes>): number {
  let maxCenterY = 0;
  for (const node of nodes) {
    const center = parseBoundsCenter(node.bounds);
    if (center && center.y > maxCenterY) {
      maxCenterY = center.y;
    }
  }
  if (maxCenterY === 0) {
    return 1500;
  }
  return Math.floor(maxCenterY * 0.92);
}

function findBottomTabByResourceId(
  nodes: ReturnType<typeof parseUiNodes>,
  resourceId: string,
  minCenterY: number,
): ReturnType<typeof parseUiNodes>[number] | null {
  for (const node of nodes) {
    if (!node.enabled || !node.clickable || node.className !== "android.widget.Button") {
      continue;
    }
    if (!node.resourceId.endsWith(resourceId)) {
      continue;
    }
    const center = parseBoundsCenter(node.bounds);
    if (!center || center.y < minCenterY) {
      continue;
    }
    return node;
  }
  return null;
}

export async function navigateToRoute(client: DroidmindClient, serial: string, route: string): Promise<void> {
  const tabLabel = routeLabel(route);
  const tabResourceId = TAB_RESOURCE_ID_BY_ROUTE[route];
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissConnectionStatusOverlay(client, serial);

    const xml = await dumpUiHierarchy(serial);
    const nodes = parseUiNodes(xml);
    const bottomThreshold = computeBottomTabThreshold(nodes);
    const tabNode =
      findBottomTabByText(nodes, tabLabel, bottomThreshold) ??
      findBottomTabByResourceId(nodes, tabResourceId, bottomThreshold);

    if (tabNode) {
      const center = parseBoundsCenter(tabNode.bounds);
      if (!center) {
        throw new Error(`Bottom-tab node for '${tabLabel}' did not expose tap bounds.`);
      }
      await client.tap(serial, center.x, center.y);
    } else {
      const fallback = TAB_FALLBACK_COORDS[tabLabel];
      if (!fallback) {
        throw new Error(`No fallback tab coordinates configured for '${tabLabel}'.`);
      }
      await client.tap(serial, fallback.x, fallback.y);
    }

    await sleep(900);

    try {
      await waitForRouteMarkers(serial, route, 8);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) {
        break;
      }
      await maybeDismissFocusedInput(client, serial);
    }
  }

  throw lastError ?? new Error(`Route '${route}' navigation failed without a diagnostic error.`);
}

export async function waitForRouteMarkers(serial: string, route: string, retries: number): Promise<void> {
  const markers = ROUTE_MARKERS[route];
  if (!markers || markers.length === 0) {
    throw new Error(`No route markers configured for route '${route}'.`);
  }
  const tabLabel = routeLabel(route);

  let lastActiveTab: string | null = null;
  let lastMissingMarkers = [...markers];
  for (let attempt = 1; attempt <= retries; attempt++) {
    const xml = await dumpUiHierarchy(serial);
    const nodes = parseUiNodes(xml);
    const bottomThreshold = computeBottomTabThreshold(nodes);
    const currentActiveTab = activeBottomTabLabel(nodes, TAB_LABELS, bottomThreshold);
    const missingMarkers = markers.filter((marker) => !hasMarker(nodes, marker));
    lastActiveTab = currentActiveTab;
    lastMissingMarkers = missingMarkers;

    const tabSignalAllowsPass = currentActiveTab === null || currentActiveTab === tabLabel;
    if (tabSignalAllowsPass && missingMarkers.length === 0) {
      return;
    }
    await sleep(500);
  }

  throw new Error(
    `Route '${route}' marker check failed after ${retries} retries (activeTab=${lastActiveTab ?? "none"}, missingMarkers=${lastMissingMarkers.join(", ")}).`,
  );
}
