/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceInfo } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { matchLabel } from "@/lib/telnet/telnetMenuNavigator";
import type {
  ParsedMenu,
  TelnetAction,
  TelnetActionId,
  TelnetMenuKey,
  TelnetScreen,
  TelnetSessionApi,
} from "@/lib/telnet/telnetTypes";
import { TELNET_ACTIONS, TELNET_ACTION_IDS, TelnetError } from "@/lib/telnet/telnetTypes";

const LOG_TAG = "TelnetCapabilityDiscovery";
const STEP_TIMEOUT_MS = 700;

export type TelnetSupportStatus = "supported" | "unsupported" | "unknown";

export interface TelnetResolvedActionTarget {
  categoryLabel: string;
  actionLabel: string;
  source: "initial";
}

export interface TelnetActionSupport {
  actionId: TelnetActionId;
  status: TelnetSupportStatus;
  reason: string | null;
  target: TelnetResolvedActionTarget | null;
}

export interface TelnetDiscoveredSubmenu {
  kind: "submenu";
  items: string[];
  defaultItem: string | null;
}

export interface TelnetDiscoveredDirectEntry {
  kind: "direct_entry";
  title: string;
}

export type TelnetDiscoveredNode = TelnetDiscoveredSubmenu | TelnetDiscoveredDirectEntry;

export interface TelnetDiscoveredInitialMenu {
  items: string[];
  defaultItem: string | null;
  nodes: Record<string, TelnetDiscoveredNode>;
}

export interface TelnetCapabilitySnapshot {
  cacheKey: string;
  deviceIdentity: string;
  menuKey: TelnetMenuKey;
  initialMenu: TelnetDiscoveredInitialMenu;
  actionSupport: Record<TelnetActionId, TelnetActionSupport>;
}

export interface TelnetSessionRunner {
  withSession<T>(callback: (session: TelnetSessionApi) => Promise<T>): Promise<T>;
}

const capabilityCache = new Map<string, TelnetCapabilitySnapshot>();
const inFlightDiscovery = new Map<string, Promise<TelnetCapabilitySnapshot>>();

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const buildDeviceIdentity = (deviceInfo?: DeviceInfo | null) => {
  const parts = [
    deviceInfo?.unique_id?.trim(),
    deviceInfo?.hostname?.trim(),
    deviceInfo?.product?.trim(),
    deviceInfo?.firmware_version?.trim(),
  ].filter(Boolean);
  return parts.join("|");
};

export const buildTelnetCapabilityCacheKey = (
  deviceInfo: DeviceInfo | null | undefined,
  menuKey: TelnetMenuKey,
  host: string,
) => `${buildDeviceIdentity(deviceInfo) || host}|${menuKey}`;

export const getCachedTelnetCapabilities = (cacheKey: string) => capabilityCache.get(cacheKey) ?? null;

export const clearTelnetCapabilityCache = () => {
  capabilityCache.clear();
  inFlightDiscovery.clear();
};

const findTopMenu = (screen: TelnetScreen): ParsedMenu | null => {
  const actionableMenus = screen.menus.filter((menu) => menu.items.length > 0);
  return actionableMenus[actionableMenus.length - 1] ?? screen.menus[screen.menus.length - 1] ?? null;
};

const findSubmenu = (screen: TelnetScreen): ParsedMenu | null => {
  const nested = screen.menus.filter((menu) => menu.level > 0);
  return nested[nested.length - 1] ?? null;
};

const findStandaloneSubmenu = (screen: TelnetScreen, rootMenu: ParsedMenu): ParsedMenu | null => {
  if (screen.menus.length !== 1) return null;
  const candidate = screen.menus[0];
  if (!candidate || candidate.items.length === 0) return null;
  const overlapsRootItems = candidate.items.some((candidateItem) =>
    rootMenu.items.some((rootItem) => matchLabel(candidateItem.label, rootItem.label)),
  );
  return overlapsRootItems ? null : candidate;
};

const extractRow = (screen: TelnetScreen, row: number, left: number, right: number) =>
  screen.cells[row]
    .slice(left, right)
    .map((cell) => cell.char)
    .join("");

const cleanOverlayLabel = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/^[lkmjqx]+\s*/gi, "")
      .replace(/\s*[lkmjqx]+$/gi, "")
      .replace(/q{4,}/gi, " ")
      .replace(/[│┌┐└┘─├┤┬┴┼]/g, " "),
  );

