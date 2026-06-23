/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Public API for the menu ⇄ config mapping layer. See
 * `docs/research/menu-config-mapping/README.md` for the Layer A / Layer B split.
 */

export type {
  RestPointer,
  MenuNode,
  MenuNodeKind,
  MenuHierarchy,
  TerminologyOverlay,
  TerminologyOverlayEntry,
} from "./types";
export { lookupOverlay, restKey } from "./types";

export { TERMINOLOGY_OVERLAY, resolveOverlayEntry } from "./overlay";
export { resolveMenuMapping, compareFirmwareVersions, mappedFamilies } from "./resolveMenuMapping";
export type { ResolveMenuMappingInput } from "./resolveMenuMapping";

export {
  projectConfigToMenu,
  liveConfigFromFixture,
  liveConfigFromCategoryItems,
  renderedRestKeySet,
  liveRestKeySet,
} from "./projectConfigToMenu";
export type {
  LiveConfig,
  LiveItem,
  ProjectionResult,
  ProjectionContext,
  ProjectedPage,
  ProjectedNode,
  ProjectedLeaf,
  ProjectedSection,
  ProjectedMenuOnly,
  ProjectedFallbackGroup,
  ProjectionDrift,
} from "./projectConfigToMenu";

export { routeAdvancedItem, advancedCategoriesForPage, unroutedCategories } from "./advancedRouting";
export { getMenuValueFormatter, formatCpuSpeedMhz, MENU_FORMATTER_IDS } from "./menuValueFormatters";
export type { MenuFormatterId } from "./menuValueFormatters";
export { humanizeRestName, PRESERVED_ACRONYMS } from "./humanize";

export { C64U_1_1_0_HIERARCHY, C64U_1_1_0_OVERLAY } from "./c64u-1.1.0.generated";

import type { MenuHierarchy } from "./types";

/**
 * The set of REST items a hierarchy claims in a category (page-facing helper for the
 * Advanced/fallback section to filter). Returns an empty set for an unreferenced
 * category — so all of its live items fall through to the fallback, by definition.
 */
export const claimedItemsForCategory = (hierarchy: MenuHierarchy | null, category: string): Set<string> =>
  new Set(hierarchy?.claimedItemsByCategory[category] ?? []);
