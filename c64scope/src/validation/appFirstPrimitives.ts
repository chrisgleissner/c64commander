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
  findVisibleText,
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

const ROUTE_MARKERS: Record<string, readonly string[]> = {
  "/": ["HOME", "Save RAM", "QUICK CONFIG"],
  "/play": ["PLAY FILES", "Playlist"],
  "/disks": ["DISKS", "DRIVES"],
  "/config": ["CONFIG", "categories"],
  "/settings": ["SETTINGS", "Connection"],
  "/docs": ["DOCS", "How to use this app"],
};

const TAB_FALLBACK_COORDS: Record<string, { x: number; y: number }> = {
  Home: { x: 110, y: 1800 },
  Play: { x: 270, y: 1800 },
  Disks: { x: 430, y: 1800 },
  Config: { x: 605, y: 1800 },
  Settings: { x: 790, y: 1800 },
  Docs: { x: 970, y: 1800 },
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

function routeLabel(route: string): string {
  const label = TAB_LABEL_BY_ROUTE[route];
  if (!label) {
    throw new Error(`Unsupported route '${route}' for app-first navigation.`);
  }
  return label;
}

export async function ensureDeviceUnlocked(client: DroidmindClient, serial: string): Promise<void> {
  const windowDump = await client.shell(serial, "dumpsys window | grep isKeyguardShowing");
  if (!windowDump.includes("isKeyguardShowing=true")) {
    return;
  }

  // Wake + dismiss lock screen on lab device.
  await client.pressKey(serial, 82);
  await sleep(300);
  await client.swipe(serial, 540, 1700, 540, 350, 220);
  await sleep(800);
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

export async function navigateToRoute(client: DroidmindClient, serial: string, route: string): Promise<void> {
  const tabLabel = routeLabel(route);
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiNodes(xml);
  const bottomThreshold = computeBottomTabThreshold(nodes);
  const tabNode = findBottomTabByText(nodes, tabLabel, bottomThreshold);

  if (tabNode) {
    const center = parseBoundsCenter(tabNode.bounds);
    if (!center) {
      throw new Error(`Bottom-tab node for '${tabLabel}' did not expose tap bounds.`);
    }
    await client.tap(serial, center.x, center.y);
    await sleep(900);
  } else {
    const fallback = TAB_FALLBACK_COORDS[tabLabel];
    if (!fallback) {
      throw new Error(`No fallback tab coordinates configured for '${tabLabel}'.`);
    }
    await client.tap(serial, fallback.x, fallback.y);
    await sleep(900);
  }

  await waitForRouteMarkers(serial, route, 8);
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