const extractOverlaySubmenu = (screen: TelnetScreen, parentMenu: ParsedMenu): TelnetDiscoveredSubmenu | null => {
  const items: string[] = [];
  const left = parentMenu.bounds.x + 1;
  const right = parentMenu.bounds.x + parentMenu.bounds.width - 1;
  for (let row = parentMenu.bounds.y + 1; row < parentMenu.bounds.y + parentMenu.bounds.height - 1; row += 1) {
    const raw = extractRow(screen, row, left, right);
    const separatorIndex = Math.max(raw.lastIndexOf("x"), raw.lastIndexOf("│"));
    if (separatorIndex < 0) continue;
    const candidate = cleanOverlayLabel(raw.slice(separatorIndex + 1));
    if (!candidate || items.some((existing) => matchLabel(existing, candidate))) continue;
    items.push(candidate);
  }
  if (items.length === 0) return null;
  return {
    kind: "submenu",
    items,
    defaultItem: items[0] ?? null,
  };
};

const describeDirectEntry = (screen: TelnetScreen): TelnetDiscoveredDirectEntry | null => {
  const candidateMenus = [...screen.menus].sort(
    (left, right) =>
      right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height || right.level - left.level,
  );
  const targetMenu = candidateMenus[0];
  if (!targetMenu) return null;
  for (let row = targetMenu.bounds.y + 1; row < targetMenu.bounds.y + targetMenu.bounds.height - 1; row += 1) {
    const title = normalizeWhitespace(
      extractRow(screen, row, targetMenu.bounds.x + 1, targetMenu.bounds.x + targetMenu.bounds.width - 1),
    );
    if (!title) continue;
    if (title.includes("Query Form") || title.includes("File Search")) {
      return {
        kind: "direct_entry",
        title,
      };
    }
  }
  return null;
};

const openActionMenu = async (session: TelnetSessionApi, menuKey: TelnetMenuKey) => {
  await session.sendKey(menuKey);
  let screen = await session.readScreen(STEP_TIMEOUT_MS);
  if (findTopMenu(screen)) return screen;
  await session.sendKey(menuKey);
  screen = await session.readScreen(STEP_TIMEOUT_MS);
  if (findTopMenu(screen)) return screen;
  throw new TelnetError(`Action menu not visible after ${menuKey}`, "MENU_NOT_FOUND", { menuKey });
};

const navigateToMenuIndex = async (
  session: TelnetSessionApi,
  currentScreen: TelnetScreen,
  menu: ParsedMenu,
  targetIndex: number,
) => {
  let currentMenu = menu;
  let currentIndex = currentMenu.selectedIndex;
  while (currentIndex !== targetIndex) {
    await session.sendKey(targetIndex > currentIndex ? "DOWN" : "UP");
    currentScreen = await session.readScreen(STEP_TIMEOUT_MS);
    const refreshedMenu = findTopMenu(currentScreen);
    if (!refreshedMenu) {
      currentIndex += targetIndex > currentIndex ? 1 : -1;
      continue;
    }
    currentMenu = refreshedMenu;
    currentIndex = currentMenu.selectedIndex;
  }
  return { screen: currentScreen, menu: currentMenu };
};

const discoverNodeAfterOpening = async (
  session: TelnetSessionApi,
  rootMenu: ParsedMenu,
): Promise<TelnetDiscoveredNode | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const followupScreen = await session.readScreen(STEP_TIMEOUT_MS);
    const submenu = findSubmenu(followupScreen) ?? findStandaloneSubmenu(followupScreen, rootMenu);
    if (submenu && submenu.items.length > 0) {
      return {
        kind: "submenu",
        items: submenu.items.map((item) => item.label),
        defaultItem: submenu.items[submenu.selectedIndex]?.label ?? submenu.items[0]?.label ?? null,
      } satisfies TelnetDiscoveredSubmenu;
    }

    const overlaySubmenu = extractOverlaySubmenu(followupScreen, rootMenu);
    if (overlaySubmenu) {
      return overlaySubmenu;
    }

    const directEntry = describeDirectEntry(followupScreen);
    if (directEntry) {
      return directEntry;
    }
  }

  return null;
};

const resolveCategoryHints = (action: TelnetAction) => [action.menuPath[0], ...(action.categoryHints ?? [])];

const resolveActionHints = (action: TelnetAction) =>
  [action.menuPath[1], action.shortLabel, action.label, ...(action.actionHints ?? [])].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

const resolveActionSupport = (
  initialMenu: TelnetDiscoveredInitialMenu,
  actionId: TelnetActionId,
  deviceLabel: string,
): TelnetActionSupport => {
  const action = TELNET_ACTIONS[actionId];
  const categoryHints = resolveCategoryHints(action);
  const actionHints = resolveActionHints(action);
  const categoryLabel = initialMenu.items.find((item) => categoryHints.some((hint) => matchLabel(item, hint))) ?? null;

  if (!categoryLabel) {
    return {
      actionId,
      status: "unsupported",
      reason: `${action.label} is not available on ${deviceLabel}.`,
      target: null,
    };
  }

  const node = initialMenu.nodes[categoryLabel];
  if (!node || node.kind !== "submenu") {
    return {
      actionId,
      status: "unsupported",
      reason: `${action.label} is not exposed in the ${categoryLabel} menu on ${deviceLabel}.`,
      target: null,
    };
  }

  const actionLabel = node.items.find((item) => actionHints.some((hint) => matchLabel(item, hint))) ?? null;
  if (!actionLabel) {
    return {
      actionId,
      status: "unsupported",
      reason: `${action.label} is not available on ${deviceLabel}.`,
      target: null,
    };
  }

  return {
    actionId,
    status: "supported",
    reason: null,
    target: {
      categoryLabel,
      actionLabel,
      source: "initial",
    },
  };
};

const discoverInitialMenu = async (
  menuKey: TelnetMenuKey,
  runner: TelnetSessionRunner,
): Promise<TelnetDiscoveredInitialMenu> => {
  const rootScreen = await runner.withSession(async (session) => await openActionMenu(session, menuKey));
  const rootMenu = findTopMenu(rootScreen);
  if (!rootMenu) {
    throw new TelnetError("Initial action menu not detected during discovery", "DISCOVERY_FAILED");
  }

  const nodes: Record<string, TelnetDiscoveredNode> = {};

  for (let targetIndex = 0; targetIndex < rootMenu.items.length; targetIndex += 1) {
    const label = rootMenu.items[targetIndex]?.label;
    if (!label) continue;
    const node = await runner.withSession(async (session) => {
      const initialScreen = await openActionMenu(session, menuKey);
      const topMenu = findTopMenu(initialScreen);
      if (!topMenu) {
        throw new TelnetError("Top-level action menu disappeared during discovery", "DESYNC");
      }
      const { menu } = await navigateToMenuIndex(session, initialScreen, topMenu, targetIndex);
      await session.sendKey("RIGHT");
      return await discoverNodeAfterOpening(session, menu);
    });
    if (node) {
      nodes[label] = node;
    }
  }

  return {
    items: rootMenu.items.map((item) => item.label),
    defaultItem: rootMenu.items[rootMenu.selectedIndex]?.label ?? rootMenu.items[0]?.label ?? null,
    nodes,
  };
};

export const discoverTelnetCapabilities = async ({
  cacheKey,
  deviceInfo,
  menuKey,
  runner,
}: {
  cacheKey: string;
  deviceInfo: DeviceInfo | null | undefined;
  menuKey: TelnetMenuKey;
  runner: TelnetSessionRunner;
}): Promise<TelnetCapabilitySnapshot> => {
  const cached = capabilityCache.get(cacheKey);
  if (cached) return cached;

  const pending = inFlightDiscovery.get(cacheKey);
  if (pending) return pending;

  const discoveryPromise = (async () => {
    const deviceLabel =
      normalizeWhitespace([deviceInfo?.product, deviceInfo?.firmware_version].filter(Boolean).join(" ")) ||
      "this device";
    const initialMenu = await discoverInitialMenu(menuKey, runner);
    const actionSupport = Object.fromEntries(
      TELNET_ACTION_IDS.map((actionId) => [actionId, resolveActionSupport(initialMenu, actionId, deviceLabel)]),
    ) as Record<TelnetActionId, TelnetActionSupport>;

    const snapshot: TelnetCapabilitySnapshot = {
      cacheKey,
      deviceIdentity: buildDeviceIdentity(deviceInfo),
      menuKey,
      initialMenu,
      actionSupport,
    };
    capabilityCache.set(cacheKey, snapshot);
    addLog("info", `${LOG_TAG}: capability discovery completed`, {
      cacheKey,
      discoveredCategories: initialMenu.items,
    });
    return snapshot;
  })();

  inFlightDiscovery.set(cacheKey, discoveryPromise);
  try {
    return await discoveryPromise;
  } finally {
    inFlightDiscovery.delete(cacheKey);
  }
};
